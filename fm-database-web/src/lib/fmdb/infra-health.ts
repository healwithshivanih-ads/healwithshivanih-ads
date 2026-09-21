/**
 * Infra watchdog — the decision half.
 *
 * WHY THIS EXISTS. On 2026-08-15 the coach was away from her Mac, a client's
 * intake link needed re-issuing, and `fmcoach.shivanihari.com` — the cloudflared
 * tunnel that is the ONLY remote route to the coach UI — had been dead since at
 * least 26 June. Nothing monitored it. She found out at 11pm, on the one night
 * it mattered, and it took someone physically at the Mac.
 *
 * A daily "the tunnel is down" email would not have helped that night: an alert
 * tells you about a problem you still cannot fix from a phone. So this watchdog
 * REPAIRS FIRST and only escalates to email when repair has failed repeatedly.
 * A dead tunnel becomes a five-minute blip nobody notices, instead of a
 * three-week outage discovered at the worst possible moment.
 *
 * WHY THE FLY CHECK IS DEBOUNCED AND GATED ON REACHABILITY. Between 28 Aug and
 * 20 Sep 2026 this watchdog mailed "⚠️ FM Coach — needs attention now / Fly
 * health returned no response — clients cannot open their forms or app" roughly
 * once a day. The Fly machine had in fact been `started` with its health check
 * passing throughout, untouched since 13 Sep: every one of those emails was
 * false. Two defects produced them, and both are fixed here.
 *
 *   1. NO DEBOUNCE. `tunnel_down` earns an email only after TUNNEL_ALERT_AFTER
 *      consecutive failed cycles, but `fly_down` mailed on the strength of a
 *      SINGLE cycle. An in-cycle retry was added on 2026-09-08 and did not
 *      help — it only widened the window to ~25s, while the thing being
 *      absorbed (a Mac sleep/wake, a Wi-Fi reconnect) lasts longer than that.
 *      Every probe in a cycle failing is one observation, not three.
 *   2. NO REACHABILITY CONTROL. Every probe leaves from the coach's Mac, so a
 *      dead uplink makes the entire internet look down — and the watchdog read
 *      that as "Fly is down, clients are locked out". The 2026-09-20 22:15 run
 *      reported `tunnel_down` AND `fly_down` in the same cycle; the tunnel path
 *      (Mac → Cloudflare → Mac) and the Fly path (Mac → Singapore) share
 *      exactly one component, the Mac's own uplink. The mail then sent fine
 *      forty seconds later, because by then the network was back.
 *
 * The rule that falls out: THIS MACHINE FAILING TO REACH A HOST IS NOT EVIDENCE
 * THAT THE HOST IS DOWN. Before calling anything an outage, prove the uplink
 * works by reaching something we do not run. If we cannot, we have no reading
 * this cycle — say so in the log and stay silent, rather than telling the coach
 * her clients are locked out of an app that is serving them fine.
 *
 * This module is pure — no fetch, no exec, no fs — so the escalation rules are
 * unit-testable without a Mac, a tunnel, or a mail server. The I/O lives in
 * app/api/cron/infra-health/route.ts. Same split as middleware-policy.ts.
 */

/** One thing we probed, and what came back. `status: null` = request threw. */
export interface Probe {
  status: number | null;
}

export interface ProbeSet {
  /** Public tunnel hostname → /api/health. Expect 200. */
  tunnelHealth: Probe;
  /** Public tunnel hostname → a coach route. Expect 401 (the auth wall). */
  tunnelCoachRoute: Probe;
  /** localhost:3002 → a coach route. Expect 401. Proves auth is configured
   *  in the RUNNING process, not merely present in .env.local. */
  localCoachRoute: Probe;
  /** Fly public host → /api/health. Expect 200. Clients depend on this one. */
  flyHealth: Probe;
  /**
   * A host we do NOT run, probed only once one of ours has already failed.
   *
   * ANY HTTP answer counts as success here, including a 4xx or 5xx — this is a
   * test of our uplink, not of the other end's health. Only `status: null`
   * (the request threw) means this Mac is off the internet, and in that state
   * nothing it failed to reach may be called down.
   */
  internet: Probe;
}

export type Severity = "critical" | "warning";

export interface Problem {
  key:
    | "tunnel_down"
    | "dashboard_exposed"
    | "auth_off_locally"
    | "fly_down"
    | "local_network_down";
  severity: Severity;
  detail: string;
  /** One line the coach can paste. Empty when there is nothing mechanical. */
  fix: string;
}

export interface Evaluation {
  problems: Problem[];
  /** Tunnel is down and a restart is the plausible fix. */
  tunnelNeedsRepair: boolean;
  /** Something is serving coach routes publicly WITHOUT the auth wall. */
  exposed: boolean;
  /** This Mac could not reach the internet, so no remote probe means anything
   *  this cycle. Callers should log it; it must never become an email. */
  networkUncertain: boolean;
}

const TUNNEL_FIX = "sudo launchctl kickstart -k system/com.cloudflare.cloudflared";

/**
 * Turn raw probe results into problems.
 *
 * Deliberate asymmetry between the two "coach route" probes:
 *
 *   - PUBLIC returning 200 is an emergency. Coach routes carry every client's
 *     record, and a 200 there means the whole dashboard is being served to
 *     anyone with the URL. Never rate-limited, never batched — it escalates on
 *     the first observation.
 *   - LOCAL returning 200 is only a warning. That is the NORMAL, correct state
 *     for a Mac with no tunnel in front of it (proxy.ts mode 3, LOCAL DEV), and
 *     flagging it as critical would cry wolf on a perfectly safe machine. It
 *     matters as a leading indicator: if auth is off locally and the tunnel
 *     later comes up, the public probe turns critical.
 *
 * The two REMOTE-outage problems (`tunnel_down`, `fly_down`) are additionally
 * gated on reachability, for the reason in the header. The two EXPOSURE checks
 * are not, and need no gate: both fire on a 200 we actually received, which an
 * offline Mac cannot manufacture.
 */
export function evaluate(p: ProbeSet): Evaluation {
  const problems: Problem[] = [];

  const tunnelUp = p.tunnelHealth.status === 200;
  // A coach route answering 200 in public = the wall is not there.
  const publiclyOpen = p.tunnelCoachRoute.status === 200;

  // No answer from a host we do not run = our uplink is down, not theirs.
  const networkUncertain = p.internet.status === null;

  if (networkUncertain) {
    problems.push({
      key: "local_network_down",
      severity: "warning",
      detail:
        "this Mac could not reach the internet at all, so the tunnel and Fly " +
        "probes prove nothing this cycle — not reporting them as outages",
      fix: "",
    });
  }

  if (!tunnelUp && !networkUncertain) {
    problems.push({
      key: "tunnel_down",
      severity: "warning",
      detail: `tunnel health returned ${p.tunnelHealth.status ?? "no response"} (expected 200)`,
      fix: TUNNEL_FIX,
    });
  }

  if (publiclyOpen) {
    problems.push({
      key: "dashboard_exposed",
      severity: "critical",
      detail:
        "a coach route is returning 200 on the PUBLIC hostname — the dashboard " +
        "is being served without the auth wall",
      fix:
        "Set COACH_AUTH_PASSWORD in fm-database-web/.env.local, then " +
        "pm2 delete fm-coach && pm2 start ecosystem.config.js (restart does NOT " +
        "re-read it). To close the hole immediately: sudo launchctl bootout " +
        "system/com.cloudflare.cloudflared",
    });
  }

  if (p.localCoachRoute.status === 200) {
    problems.push({
      key: "auth_off_locally",
      severity: "warning",
      detail:
        "localhost is serving coach routes without auth (normal with no tunnel, " +
        "dangerous the moment one is exposed)",
      fix:
        "Set COACH_AUTH_PASSWORD in fm-database-web/.env.local, then " +
        "pm2 delete fm-coach && pm2 start ecosystem.config.js",
    });
  }

  if (p.flyHealth.status !== 200 && !networkUncertain) {
    problems.push({
      key: "fly_down",
      severity: "critical",
      detail: `Fly health returned ${p.flyHealth.status ?? "no response"} (expected 200) — clients cannot open their forms or app`,
      fix: "flyctl status -a theochretree-coach   # then: flyctl machine restart <id> -a theochretree-coach",
    });
  }

  return {
    problems,
    // Only worth kickstarting when the tunnel is genuinely the thing that is
    // down. Kickstarting because our own Wi-Fi dropped fixes nothing and
    // bounces the coach's remote access for no reason.
    tunnelNeedsRepair: !tunnelUp && !networkUncertain,
    exposed: publiclyOpen,
    networkUncertain,
  };
}

/** Persisted between runs so escalation can count consecutive failures. */
export interface WatchdogState {
  /** Consecutive cycles in which the tunnel was down AFTER a repair attempt. */
  consecutiveTunnelFailures: number;
  /** Consecutive cycles in which Fly was unreachable FROM A MACHINE THAT COULD
   *  reach the internet. Offline cycles neither add to it nor clear it. */
  consecutiveFlyFailures: number;
  /** ISO of the last alert email, per problem key — for re-alert throttling. */
  lastAlertAt: Record<string, string>;
}

export const EMPTY_STATE: WatchdogState = {
  consecutiveTunnelFailures: 0,
  consecutiveFlyFailures: 0,
  lastAlertAt: {},
};

/** Escalate the tunnel only after this many consecutive failed repairs. At the
 *  5-minute schedule that is ~15 minutes of genuine outage — long enough that a
 *  transient blip or a Mac waking from sleep never mails, short enough that a
 *  real outage reaches her the same morning. */
export const TUNNEL_ALERT_AFTER = 3;

/** Same contract for Fly, and for the same reason. Fly cannot be auto-repaired,
 *  so this is purely a debounce: ~15 minutes of sustained unreachability from a
 *  machine we have PROVEN is online. A genuine outage still reaches her within
 *  the quarter hour; a sleep/wake cycle no longer reaches her at all. */
export const FLY_ALERT_AFTER = 3;

/** Don't re-send the same alert more often than this. An unfixed problem should
 *  nag daily, not every five minutes. */
export const REALERT_AFTER_HOURS = 24;

export interface Decision {
  /** Problems worth emailing about right now. */
  alert: Problem[];
  state: WatchdogState;
}

/**
 * Decide what to email, given this cycle's problems and the previous state.
 *
 * `repairAttempted` = we already tried to kickstart the tunnel this cycle and
 * re-probed afterwards, so a still-down tunnel counts as a genuine failure
 * rather than a first sighting.
 */
export function decide(
  evaluation: Evaluation,
  prev: WatchdogState,
  opts: { repairAttempted: boolean; now: Date },
): Decision {
  const state: WatchdogState = {
    consecutiveTunnelFailures: prev.consecutiveTunnelFailures,
    consecutiveFlyFailures: prev.consecutiveFlyFailures,
    lastAlertAt: { ...prev.lastAlertAt },
  };

  const tunnelDown = evaluation.problems.some((x) => x.key === "tunnel_down");
  if (tunnelDown && opts.repairAttempted) {
    state.consecutiveTunnelFailures = prev.consecutiveTunnelFailures + 1;
  } else if (!tunnelDown && !evaluation.networkUncertain) {
    // Recovered — a later outage starts counting from zero, so one bad night
    // three weeks ago cannot push the next one straight to an alert. An
    // OFFLINE cycle is not a recovery: it saw nothing, so it clears nothing,
    // or a flapping uplink would reset a real outage's counter forever.
    state.consecutiveTunnelFailures = 0;
  }

  const flyDown = evaluation.problems.some((x) => x.key === "fly_down");
  if (flyDown) {
    state.consecutiveFlyFailures = prev.consecutiveFlyFailures + 1;
  } else if (!evaluation.networkUncertain) {
    state.consecutiveFlyFailures = 0;
  }

  const alert: Problem[] = [];
  for (const problem of evaluation.problems) {
    // The tunnel gets to fail a few times before it earns an email; repair
    // usually wins first, which is the entire point of the watchdog.
    if (
      problem.key === "tunnel_down" &&
      state.consecutiveTunnelFailures < TUNNEL_ALERT_AFTER
    ) {
      continue;
    }
    // Fly gets the same cushion. Before 2026-09-21 it had none, and one bad
    // cycle — usually this Mac's own Wi-Fi — mailed a CRITICAL claiming
    // clients were locked out of an app that was up the whole time.
    if (
      problem.key === "fly_down" &&
      state.consecutiveFlyFailures < FLY_ALERT_AFTER
    ) {
      continue;
    }
    // auth_off_locally is a leading indicator, not an incident. It is the
    // correct state on a Mac with no tunnel, so it never mails on its own —
    // it rides along only when something else is already being reported.
    if (problem.key === "auth_off_locally" && !evaluation.exposed) continue;
    // local_network_down is a statement about THIS Mac, and the coach can do
    // nothing about it from a phone. It exists to explain the silence in the
    // cron log — never to mail. (A Mac that is genuinely offline could not
    // send the mail anyway.)
    if (problem.key === "local_network_down") continue;

    const last = prev.lastAlertAt[problem.key];
    if (last) {
      const hours = (opts.now.getTime() - Date.parse(last)) / 3_600_000;
      // Unparseable timestamp → treat as never alerted rather than swallowing.
      if (Number.isFinite(hours) && hours < REALERT_AFTER_HOURS) continue;
    }
    alert.push(problem);
    state.lastAlertAt[problem.key] = opts.now.toISOString();
  }

  return { alert, state };
}

/** Everything is fine — used by the cron-runner quiet predicate and the route's
 *  response shape. */
export function isQuiet(evaluation: Evaluation, repaired: boolean): boolean {
  return evaluation.problems.length === 0 && !repaired;
}

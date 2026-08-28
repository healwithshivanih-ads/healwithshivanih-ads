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
}

export type Severity = "critical" | "warning";

export interface Problem {
  key: "tunnel_down" | "dashboard_exposed" | "auth_off_locally" | "fly_down";
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
 */
export function evaluate(p: ProbeSet): Evaluation {
  const problems: Problem[] = [];

  const tunnelUp = p.tunnelHealth.status === 200;
  // A coach route answering 200 in public = the wall is not there.
  const publiclyOpen = p.tunnelCoachRoute.status === 200;

  if (!tunnelUp) {
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

  if (p.flyHealth.status !== 200) {
    problems.push({
      key: "fly_down",
      severity: "critical",
      detail: `Fly health returned ${p.flyHealth.status ?? "no response"} (expected 200) — clients cannot open their forms or app`,
      fix: "flyctl status -a theochretree-coach   # then: flyctl machine restart <id> -a theochretree-coach",
    });
  }

  return {
    problems,
    // Only worth kickstarting when the tunnel is the thing that is down.
    tunnelNeedsRepair: !tunnelUp,
    exposed: publiclyOpen,
  };
}

/** Persisted between runs so escalation can count consecutive failures. */
export interface WatchdogState {
  /** Consecutive cycles in which the tunnel was down AFTER a repair attempt. */
  consecutiveTunnelFailures: number;
  /** ISO of the last alert email, per problem key — for re-alert throttling. */
  lastAlertAt: Record<string, string>;
}

export const EMPTY_STATE: WatchdogState = {
  consecutiveTunnelFailures: 0,
  lastAlertAt: {},
};

/** Escalate the tunnel only after this many consecutive failed repairs. At the
 *  5-minute schedule that is ~15 minutes of genuine outage — long enough that a
 *  transient blip or a Mac waking from sleep never mails, short enough that a
 *  real outage reaches her the same morning. */
export const TUNNEL_ALERT_AFTER = 3;

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
    lastAlertAt: { ...prev.lastAlertAt },
  };

  const tunnelDown = evaluation.problems.some((x) => x.key === "tunnel_down");
  if (tunnelDown && opts.repairAttempted) {
    state.consecutiveTunnelFailures = prev.consecutiveTunnelFailures + 1;
  } else if (!tunnelDown) {
    // Recovered — a later outage starts counting from zero, so one bad night
    // three weeks ago cannot push the next one straight to an alert.
    state.consecutiveTunnelFailures = 0;
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
    // auth_off_locally is a leading indicator, not an incident. It is the
    // correct state on a Mac with no tunnel, so it never mails on its own —
    // it rides along only when something else is already being reported.
    if (problem.key === "auth_off_locally" && !evaluation.exposed) continue;

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

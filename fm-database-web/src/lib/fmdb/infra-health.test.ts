/**
 * The watchdog's job is to REPAIR quietly and shout only when that fails.
 *
 * Both halves of that are easy to get wrong in opposite directions: a watchdog
 * that mails on every blip gets filtered into oblivion, and one that never mails
 * hides a three-week outage — which is exactly what happened on 2026-08-15,
 * when the tunnel had been dead since June and surfaced only when the coach
 * urgently needed it from away.
 *
 * Both failures have now actually happened here, one after the other: the June
 * silence, then the 28 Aug – 20 Sep 2026 run of daily false "clients cannot
 * open their forms" emails while Fly was up the entire time. So these tests
 * pin BOTH edges — the alert that must not fire, and the one that must.
 */
import { describe, it, expect } from "vitest";
import {
  decide,
  evaluate,
  EMPTY_STATE,
  isQuiet,
  FLY_ALERT_AFTER,
  REALERT_AFTER_HOURS,
  TUNNEL_ALERT_AFTER,
  type Evaluation,
  type ProbeSet,
  type WatchdogState,
} from "./infra-health";

/** All-healthy baseline: tunnel up, auth wall on, Fly up, Mac online. */
const healthy = (over: Partial<ProbeSet> = {}): ProbeSet => ({
  tunnelHealth: { status: 200 },
  tunnelCoachRoute: { status: 401 },
  localCoachRoute: { status: 401 },
  flyHealth: { status: 200 },
  internet: { status: 204 },
  ...over,
});

/** The Mac is off the internet: every outbound probe threw, including the
 *  neutral control. This is the 2026-09-20 22:15 shape. */
const offline = (over: Partial<ProbeSet> = {}): ProbeSet =>
  healthy({
    tunnelHealth: { status: null },
    tunnelCoachRoute: { status: null },
    flyHealth: { status: null },
    internet: { status: null },
    ...over,
  });

const keys = (p: Evaluation) => p.problems.map((x) => x.key).sort();

/** Feed the same evaluation through `n` cycles, threading state. */
function cycles(
  e: Evaluation,
  n: number,
  now: Date,
  start: WatchdogState = EMPTY_STATE,
  repairAttempted = false,
) {
  let last = decide(e, start, { repairAttempted, now });
  for (let i = 1; i < n; i++) {
    last = decide(e, last.state, { repairAttempted, now });
  }
  return last;
}

describe("evaluate — what counts as a problem", () => {
  it("a fully healthy system reports nothing", () => {
    const e = evaluate(healthy());
    expect(e.problems).toEqual([]);
    expect(e.tunnelNeedsRepair).toBe(false);
    expect(e.exposed).toBe(false);
    expect(e.networkUncertain).toBe(false);
    expect(isQuiet(e, false)).toBe(true);
  });

  it("THE 1033 CASE: no response from the tunnel is a repairable problem", () => {
    const e = evaluate(
      healthy({ tunnelHealth: { status: null }, tunnelCoachRoute: { status: null } }),
    );
    expect(keys(e)).toEqual(["tunnel_down"]);
    expect(e.tunnelNeedsRepair).toBe(true);
  });

  it("a 530 from Cloudflare is equally a tunnel problem", () => {
    const e = evaluate(healthy({ tunnelHealth: { status: 530 } }));
    expect(keys(e)).toContain("tunnel_down");
  });

  it("CRITICAL: a coach route answering 200 publicly is an exposure", () => {
    const e = evaluate(healthy({ tunnelCoachRoute: { status: 200 } }));
    expect(keys(e)).toContain("dashboard_exposed");
    expect(e.exposed).toBe(true);
    expect(e.problems.find((p) => p.key === "dashboard_exposed")?.severity).toBe("critical");
  });

  it("no auth locally is only a WARNING — that is the correct state without a tunnel", () => {
    const e = evaluate(healthy({ localCoachRoute: { status: 200 } }));
    const p = e.problems.find((x) => x.key === "auth_off_locally");
    expect(p?.severity).toBe("warning");
    // Crucially NOT flagged as an exposure: nothing is public yet.
    expect(e.exposed).toBe(false);
  });

  it("Fly being down is critical — clients cannot open their forms", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    expect(e.problems.find((p) => p.key === "fly_down")?.severity).toBe("critical");
  });

  it("a login redirect is not mistaken for an open dashboard", () => {
    // /m style 302 → not 200, so not an exposure.
    const e = evaluate(healthy({ tunnelCoachRoute: { status: 302 } }));
    expect(e.exposed).toBe(false);
    expect(keys(e)).toEqual([]);
  });

  it("every reportable problem carries a paste-able fix", () => {
    const e = evaluate({
      tunnelHealth: { status: null },
      tunnelCoachRoute: { status: 200 },
      localCoachRoute: { status: 200 },
      flyHealth: { status: 500 },
      internet: { status: 204 },
    });
    expect(e.problems).toHaveLength(4);
    for (const p of e.problems) expect(p.fix.length).toBeGreaterThan(0);
  });
});

describe("evaluate — an offline Mac is not a remote outage", () => {
  /**
   * THE 2026-09-20 CASE. Every probe leaves from the coach's Mac. When its
   * uplink drops, the tunnel (Mac → Cloudflare → Mac) and Fly (Mac →
   * Singapore) fail together, because the only thing they share is that
   * uplink. The watchdog used to call that "clients cannot open their forms".
   * Fly had not restarted since 13 Sep and its health check never stopped
   * passing.
   */
  it("reports NEITHER tunnel_down NOR fly_down when the control host is unreachable", () => {
    const e = evaluate(offline());
    expect(keys(e)).toEqual(["local_network_down"]);
    expect(e.networkUncertain).toBe(true);
  });

  it("does not kickstart the tunnel over our own dropped Wi-Fi", () => {
    expect(evaluate(offline()).tunnelNeedsRepair).toBe(false);
  });

  it("ANY answer from the control host proves the uplink — even a 500", () => {
    // The control tests our uplink, not the other end's health.
    const e = evaluate(offline({ internet: { status: 500 } }));
    expect(e.networkUncertain).toBe(false);
    expect(keys(e)).toEqual(["fly_down", "tunnel_down"]);
  });

  it("an exposure is still reported while offline — it needs no uplink to be true", () => {
    // A 200 is something we actually received; an offline Mac cannot invent one.
    const e = evaluate(offline({ tunnelCoachRoute: { status: 200 } }));
    expect(keys(e)).toContain("dashboard_exposed");
  });
});

describe("decide — repair first, escalate late", () => {
  const now = new Date("2026-08-15T06:00:00Z");

  it("a tunnel down for the first time does NOT email — repair gets its chance", () => {
    const e = evaluate(healthy({ tunnelHealth: { status: null } }));
    const d = decide(e, EMPTY_STATE, { repairAttempted: true, now });
    expect(d.alert).toEqual([]);
    expect(d.state.consecutiveTunnelFailures).toBe(1);
  });

  it("escalates once repair has failed TUNNEL_ALERT_AFTER times", () => {
    const e = evaluate(healthy({ tunnelHealth: { status: null } }));
    const last = cycles(e, TUNNEL_ALERT_AFTER, now, EMPTY_STATE, true);
    expect(last.state.consecutiveTunnelFailures).toBe(TUNNEL_ALERT_AFTER);
    expect(last.alert.map((p) => p.key)).toEqual(["tunnel_down"]);
  });

  it("a successful repair resets the counter, so one bad night doesn't prime the next", () => {
    const down = evaluate(healthy({ tunnelHealth: { status: null } }));
    const d1 = decide(down, EMPTY_STATE, { repairAttempted: true, now });
    expect(d1.state.consecutiveTunnelFailures).toBe(1);

    const up = evaluate(healthy());
    const d2 = decide(up, d1.state, { repairAttempted: false, now });
    expect(d2.state.consecutiveTunnelFailures).toBe(0);
    expect(d2.alert).toEqual([]);
  });

  it("EXPOSURE escalates on the very first sighting — no grace period", () => {
    const e = evaluate(healthy({ tunnelCoachRoute: { status: 200 } }));
    const d = decide(e, EMPTY_STATE, { repairAttempted: false, now });
    expect(d.alert.map((p) => p.key)).toContain("dashboard_exposed");
  });

  it("auth-off-locally alone never mails, but rides along with a real exposure", () => {
    const quiet = evaluate(healthy({ localCoachRoute: { status: 200 } }));
    expect(decide(quiet, EMPTY_STATE, { repairAttempted: false, now }).alert).toEqual([]);

    const loud = evaluate(
      healthy({ localCoachRoute: { status: 200 }, tunnelCoachRoute: { status: 200 } }),
    );
    expect(decide(loud, EMPTY_STATE, { repairAttempted: false, now }).alert.map((p) => p.key)).toEqual(
      ["dashboard_exposed", "auth_off_locally"],
    );
  });

  it("does not re-send the same alert within the re-alert window", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const first = cycles(e, FLY_ALERT_AFTER, now);
    expect(first.alert).toHaveLength(1);

    const soon = new Date(now.getTime() + (REALERT_AFTER_HOURS - 1) * 3_600_000);
    expect(decide(e, first.state, { repairAttempted: false, now: soon }).alert).toEqual([]);
  });

  it("nags again once the window passes — an unfixed problem must not go quiet forever", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const first = cycles(e, FLY_ALERT_AFTER, now);
    const later = new Date(now.getTime() + (REALERT_AFTER_HOURS + 1) * 3_600_000);
    expect(decide(e, first.state, { repairAttempted: false, now: later }).alert).toHaveLength(1);
  });

  it("a corrupt lastAlertAt is treated as never-alerted rather than swallowing the alert", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const state: WatchdogState = {
      consecutiveTunnelFailures: 0,
      consecutiveFlyFailures: FLY_ALERT_AFTER - 1,
      lastAlertAt: { fly_down: "not-a-date" },
    };
    expect(decide(e, state, { repairAttempted: false, now }).alert).toHaveLength(1);
  });

  it("a healthy cycle is quiet, but a repair is worth logging", () => {
    const e = evaluate(healthy());
    expect(isQuiet(e, false)).toBe(true);
    expect(isQuiet(e, true)).toBe(false);
  });
});

describe("decide — Fly gets the same cushion the tunnel has", () => {
  const now = new Date("2026-09-20T22:15:00Z");

  /**
   * THE REGRESSION. Before 2026-09-21, ONE cycle in which Fly did not answer
   * mailed a CRITICAL. Eleven such emails went out between 28 Aug and 20 Sep,
   * every one of them false — the only thing holding it to one a day was the
   * 24h re-alert throttle. An in-cycle retry (2026-09-08) did not help: three
   * attempts inside ~25 seconds is still ONE observation.
   */
  it("a single unreachable cycle does NOT email", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const d = decide(e, EMPTY_STATE, { repairAttempted: false, now });
    expect(d.alert).toEqual([]);
    expect(d.state.consecutiveFlyFailures).toBe(1);
  });

  it("escalates once Fly has been unreachable FLY_ALERT_AFTER cycles running", () => {
    // A real outage must still reach her — roughly a quarter hour at 5-min ticks.
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const last = cycles(e, FLY_ALERT_AFTER, now);
    expect(last.state.consecutiveFlyFailures).toBe(FLY_ALERT_AFTER);
    expect(last.alert.map((p) => p.key)).toEqual(["fly_down"]);
  });

  it("a 500 from Fly counts towards the same debounce as no answer at all", () => {
    const e = evaluate(healthy({ flyHealth: { status: 500 } }));
    expect(cycles(e, FLY_ALERT_AFTER - 1, now).alert).toEqual([]);
    expect(cycles(e, FLY_ALERT_AFTER, now).alert.map((p) => p.key)).toEqual(["fly_down"]);
  });

  it("Fly answering again clears the counter", () => {
    const down = evaluate(healthy({ flyHealth: { status: null } }));
    const d1 = cycles(down, FLY_ALERT_AFTER - 1, now);
    expect(d1.state.consecutiveFlyFailures).toBe(FLY_ALERT_AFTER - 1);

    const up = evaluate(healthy());
    expect(decide(up, d1.state, { repairAttempted: false, now }).state.consecutiveFlyFailures).toBe(0);
  });

  it("an OFFLINE cycle neither counts nor clears — it saw nothing", () => {
    // Clearing on an offline cycle would let a flapping uplink reset a real
    // outage's counter forever, which is the silent-failure direction.
    const down = evaluate(healthy({ flyHealth: { status: null } }));
    const d1 = cycles(down, FLY_ALERT_AFTER - 1, now);

    const blind = decide(evaluate(offline()), d1.state, { repairAttempted: false, now });
    expect(blind.alert).toEqual([]);
    expect(blind.state.consecutiveFlyFailures).toBe(FLY_ALERT_AFTER - 1);

    // The next cycle that can actually see Fly completes the escalation.
    const d3 = decide(down, blind.state, { repairAttempted: false, now });
    expect(d3.alert.map((p) => p.key)).toEqual(["fly_down"]);
  });

  it("THE 20 SEP EMAIL: an offline Mac mails nothing, however long it lasts", () => {
    const e = evaluate(offline());
    const last = cycles(e, 50, now);
    expect(last.alert).toEqual([]);
    expect(last.state.consecutiveFlyFailures).toBe(0);
    expect(last.state.consecutiveTunnelFailures).toBe(0);
  });

  it("local_network_down never becomes an email on its own", () => {
    const e = evaluate(offline());
    expect(keys(e)).toEqual(["local_network_down"]);
    expect(cycles(e, 10, now, EMPTY_STATE, true).alert).toEqual([]);
  });
});

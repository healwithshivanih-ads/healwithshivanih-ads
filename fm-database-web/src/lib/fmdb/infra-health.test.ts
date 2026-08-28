/**
 * The watchdog's job is to REPAIR quietly and shout only when that fails.
 *
 * Both halves of that are easy to get wrong in opposite directions: a watchdog
 * that mails on every blip gets filtered into oblivion, and one that never mails
 * hides a three-week outage — which is exactly what happened on 2026-08-15,
 * when the tunnel had been dead since June and surfaced only when the coach
 * urgently needed it from away.
 *
 * These pin the escalation rules.
 */
import { describe, it, expect } from "vitest";
import {
  decide,
  evaluate,
  EMPTY_STATE,
  isQuiet,
  REALERT_AFTER_HOURS,
  TUNNEL_ALERT_AFTER,
  type ProbeSet,
} from "./infra-health";

/** All-healthy baseline: tunnel up, auth wall on, Fly up. */
const healthy = (over: Partial<ProbeSet> = {}): ProbeSet => ({
  tunnelHealth: { status: 200 },
  tunnelCoachRoute: { status: 401 },
  localCoachRoute: { status: 401 },
  flyHealth: { status: 200 },
  ...over,
});

const keys = (p: ReturnType<typeof evaluate>) => p.problems.map((x) => x.key).sort();

describe("evaluate — what counts as a problem", () => {
  it("a fully healthy system reports nothing", () => {
    const e = evaluate(healthy());
    expect(e.problems).toEqual([]);
    expect(e.tunnelNeedsRepair).toBe(false);
    expect(e.exposed).toBe(false);
    expect(isQuiet(e, false)).toBe(true);
  });

  it("THE 1033 CASE: no response from the tunnel is a repairable problem", () => {
    const e = evaluate(healthy({ tunnelHealth: { status: null }, tunnelCoachRoute: { status: null } }));
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

  it("every problem carries a paste-able fix", () => {
    const e = evaluate({
      tunnelHealth: { status: null },
      tunnelCoachRoute: { status: 200 },
      localCoachRoute: { status: 200 },
      flyHealth: { status: 500 },
    });
    expect(e.problems).toHaveLength(4);
    for (const p of e.problems) expect(p.fix.length).toBeGreaterThan(0);
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
    let state = EMPTY_STATE;
    let last = decide(e, state, { repairAttempted: true, now });
    for (let i = 1; i < TUNNEL_ALERT_AFTER; i++) {
      state = last.state;
      last = decide(e, state, { repairAttempted: true, now });
    }
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
    const first = decide(e, EMPTY_STATE, { repairAttempted: false, now });
    expect(first.alert).toHaveLength(1);

    const soon = new Date(now.getTime() + (REALERT_AFTER_HOURS - 1) * 3_600_000);
    expect(decide(e, first.state, { repairAttempted: false, now: soon }).alert).toEqual([]);
  });

  it("nags again once the window passes — an unfixed problem must not go quiet forever", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const first = decide(e, EMPTY_STATE, { repairAttempted: false, now });
    const later = new Date(now.getTime() + (REALERT_AFTER_HOURS + 1) * 3_600_000);
    expect(decide(e, first.state, { repairAttempted: false, now: later }).alert).toHaveLength(1);
  });

  it("a corrupt lastAlertAt is treated as never-alerted rather than swallowing the alert", () => {
    const e = evaluate(healthy({ flyHealth: { status: null } }));
    const state = { consecutiveTunnelFailures: 0, lastAlertAt: { fly_down: "not-a-date" } };
    expect(decide(e, state, { repairAttempted: false, now }).alert).toHaveLength(1);
  });

  it("a healthy cycle is quiet, but a repair is worth logging", () => {
    const e = evaluate(healthy());
    expect(isQuiet(e, false)).toBe(true);
    expect(isQuiet(e, true)).toBe(false);
  });
});

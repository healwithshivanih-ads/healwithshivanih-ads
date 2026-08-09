/**
 * Tests for buildEndgame — the wrapper that turns resolveAppMode's verdict into
 * what the end-game screens actually render.
 *
 * resolveAppMode itself is covered by app-mode.test.ts. What was NOT covered is
 * everything buildEndgame layers ON TOP, and that layer is the money-adjacent
 * one: which maintenance offers appear, whose payment date wins, and when the
 * renewal nudge fires. Getting `pricing` wrong either offers a product to
 * someone it isn't for, or hides it from someone ready to buy.
 */
import { describe, it, expect } from "vitest";
import { buildEndgame } from "./client-app";
import { GRACE_DAYS, REVIEW_LEAD_DAYS, SHORT_PLAN_MAX_WEEKS } from "./app-mode";

/** A plan whose 12-week window has already closed, so we land past ACTIVE. */
const gradPlan = {
  plan_period_start: "2026-01-01",
  plan_period_weeks: 12,
  meal_plan_started_on: "2026-01-01",
} as never;

const TODAY = "2026-08-09";

describe("buildEndgame — which payment date wins", () => {
  it("takes the LATER of client.yaml and a fresh PAID record", () => {
    // The record exists so a payment shows up before the Mac reconcile has
    // written it back to client.yaml.
    const r = buildEndgame(
      { maintenance_status: "active", maintenance_paid_through: "2026-09-01" },
      gradPlan,
      TODAY,
      null,
      "2026-12-01",
    );
    expect(r.endgame?.paidThrough).toBe("2026-12-01");
  });

  it("keeps client.yaml when it is the later of the two", () => {
    const r = buildEndgame(
      { maintenance_status: "active", maintenance_paid_through: "2026-12-01" },
      gradPlan,
      TODAY,
      null,
      "2026-09-01",
    );
    expect(r.endgame?.paidThrough).toBe("2026-12-01");
  });

  it("works with only one of the two present", () => {
    const fromRecord = buildEndgame(
      { maintenance_status: "active" },
      gradPlan,
      TODAY,
      null,
      "2026-12-01",
    );
    expect(fromRecord.endgame?.paidThrough).toBe("2026-12-01");

    const fromYaml = buildEndgame(
      { maintenance_status: "active", maintenance_paid_through: "2026-12-01" },
      gradPlan,
      TODAY,
    );
    expect(fromYaml.endgame?.paidThrough).toBe("2026-12-01");
  });
});

describe("buildEndgame — the short-engagement gate", () => {
  const shortPlan = { ...(gradPlan as object), plan_period_weeks: SHORT_PLAN_MAX_WEEKS } as never;
  const longPlan = { ...(gradPlan as object), plan_period_weeks: 12 } as never;

  it("withholds the maintenance offer from a short engagement", () => {
    // Maintenance is a post-full-programme product; offering it here undercuts
    // the continue-to-the-full-programme conversation (coach, 2026-07-07).
    const r = buildEndgame({}, shortPlan, TODAY);
    expect(r.endgame?.shortEngagement).toBe(true);
    expect(r.endgame?.pricing).toEqual([]);
    expect(r.endgame?.subscriptionOffer).toBeNull();
  });

  it("still offers renewal to a short-engagement client ALREADY on maintenance", () => {
    const r = buildEndgame(
      { maintenance_status: "active", maintenance_paid_through: "2026-12-01" },
      shortPlan,
      TODAY,
    );
    expect(r.endgame?.shortEngagement).toBe(true);
    expect(r.endgame!.pricing.length).toBeGreaterThan(0);
  });

  it("offers maintenance normally after a full programme", () => {
    const r = buildEndgame({}, longPlan, TODAY);
    expect(r.endgame?.shortEngagement).toBe(false);
    expect(r.endgame!.pricing.length).toBeGreaterThan(0);
  });

  it("keeps a client with an unusable plan length ACTIVE rather than guessing", () => {
    // No usable length → no recheck date → nothing to graduate to. The
    // fail-safe direction is right: a malformed plan leaves the client with
    // full access, rather than prematurely showing them a finish line and a
    // maintenance price.
    for (const weeks of [undefined, 0, "abc"]) {
      const p = { ...(gradPlan as object), plan_period_weeks: weeks } as never;
      const r = buildEndgame({}, p, TODAY);
      expect(r.mode, String(weeks)).toBe("ACTIVE");
      expect(r.endgame, String(weeks)).toBeNull();
    }
  });
});

describe("buildEndgame — the subscription offer is env-gated", () => {
  it("is null when no Razorpay plan is configured", () => {
    expect(buildEndgame({}, gradPlan, TODAY).endgame?.subscriptionOffer).toBeNull();
  });

  it("appears with the server-fixed price when available", () => {
    const r = buildEndgame({}, gradPlan, TODAY, null, null, {
      available: true,
      inr: 6000,
      active: false,
    });
    expect(r.endgame?.subscriptionOffer).toEqual({ intervalMonths: 3, inr: 6000 });
  });

  it("reports an already-live subscription so the UI stops re-offering it", () => {
    const r = buildEndgame({}, gradPlan, TODAY, null, null, {
      available: true,
      inr: 6000,
      active: true,
    });
    expect(r.endgame?.subscriptionActive).toBe(true);
  });
});

describe("buildEndgame — the renewal nudge window", () => {
  const addDays = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it("fires when coverage runs out inside the lead window", () => {
    const r = buildEndgame(
      {
        maintenance_status: "active",
        maintenance_paid_through: addDays(TODAY, REVIEW_LEAD_DAYS - 1),
      },
      gradPlan,
      TODAY,
    );
    expect(r.mode).toBe("MAINTENANCE");
    expect(r.endgame?.renewalDueLabel).toBeTruthy();
  });

  it("stays quiet while coverage is comfortably ahead", () => {
    const r = buildEndgame(
      {
        maintenance_status: "active",
        maintenance_paid_through: addDays(TODAY, REVIEW_LEAD_DAYS + 30),
      },
      gradPlan,
      TODAY,
    );
    expect(r.endgame?.renewalDueLabel).toBeNull();
  });
});

describe("buildEndgame — ACTIVE short-circuits", () => {
  it("returns no endgame at all for a client mid-protocol", () => {
    const running = {
      plan_period_start: TODAY,
      plan_period_weeks: 12,
      meal_plan_started_on: TODAY,
    } as never;
    const r = buildEndgame({}, running, TODAY);
    expect(r.mode).toBe("ACTIVE");
    expect(r.endgame).toBeNull();
  });
});

describe("buildEndgame — grace window", () => {
  it("labels the last day of full access GRACE_DAYS after coverage ends", () => {
    const lapsed = "2026-08-01"; // before TODAY → lapsed into GRACE
    const r = buildEndgame(
      { maintenance_status: "active", maintenance_paid_through: lapsed },
      gradPlan,
      TODAY,
    );
    if (r.mode === "GRACE") {
      expect(r.endgame?.graceUntilLabel).toBeTruthy();
      expect(GRACE_DAYS).toBeGreaterThan(0);
    } else {
      // Mode resolution is app-mode.test.ts' business; only assert the
      // invariant that a non-GRACE mode carries no grace label.
      expect(r.endgame?.graceUntilLabel).toBeNull();
    }
  });
});

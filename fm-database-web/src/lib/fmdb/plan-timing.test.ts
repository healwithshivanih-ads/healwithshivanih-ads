/**
 * Tests for the centralized plan-start resolver (plan-timing.ts).
 *
 * The whole point: the client app's Day-1/week counter and the coach's retest
 * dates must derive from ONE anchor so they can't drift. These tests pin the
 * priority chain and the cross-surface agreement.
 */
import { describe, it, expect } from "vitest";
import {
  effectivePlanStart,
  effectiveMealPlanStart,
  effectiveRecheckDate,
  travelExtensionDays,
  type PlanLike,
  type TravelOverrideLike,
} from "./plan-timing";

describe("effectivePlanStart priority chain", () => {
  it("1. confirmed meal start wins over everything", () => {
    const plan: PlanLike = {
      meal_plan_started_on: "2026-05-10",
      supplements_started_on: "2026-05-01",
      plan_period_start: "2026-04-01",
    };
    expect(effectivePlanStart(plan, { letterSentYmd: "2026-04-02" })).toBe("2026-05-10");
  });

  it("2. supplements start when meal unconfirmed", () => {
    const plan: PlanLike = { supplements_started_on: "2026-05-03", plan_period_start: "2026-04-01" };
    expect(effectivePlanStart(plan, { letterSentYmd: "2026-04-02" })).toBe("2026-05-03");
  });

  it("3. letter-sent + 3-day adoption lag when no confirmed start", () => {
    const plan: PlanLike = { plan_period_start: "2026-04-01" };
    expect(effectivePlanStart(plan, { letterSentYmd: "2026-05-01" })).toBe("2026-05-04");
  });

  it("4. plan_period_start + 3 as the last-resort floor", () => {
    const plan: PlanLike = { plan_period_start: "2026-04-01" };
    expect(effectivePlanStart(plan)).toBe("2026-04-04");
  });

  it("returns null when nothing is known", () => {
    expect(effectivePlanStart({})).toBeNull();
  });
});

describe("cross-surface agreement (the anti-drift guarantee)", () => {
  it("client anchor and coach anchor MATCH on a confirmed plan", () => {
    // The normal active case — both must read the same locked Day 1.
    const plan: PlanLike = { meal_plan_started_on: "2026-05-10", plan_period_start: "2026-04-01" };
    expect(effectiveMealPlanStart(plan)).toBe(effectivePlanStart(plan, { letterSentYmd: "2026-04-05" }));
  });

  it("client and coach share the same plan_period+3 floor when unconfirmed and no letter", () => {
    const plan: PlanLike = { plan_period_start: "2026-04-01" };
    expect(effectiveMealPlanStart(plan)).toBe(effectivePlanStart(plan));
    expect(effectiveMealPlanStart(plan)).toBe("2026-04-04");
  });

  it("effectiveMealPlanStart ignores the letter signal it cannot see (stays on the floor)", () => {
    // The client app passes no letterSentYmd; it must not invent one.
    const plan: PlanLike = { plan_period_start: "2026-04-01" };
    expect(effectiveMealPlanStart(plan)).toBe("2026-04-04");
  });
});

describe("effectiveRecheckDate has exactly one adoption lag", () => {
  it("recheck = effective start + weeks×7 (no second +3)", () => {
    const plan: PlanLike = { plan_period_start: "2026-04-01", plan_period_weeks: 12 };
    // start = 2026-04-04 (period + 3); recheck = + 84 days = 2026-06-27
    expect(effectiveMealPlanStart(plan)).toBe("2026-04-04");
    expect(effectiveRecheckDate(plan)).toBe("2026-06-27");
  });

  it("confirmed start drives recheck directly", () => {
    const plan: PlanLike = { meal_plan_started_on: "2026-05-01", plan_period_weeks: 12 };
    expect(effectiveRecheckDate(plan)).toBe("2026-07-24"); // +84d
  });
});

describe("travel extension (coach 2026-07-05)", () => {
  // 12-week plan from May 1 → base recheck Jul 24.
  const plan: PlanLike = { meal_plan_started_on: "2026-05-01", plan_period_weeks: 12 };
  const trip = (date_from: string, date_to: string, extra: Partial<TravelOverrideLike> = {}): TravelOverrideLike => ({
    date_from,
    date_to,
    mode: "maintenance",
    context: "travel",
    ...extra,
  });

  it("no overrides → recheck unchanged (back-compat)", () => {
    expect(effectiveRecheckDate(plan, {})).toBe("2026-07-24");
    expect(effectiveRecheckDate(plan, { overrides: [] })).toBe("2026-07-24");
  });

  it("a 2-week travel window pushes recheck out by exactly its days (inclusive)", () => {
    // Jun 23–Jul 7 inclusive = 15 days → capped at 14. Dhanishta's real trip.
    const ov = [trip("2026-06-23", "2026-07-07")];
    expect(travelExtensionDays(ov, "2026-05-01", "2026-07-24")).toBe(14); // capped
    expect(effectiveRecheckDate(plan, { overrides: ov })).toBe("2026-08-07"); // Jul 24 + 14
  });

  it("a clean 10-day trip extends by 10, not capped", () => {
    const ov = [trip("2026-06-01", "2026-06-10")]; // 10 days inclusive
    expect(travelExtensionDays(ov, "2026-05-01", "2026-07-24")).toBe(10);
    expect(effectiveRecheckDate(plan, { overrides: ov })).toBe("2026-08-03");
  });

  it("total pause is capped at 14 days across multiple windows", () => {
    const ov = [trip("2026-05-05", "2026-05-18"), trip("2026-06-01", "2026-06-14")]; // 14 + 14
    expect(travelExtensionDays(ov, "2026-05-01", "2026-07-24")).toBe(14);
    expect(effectiveRecheckDate(plan, { overrides: ov })).toBe("2026-08-07");
  });

  it("deeper_deficit and festival do NOT extend", () => {
    const ov = [
      trip("2026-06-01", "2026-06-10", { mode: "deeper_deficit" }),
      trip("2026-06-15", "2026-06-18", { context: "festival" }),
    ];
    expect(travelExtensionDays(ov, "2026-05-01", "2026-07-24")).toBe(0);
    expect(effectiveRecheckDate(plan, { overrides: ov })).toBe("2026-07-24");
  });

  it("illness with maintenance extends", () => {
    const ov = [trip("2026-06-01", "2026-06-05", { context: "illness" })]; // 5 days
    expect(effectiveRecheckDate(plan, { overrides: ov })).toBe("2026-07-29");
  });

  it("cancelled windows are ignored", () => {
    const ov = [trip("2026-06-01", "2026-06-10", { cancelled: true })];
    expect(travelExtensionDays(ov, "2026-05-01", "2026-07-24")).toBe(0);
  });

  it("weight-loss buffer holds the weigh-in ≥6d past the last return", () => {
    // A 5-day trip ending Jul 22 (near the Jul 24 base recheck). Extension = 5
    // → Jul 29. But return + 6 = Jul 28, which is < Jul 29, so no further shift.
    const ov = [trip("2026-07-18", "2026-07-22")];
    expect(effectiveRecheckDate(plan, { overrides: ov, weightLossEnabled: true })).toBe("2026-07-29");
    // A 2-day trip ending Jul 23: extension = 2 → Jul 26; but return + 6 = Jul 29
    // wins because the weigh-in would otherwise land 3d after a return.
    const ov2 = [trip("2026-07-22", "2026-07-23")];
    expect(effectiveRecheckDate(plan, { overrides: ov2 })).toBe("2026-07-26"); // no buffer
    expect(effectiveRecheckDate(plan, { overrides: ov2, weightLossEnabled: true })).toBe("2026-07-29"); // buffered
  });
});

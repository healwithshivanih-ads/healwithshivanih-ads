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
  type PlanLike,
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

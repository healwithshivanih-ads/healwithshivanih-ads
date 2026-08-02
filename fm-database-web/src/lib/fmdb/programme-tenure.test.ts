import { describe, it, expect } from "vitest";
import {
  buildTenure,
  supersedeChain,
  phaseNumberFromSlug,
  type TenurePlanLike,
} from "./programme-tenure";

/** Nidhi Jain's real chain, the case that prompted this module.
 *  plan-2 was her FIRST plan (no plan-1 exists on disk) — which is exactly why
 *  phase number reads the slug rather than counting the chain. */
const NIDHI_P2: TenurePlanLike = {
  slug: "nidhi-plan-2-2026-05-15-nidhi-jain",
  supersedes: null,
  plan_period_start: "2026-05-15",
  meal_plan_started_on: "2026-05-15",
  plan_period_weeks: 12,
};
const NIDHI_P3: TenurePlanLike = {
  slug: "nidhi-plan-3-2026-08-01-nidhi-jain",
  supersedes: "nidhi-plan-2-2026-05-15-nidhi-jain",
  plan_period_start: "2026-08-13",
  meal_plan_started_on: "2026-08-13",
  plan_period_weeks: 12,
};
/** Her 5-day Manali pause, 23–27 May — a genuine travel override. */
const MANALI = {
  overrides: [
    { date_from: "2026-05-23", date_to: "2026-05-27", context: "travel", mode: "maintenance" },
  ],
  weightLossEnabled: true,
};

describe("phaseNumberFromSlug", () => {
  it("reads the coach's own numbering", () => {
    expect(phaseNumberFromSlug("nidhi-plan-3-2026-08-01-nidhi-jain")).toBe(3);
    expect(phaseNumberFromSlug("hariharan-plan-5-2026-06-10-cl-005")).toBe(5);
  });

  it("returns null for slugs that carry no phase number", () => {
    expect(phaseNumberFromSlug("cl-005-2026-05-05-assess-2")).toBeNull();
    expect(phaseNumberFromSlug("firstname-maintenance-2026-08-01-cl-006")).toBeNull();
    expect(phaseNumberFromSlug(undefined)).toBeNull();
  });
});

describe("supersedeChain", () => {
  it("walks back to the earliest ancestor, oldest first", () => {
    const chain = supersedeChain(NIDHI_P3, [NIDHI_P3, NIDHI_P2]);
    expect(chain.map((p) => p.slug)).toEqual([NIDHI_P2.slug, NIDHI_P3.slug]);
  });

  it("stops cleanly when the predecessor is missing from disk", () => {
    const orphan: TenurePlanLike = { slug: "x-plan-2-a", supersedes: "x-plan-1-a" };
    expect(supersedeChain(orphan, [orphan]).map((p) => p.slug)).toEqual(["x-plan-2-a"]);
  });

  it("cannot loop forever on a cycle", () => {
    const a: TenurePlanLike = { slug: "a", supersedes: "b" };
    const b: TenurePlanLike = { slug: "b", supersedes: "a" };
    expect(supersedeChain(a, [a, b]).length).toBe(2);
  });
});

describe("buildTenure — a continuing client", () => {
  const plans = [NIDHI_P3, NIDHI_P2];

  it("counts tenure across phases, not from the current plan", () => {
    // 2 Aug: phase 3 has not started (13 Aug). Phase 2 ran 15 May → today =
    // 79 days, minus the 5 paused = 74 → week 11. The old per-plan maths on
    // the NEW plan would have said week 1.
    const t = buildTenure(NIDHI_P3, plans, "2026-08-02", MANALI);
    expect(t.weeksWithCoach).toBe(11);
    expect(t.weekOfPhase).toBe(1);
    expect(t.continued).toBe(true);
    expect(t.phaseNumber).toBe(3);
    expect(t.chainLength).toBe(2);
    expect(t.firstStartYmd).toBe("2026-05-15");
    expect(t.totalWeeksWithCoach).toBe(24);
  });

  it("keeps climbing once the new phase begins — this is the tree fix", () => {
    // Day 1 of phase 3. Tenure must NOT fall back to 1; that reset is what
    // turned a fruiting tree into a sapling.
    const t = buildTenure(NIDHI_P3, plans, "2026-08-13", MANALI);
    expect(t.weekOfPhase).toBe(1);
    expect(t.weeksWithCoach).toBeGreaterThanOrEqual(13);
  });

  it("subtracts the travel pause it was given", () => {
    const withPause = buildTenure(NIDHI_P3, plans, "2026-08-02", MANALI);
    const withoutPause = buildTenure(NIDHI_P3, plans, "2026-08-02", {});
    expect(withoutPause.weeksWithCoach).toBeGreaterThan(withPause.weeksWithCoach);
  });

  it("does not count a gap between phases as time with the coach", () => {
    // Same two phases, but phase 3 starts three months after phase 2's window.
    const late: TenurePlanLike = { ...NIDHI_P3, plan_period_start: "2026-11-13", meal_plan_started_on: "2026-11-13" };
    const gap = buildTenure(late, [late, NIDHI_P2], "2026-11-20", MANALI);
    const contiguous = buildTenure(NIDHI_P3, plans, "2026-11-20", MANALI);
    // The gap client has been ON a protocol for less time despite the same date.
    expect(gap.weeksWithCoach).toBeLessThan(contiguous.weeksWithCoach);
  });

  it("never exceeds the summed plan length", () => {
    const t = buildTenure(NIDHI_P3, plans, "2030-01-01", MANALI);
    expect(t.weeksWithCoach).toBe(t.totalWeeksWithCoach);
  });
});

describe("buildTenure — a first-time client is untouched", () => {
  it("reads as phase 1, not continued, tenure == week of phase", () => {
    const t = buildTenure(NIDHI_P2, [NIDHI_P2], "2026-06-05", MANALI);
    expect(t.continued).toBe(false);
    expect(t.chainLength).toBe(1);
    expect(t.weeksWithCoach).toBe(t.weekOfPhase);
    expect(t.totalWeeksWithCoach).toBe(12);
  });

  it("falls back to chain length when the slug carries no number", () => {
    const p: TenurePlanLike = {
      slug: "someone-maintenance-2026-08-01-cl-009",
      supersedes: "someone-plan-1-2026-01-01-cl-009",
      plan_period_start: "2026-08-01",
      plan_period_weeks: 26,
    };
    const prior: TenurePlanLike = {
      slug: "someone-plan-1-2026-01-01-cl-009",
      supersedes: null,
      plan_period_start: "2026-01-01",
      plan_period_weeks: 12,
    };
    const t = buildTenure(p, [p, prior], "2026-08-10");
    expect(t.phaseNumber).toBe(2); // chain length, since the slug has no -plan-N-
    expect(t.continued).toBe(true);
  });

  it("degrades safely with no plan at all", () => {
    const t = buildTenure(null, [], "2026-08-02");
    expect(t.continued).toBe(false);
    expect(t.chainLength).toBe(0);
    expect(t.weeksWithCoach).toBe(1);
  });
});

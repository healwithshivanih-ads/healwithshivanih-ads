import { describe, it, expect } from "vitest";
import {
  resolveAppMode,
  reviewLeadDays,
  GRACE_DAYS,
  REVIEW_LEAD_DAYS,
  REVIEW_LEAD_DAYS_SHORT,
  SHORT_PLAN_MAX_WEEKS,
} from "./app-mode";

const TODAY = "2026-06-15";

// Helper: a published plan whose effective recheck lands `daysOut` from TODAY.
// effective recheck = effective_meal_plan_start + weeks*7; with meal_plan_started_on
// set explicitly we get a deterministic recheck = started_on + weeks*7.
function planWithRecheck(daysOut: number, extra: Record<string, unknown> = {}) {
  const weeks = 12;
  const started = addDays(TODAY, daysOut - weeks * 7); // recheck = started + 84d
  return {
    plan_period_start: started,
    plan_period_weeks: weeks,
    meal_plan_started_on: started,
    status: "published",
    ...extra,
  };
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("resolveAppMode — plan window (no maintenance)", () => {
  it("ACTIVE when recheck is comfortably in the future", () => {
    expect(resolveAppMode({ plan: planWithRecheck(60) }, TODAY).mode).toBe("ACTIVE");
  });

  it("ACTIVE just outside the review lead window", () => {
    expect(resolveAppMode({ plan: planWithRecheck(REVIEW_LEAD_DAYS + 1) }, TODAY).mode).toBe("ACTIVE");
  });

  it("REVIEW exactly at the review lead boundary", () => {
    expect(resolveAppMode({ plan: planWithRecheck(REVIEW_LEAD_DAYS) }, TODAY).mode).toBe("REVIEW");
  });

  it("REVIEW when recheck has recently passed (inside grace)", () => {
    expect(resolveAppMode({ plan: planWithRecheck(-10) }, TODAY).mode).toBe("REVIEW");
  });

  it("REVIEW exactly at the grace boundary (recheck + 15d)", () => {
    expect(resolveAppMode({ plan: planWithRecheck(-GRACE_DAYS) }, TODAY).mode).toBe("REVIEW");
  });

  it("LIBRARY one day past the review grace (recheck + 16d, no decision)", () => {
    expect(resolveAppMode({ plan: planWithRecheck(-(GRACE_DAYS + 1)) }, TODAY).mode).toBe("LIBRARY");
  });

  it("ACTIVE with continued=true when plan supersedes a prior one", () => {
    const r = resolveAppMode({ plan: planWithRecheck(60, { supersedes: "old-slug" }) }, TODAY);
    expect(r.mode).toBe("ACTIVE");
    expect(r.continued).toBe(true);
  });

  it("ACTIVE (not REVIEW) when dates are missing and recheck can't be computed", () => {
    expect(resolveAppMode({ plan: { status: "published" } }, TODAY).mode).toBe("ACTIVE");
  });

  it("LIBRARY when there is no plan and no maintenance", () => {
    expect(resolveAppMode({}, TODAY).mode).toBe("LIBRARY");
  });
});

describe("resolveAppMode — maintenance track (keys off paid_through)", () => {
  it("MAINTENANCE when paid_through is today (>= today)", () => {
    expect(resolveAppMode({ maintenance_status: "active", maintenance_paid_through: TODAY }, TODAY).mode).toBe("MAINTENANCE");
  });

  it("MAINTENANCE when paid_through is in the future", () => {
    expect(resolveAppMode({ maintenance_paid_through: addDays(TODAY, 30) }, TODAY).mode).toBe("MAINTENANCE");
  });

  it("GRACE the day after paid_through", () => {
    expect(resolveAppMode({ maintenance_status: "lapsed", maintenance_paid_through: addDays(TODAY, -1) }, TODAY).mode).toBe("GRACE");
  });

  it("GRACE exactly at the grace boundary (paid_through + 15d)", () => {
    expect(resolveAppMode({ maintenance_paid_through: addDays(TODAY, -GRACE_DAYS) }, TODAY).mode).toBe("GRACE");
  });

  it("LIBRARY one day past grace (paid_through + 16d)", () => {
    expect(resolveAppMode({ maintenance_paid_through: addDays(TODAY, -(GRACE_DAYS + 1)) }, TODAY).mode).toBe("LIBRARY");
  });

  it("maintenance overrides the plan window (active maintenance + passed plan recheck → MAINTENANCE)", () => {
    const r = resolveAppMode(
      { maintenance_paid_through: addDays(TODAY, 100), plan: planWithRecheck(-30) },
      TODAY,
    );
    expect(r.mode).toBe("MAINTENANCE");
  });

  it("status active but no paid_through → MAINTENANCE (fail safe to access)", () => {
    expect(resolveAppMode({ maintenance_status: "active" }, TODAY).mode).toBe("MAINTENANCE");
  });

  it("status lapsed but no paid_through → LIBRARY", () => {
    expect(resolveAppMode({ maintenance_status: "lapsed" }, TODAY).mode).toBe("LIBRARY");
  });
});

// Short-engagement plans (≤ SHORT_PLAN_MAX_WEEKS) get a 7-day REVIEW lead so
// graduation copy doesn't appear at the halfway mark of a 4-week programme.
describe("resolveAppMode — short-engagement review lead", () => {
  // recheck = started + weeks*7, so back-date the start to land it `daysOut` away.
  function shortPlan(daysOut: number, weeks: number) {
    const started = addDays(TODAY, daysOut - weeks * 7);
    return {
      plan_period_start: started,
      plan_period_weeks: weeks,
      meal_plan_started_on: started,
      status: "published",
    };
  }

  it("reviewLeadDays: short plans → 7, standard plans / missing weeks → 14", () => {
    expect(reviewLeadDays({ plan_period_weeks: 4 })).toBe(REVIEW_LEAD_DAYS_SHORT);
    expect(reviewLeadDays({ plan_period_weeks: SHORT_PLAN_MAX_WEEKS })).toBe(REVIEW_LEAD_DAYS_SHORT);
    expect(reviewLeadDays({ plan_period_weeks: SHORT_PLAN_MAX_WEEKS + 1 })).toBe(REVIEW_LEAD_DAYS);
    expect(reviewLeadDays({ plan_period_weeks: 12 })).toBe(REVIEW_LEAD_DAYS);
    expect(reviewLeadDays({})).toBe(REVIEW_LEAD_DAYS);
    expect(reviewLeadDays(null)).toBe(REVIEW_LEAD_DAYS);
  });

  it("4-week plan stays ACTIVE inside days 8–13 before recheck (where a 12-week plan is already REVIEW)", () => {
    expect(resolveAppMode({ plan: shortPlan(REVIEW_LEAD_DAYS_SHORT + 1, 4) }, TODAY).mode).toBe("ACTIVE");
    expect(resolveAppMode({ plan: shortPlan(REVIEW_LEAD_DAYS, 4) }, TODAY).mode).toBe("ACTIVE");
  });

  it("4-week plan flips to REVIEW exactly 7 days before recheck", () => {
    expect(resolveAppMode({ plan: shortPlan(REVIEW_LEAD_DAYS_SHORT, 4) }, TODAY).mode).toBe("REVIEW");
  });

  it("7-week plan keeps the standard 14-day lead", () => {
    expect(resolveAppMode({ plan: shortPlan(REVIEW_LEAD_DAYS, 7) }, TODAY).mode).toBe("REVIEW");
  });

  it("short plan still degrades to LIBRARY past recheck + grace", () => {
    expect(resolveAppMode({ plan: shortPlan(-(GRACE_DAYS + 1), 4) }, TODAY).mode).toBe("LIBRARY");
  });
});

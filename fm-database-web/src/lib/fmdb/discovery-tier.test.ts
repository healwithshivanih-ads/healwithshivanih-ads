import { describe, it, expect } from "vitest";
import {
  resolveAppTier,
  resolveDiscoveryCredit,
  resolveDiscoveryStage,
  DISCOVERY_CREDIT_WINDOW_DAYS,
  type DiscoveryStageInput,
} from "./discovery-tier";

const CALL = "2026-06-25"; // discovery call date used across the credit tests

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("resolveAppTier — tier split", () => {
  it("package when signed up (even with no plan yet — enrol→build gap)", () => {
    const r = resolveAppTier({ engagementStatus: "signed_up", hasPublishedPlan: false }, "2026-06-25");
    expect(r.tier).toBe("package");
    expect(r.credit).toBeNull();
  });

  it("package when a published plan exists", () => {
    const r = resolveAppTier({ engagementStatus: "pending", hasPublishedPlan: true }, "2026-06-25");
    expect(r.tier).toBe("package");
    expect(r.credit).toBeNull();
  });

  it("discovery when neither signed up nor planned", () => {
    const r = resolveAppTier(
      { engagementStatus: "pending", hasPublishedPlan: false, discoveryCallDate: CALL },
      CALL,
    );
    expect(r.tier).toBe("discovery");
    expect(r.credit).not.toBeNull();
  });

  it("signed_up wins even if a discovery call date is still on file", () => {
    const r = resolveAppTier(
      { engagementStatus: "signed_up", discoveryCallDate: CALL },
      addDays(CALL, 30),
    );
    expect(r.tier).toBe("package");
  });
});

describe("resolveDiscoveryStage — recommendations gate on the call (after labs)", () => {
  const base: DiscoveryStageInput = {
    intakeSubmitted: false,
    hasRecommendedOrder: false,
    hasActiveOrder: false,
    hasResults: false,
    callDone: false,
  };
  const stage = (over: Partial<DiscoveryStageInput>) => resolveDiscoveryStage({ ...base, ...over });

  it("nothing yet → onboard_intake", () => {
    expect(stage({})).toBe("onboard_intake");
  });
  it("intake done, no labs recommended → awaiting_recommendation", () => {
    expect(stage({ intakeSubmitted: true })).toBe("awaiting_recommendation");
  });
  it("labs recommended (unpaid) → book_labs", () => {
    expect(stage({ intakeSubmitted: true, hasRecommendedOrder: true })).toBe("book_labs");
  });
  it("sample booked/paid, no results → awaiting_results", () => {
    expect(stage({ intakeSubmitted: true, hasActiveOrder: true })).toBe("awaiting_results");
  });
  it("results in, call not marked → awaiting_call (still NO recommendations)", () => {
    expect(stage({ intakeSubmitted: true, hasResults: true })).toBe("awaiting_call");
  });
  it("call done → post_call (recommendations + countdown)", () => {
    expect(stage({ intakeSubmitted: true, hasResults: true, callDone: true })).toBe("post_call");
  });
  it("callDone always wins, even if other signals are mid-flight", () => {
    expect(stage({ callDone: true, hasRecommendedOrder: true })).toBe("post_call");
  });
});

describe("resolveDiscoveryCredit — the 15-day window", () => {
  it("credit_live on the call day, full window remaining", () => {
    const c = resolveDiscoveryCredit(CALL, CALL);
    expect(c.state).toBe("credit_live");
    expect(c.expiresOn).toBe(addDays(CALL, DISCOVERY_CREDIT_WINDOW_DAYS));
    expect(c.daysLeft).toBe(DISCOVERY_CREDIT_WINDOW_DAYS); // 15
  });

  it("credit_live mid-window with the right countdown", () => {
    const c = resolveDiscoveryCredit(CALL, addDays(CALL, 14));
    expect(c.state).toBe("credit_live");
    expect(c.daysLeft).toBe(1);
  });

  it("credit_live on the final day (boundary, daysLeft 0)", () => {
    const c = resolveDiscoveryCredit(CALL, addDays(CALL, DISCOVERY_CREDIT_WINDOW_DAYS));
    expect(c.state).toBe("credit_live");
    expect(c.daysLeft).toBe(0);
  });

  it("credit_expired the day after the window closes", () => {
    const c = resolveDiscoveryCredit(CALL, addDays(CALL, DISCOVERY_CREDIT_WINDOW_DAYS + 1));
    expect(c.state).toBe("credit_expired");
    expect(c.daysLeft).toBeNull();
    expect(c.expiresOn).toBe(addDays(CALL, DISCOVERY_CREDIT_WINDOW_DAYS));
  });

  it("re-book resets the clock — a fresh call date revives the window", () => {
    const today = addDays(CALL, 40); // long past the original window
    expect(resolveDiscoveryCredit(CALL, today).state).toBe("credit_expired");
    const rebook = addDays(CALL, 40); // new call today
    const c = resolveDiscoveryCredit(rebook, today);
    expect(c.state).toBe("credit_live");
    expect(c.daysLeft).toBe(DISCOVERY_CREDIT_WINDOW_DAYS);
  });

  it("fail-open: no call date → credit_live without a countdown", () => {
    const c = resolveDiscoveryCredit(null, "2026-06-25");
    expect(c.state).toBe("credit_live");
    expect(c.expiresOn).toBeNull();
    expect(c.daysLeft).toBeNull();
  });

  it("fail-open: malformed call date is treated as missing", () => {
    const c = resolveDiscoveryCredit("25-06-2026", "2026-06-25");
    expect(c.state).toBe("credit_live");
    expect(c.expiresOn).toBeNull();
  });
});

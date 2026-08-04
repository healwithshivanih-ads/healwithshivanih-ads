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

describe("resolveDiscoveryStage — pre-existing outside labs must not skip the intake", () => {
  // A client who arrives with lab reports they had done privately. The coach
  // files those as a health_snapshot when she creates the record, so hasResults
  // is true before the client has ever opened the app or filled anything in.
  // Real case: cl-024, created 2026-08-04 off a panel drawn 2026-07-15 — the
  // coach's intent was "share the app so he fills his intake".
  const base: DiscoveryStageInput = {
    intakeSubmitted: false,
    hasRecommendedOrder: false,
    hasActiveOrder: false,
    hasResults: false,
    callDone: false,
  };
  const stage = (over: Partial<DiscoveryStageInput>) => resolveDiscoveryStage({ ...base, ...over });

  it("brand-new client + pre-existing labs + no intake → onboard_intake (asks for the intake)", () => {
    expect(stage({ hasResults: true })).toBe("onboard_intake");
  });

  it("intake submitted + pre-existing labs → awaiting_call (no new order needed)", () => {
    expect(stage({ intakeSubmitted: true, hasResults: true })).toBe("awaiting_call");
  });

  it("callDone still wins over a missing intake", () => {
    expect(stage({ hasResults: true, callDone: true })).toBe("post_call");
  });

  // No-regression: the intake gate applies ONLY to the results-driven stage.
  // A lab order the coach raised is actionable in-app whether or not the intake
  // is in, so booking must never be hidden behind the intake CTA.
  it("no intake + labs recommended → still book_labs", () => {
    expect(stage({ hasRecommendedOrder: true, hasResults: true })).toBe("book_labs");
  });

  it("no intake + sample in flight → still awaiting_results", () => {
    expect(stage({ hasActiveOrder: true })).toBe("awaiting_results");
  });

  it("no intake + in-app results already in → onboard_intake (chases the intake)", () => {
    // The labs came through the app, but the discovery call can't be read
    // without the client's story — so the app keeps asking for the intake.
    expect(stage({ hasResults: true, hasActiveOrder: false, hasRecommendedOrder: false })).toBe(
      "onboard_intake",
    );
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

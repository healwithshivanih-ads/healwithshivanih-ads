import { describe, it, expect } from "vitest";

import {
  graduationNoticeDecision,
  renderGraduationNotice,
  GRADUATION_BACKFILL_DAYS,
  type GraduationNoticeInput,
} from "./graduation-notice";
import { GRACE_DAYS } from "./app-mode";

const TODAY = "2026-08-20";

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A published 12-week plan whose effective recheck lands `daysOut` from TODAY.
 * Negative = the recheck has already passed. Mirrors the helper in
 * app-mode.test.ts so both suites describe the window the same way.
 */
function planWithRecheck(daysOut: number, extra: Record<string, unknown> = {}) {
  const weeks = 12;
  const started = addDays(TODAY, daysOut - weeks * 7);
  return {
    plan_period_start: started,
    plan_period_weeks: weeks,
    meal_plan_started_on: started,
    status: "published",
    ...extra,
  };
}

/** A client who used the app, has a phone, and has never been messaged. */
function input(over: Partial<GraduationNoticeInput> = {}): GraduationNoticeInput {
  return {
    todayYmd: TODAY,
    appMode: { plan: planWithRecheck(-(GRACE_DAYS + 1)) },
    hasPhone: true,
    daysSinceLastOpen: 1,
    lastSentAt: null,
    ...over,
  };
}

// The day the app flips to the LIBRARY floor, relative to TODAY: REVIEW's last
// day is recheck + GRACE_DAYS, so a recheck at -(GRACE_DAYS + 1) graduates them
// exactly today.
const GRADUATED_TODAY = { plan: planWithRecheck(-(GRACE_DAYS + 1)) };

describe("graduationNoticeDecision — the REVIEW→LIBRARY edge", () => {
  it("fires on the first day past the review window", () => {
    const d = graduationNoticeDecision(input({ appMode: GRADUATED_TODAY }));
    expect(d.send).toBe(true);
    expect(d.graduatedOn).toBe(TODAY);
  });

  it("does NOT fire while still inside the review window (last day of grace)", () => {
    const d = graduationNoticeDecision(
      input({ appMode: { plan: planWithRecheck(-GRACE_DAYS) } }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toContain("REVIEW");
  });

  it("does NOT fire mid-protocol", () => {
    const d = graduationNoticeDecision(input({ appMode: { plan: planWithRecheck(60) } }));
    expect(d.send).toBe(false);
    expect(d.reason).toContain("ACTIVE");
  });
});

describe("graduationNoticeDecision — idempotence", () => {
  it("does NOT fire again the next day", () => {
    // Day 1: graduation day. It sends, and the send is recorded.
    const day1 = graduationNoticeDecision(input({ appMode: GRADUATED_TODAY }));
    expect(day1.send).toBe(true);
    const sentAt = `${TODAY}T09:00:00.000Z`;

    // Day 2: the same plan, one day later, with that send on the record.
    const day2 = graduationNoticeDecision(
      input({
        todayYmd: addDays(TODAY, 1),
        appMode: GRADUATED_TODAY,
        lastSentAt: sentAt,
      }),
    );
    expect(day2.send).toBe(false);
    expect(day2.reason).toContain("already sent");
  });

  it("stays silent every day for the rest of the backfill window", () => {
    const sentAt = `${TODAY}T09:00:00.000Z`;
    for (let n = 1; n <= GRADUATION_BACKFILL_DAYS; n++) {
      const d = graduationNoticeDecision(
        input({ todayYmd: addDays(TODAY, n), appMode: GRADUATED_TODAY, lastSentAt: sentAt }),
      );
      expect(d.send, `day +${n}`).toBe(false);
    }
  });

  it("DOES fire for a later graduation, even though an older notice exists", () => {
    // The client bought another phase, finished it, and graduated again. The
    // notice from the previous programme must not swallow this one.
    const d = graduationNoticeDecision(
      input({ appMode: GRADUATED_TODAY, lastSentAt: `${addDays(TODAY, -120)}T09:00:00.000Z` }),
    );
    expect(d.send).toBe(true);
  });

  it("refuses to send when the last-sent stamp is unreadable", () => {
    const d = graduationNoticeDecision(
      input({ appMode: GRADUATED_TODAY, lastSentAt: "sometime last week" }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toContain("unreadable");
  });
});

describe("graduationNoticeDecision — who is eligible", () => {
  it("does NOT fire for a client who never opened the app", () => {
    const d = graduationNoticeDecision(
      input({ appMode: GRADUATED_TODAY, daysSinceLastOpen: null }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toContain("never opened");
  });

  it("DOES fire for a client who used the app then drifted off", () => {
    const d = graduationNoticeDecision(
      input({ appMode: GRADUATED_TODAY, daysSinceLastOpen: 60 }),
    );
    expect(d.send).toBe(true);
  });

  it("never sends to a client with no mobile number", () => {
    const d = graduationNoticeDecision(input({ appMode: GRADUATED_TODAY, hasPhone: false }));
    expect(d.send).toBe(false);
    expect(d.reason).toContain("mobile number");
  });

  it("leaves maintenance clients to the lapse nudge", () => {
    const d = graduationNoticeDecision(
      input({
        appMode: {
          plan: planWithRecheck(-(GRACE_DAYS + 1)),
          maintenance_status: "lapsed",
          maintenance_paid_through: addDays(TODAY, -90),
        },
      }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toContain("maintenance");
  });

  it("does NOT fire for a client with no plan at all", () => {
    const d = graduationNoticeDecision(input({ appMode: { plan: null } }));
    expect(d.send).toBe(false);
  });
});

describe("graduationNoticeDecision — backfill window", () => {
  it("still fires at the far edge of the backfill window", () => {
    const d = graduationNoticeDecision(
      input({ todayYmd: addDays(TODAY, GRADUATION_BACKFILL_DAYS), appMode: GRADUATED_TODAY }),
    );
    expect(d.send).toBe(true);
  });

  it("does NOT reach back past it — no first-run blast of old graduations", () => {
    const d = graduationNoticeDecision(
      input({ todayYmd: addDays(TODAY, GRADUATION_BACKFILL_DAYS + 1), appMode: GRADUATED_TODAY }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toContain("backfill");
  });
});

describe("renderGraduationNotice", () => {
  const body = renderGraduationNotice("Priya");

  it("greets the client by name", () => {
    expect(body).toContain("Hi Priya");
  });

  it("says what stays open rather than what was taken away", () => {
    expect(body).toMatch(/recipes/i);
    expect(body).toMatch(/keepsake/i);
    expect(body).toMatch(/re-order/i);
  });

  it("does not imply they still have a live plan", () => {
    expect(body).not.toMatch(/your (current |new )?plan is|this week|next week|your menu/i);
  });

  it("does not read as a sales push", () => {
    expect(body).not.toMatch(/\b(buy|offer|discount|sign up|enroll|book now|limited|₹|rs\.?\s*\d)/i);
  });
});

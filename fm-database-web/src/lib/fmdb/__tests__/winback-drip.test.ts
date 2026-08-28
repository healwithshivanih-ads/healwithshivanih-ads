/**
 * The win-back drip auto-drafts emails that ask lapsed clients for money. Every
 * rule that decides who receives one is pinned here.
 *
 * THE LOAD-BEARING TEST is "never speaks to anyone still in the renewal queue".
 * The queue is the coach's own list of endings she has not yet dealt with; a
 * robot writing to those people behind her is the single worst outcome this
 * feature could produce, and the two windows are only disjoint by arithmetic
 * (queue tail 14 days, first touch day 22). That arithmetic is what this file
 * exists to hold still.
 */
import { describe, it, expect } from "vitest";
import {
  winbackDecision,
  nextTouch,
  WINBACK_TOUCHES,
  WINBACK_BACKFILL_DAYS,
  GRADUATION_QUIET_DAYS,
  DEFERRED_HOLD_DAYS,
  type WinbackDecisionInput,
} from "../winback-drip";
import { OVERDUE_TAIL_DAYS } from "../renewal-queue";

const ENDS = "2026-07-01";

/** Day N after the plan ended. */
function dayAfterEnd(n: number): string {
  const d = new Date(`${ENDS}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function input(over: Partial<WinbackDecisionInput> = {}): WinbackDecisionInput {
  return {
    todayYmd: dayAfterEnd(22),
    endsOn: ENDS,
    decision: null,
    hasSuccessor: false,
    hasEmail: true,
    lastEngagementAt: null,
    graduationSentAt: null,
    touchesHandled: [],
    exited: false,
    ...over,
  };
}

describe("win-back drip — who is eligible", () => {
  it("drafts touch 1 on day 22 and not a day earlier", () => {
    expect(winbackDecision(input({ todayYmd: dayAfterEnd(21) })).draft).toBe(false);
    const d = winbackDecision(input({ todayYmd: dayAfterEnd(22) }));
    expect(d.draft).toBe(true);
    if (d.draft) {
      expect(d.touch.n).toBe(1);
      expect(d.touch.kind).toBe("check_in");
    }
  });

  it("NEVER touches anyone still inside the renewal queue", () => {
    // The queue shows undecided endings from day 0 to day -OVERDUE_TAIL_DAYS.
    // Not one day in that range may produce a draft, or the coach is being
    // asked about a client the robot has already written to.
    for (let day = 0; day <= OVERDUE_TAIL_DAYS; day++) {
      const d = winbackDecision(input({ todayYmd: dayAfterEnd(day) }));
      expect(d.draft, `day ${day} is inside the renewal queue but drafted`).toBe(false);
    }
    // And the first touch must genuinely be clear of it, not merely equal.
    expect(WINBACK_TOUCHES[0].day).toBeGreaterThan(OVERDUE_TAIL_DAYS);
  });

  it("a successor plan stops the drip — the between-phases client", () => {
    // fmdb/plan/renewals.py carries the real case: a plan ending 7 Aug with a
    // successor starting 13 Aug, a six-day gap that exists BECAUSE she renewed.
    // Asking "is a plan running today" win-backs her mid-gap.
    const d = winbackDecision(input({ hasSuccessor: true }));
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/successor/i);
  });

  it("a client who said no is never chased", () => {
    const d = winbackDecision(
      input({ decision: { decision: "not_renewing", at: "2026-07-02T00:00:00Z" } }),
    );
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/not renewing/i);
  });

  it("a client who renewed is never chased", () => {
    const d = winbackDecision(
      input({ decision: { decision: "renewed", at: "2026-07-02T00:00:00Z" } }),
    );
    expect(d.draft).toBe(false);
  });

  it("a deferral is honoured, then lapses back to eligible", () => {
    const deferredAt = dayAfterEnd(10);
    const stillHeld = winbackDecision(
      input({
        decision: { decision: "deferred", at: `${deferredAt}T00:00:00Z` },
        todayYmd: dayAfterEnd(10 + DEFERRED_HOLD_DAYS - 1),
      }),
    );
    expect(stillHeld.draft).toBe(false);
    expect(stillHeld.reason).toMatch(/deferred/i);

    const released = winbackDecision(
      input({
        decision: { decision: "deferred", at: `${deferredAt}T00:00:00Z` },
        todayYmd: dayAfterEnd(10 + DEFERRED_HOLD_DAYS),
      }),
    );
    expect(released.draft).toBe(true);
  });

  it("an unreadable deferral stamp holds off rather than overriding the coach", () => {
    const d = winbackDecision(input({ decision: { decision: "deferred", at: "not a date" } }));
    expect(d.draft).toBe(false);
  });

  it("SUDARSHAN'S CASE: an unrecognised decision value fails CLOSED", () => {
    // _renewal_decisions.yaml is hand-edited as well as dashboard-written, and
    // on 2026-08-28 it held `offer_sent` against sudarshan-plan-1: the coach had
    // emailed him a renewal offer on 20 Aug holding his original ₹31,000
    // against the current ₹85,000 for fifteen days. The first version of this
    // module knew three decision values, fell through on the fourth, and would
    // have drafted a win-back to a client with a priced offer already in
    // flight. openRenewals() drops ANY non-null decision, so he was invisible
    // on the coach's queue at the same time.
    const d = winbackDecision(
      input({ decision: { decision: "offer_sent", at: "2026-07-05T00:00:00Z" } }),
    );
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/offer_sent/);
  });

  it("fails closed on any future decision value nobody has thought of yet", () => {
    for (const v of ["paused", "escalated", "on_hold", ""]) {
      const d = winbackDecision(input({ decision: { decision: v, at: "2026-07-05T00:00:00Z" } }));
      expect(d.draft, `"${v}" was let through`).toBe(false);
    }
  });

  it("anyone back in touch since the plan ended is handled personally", () => {
    const d = winbackDecision(input({ lastEngagementAt: `${dayAfterEnd(5)}T09:00:00Z` }));
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/back in touch/i);
  });

  it("contact from BEFORE the plan ended is not a sign of life", () => {
    // Otherwise every client who ever sent a message is permanently exempt.
    const d = winbackDecision(input({ lastEngagementAt: "2026-06-01T09:00:00Z" }));
    expect(d.draft).toBe(true);
  });

  it("no email address, no email drip", () => {
    expect(winbackDecision(input({ hasEmail: false })).draft).toBe(false);
  });

  it("a coach-stopped drip stays stopped", () => {
    expect(winbackDecision(input({ exited: true })).draft).toBe(false);
  });
});

describe("win-back drip — cadence", () => {
  it("runs three touches across the six weeks after expiry", () => {
    expect(WINBACK_TOUCHES).toHaveLength(3);
    expect(WINBACK_TOUCHES[WINBACK_TOUCHES.length - 1].day).toBeLessThanOrEqual(42);
    expect(WINBACK_TOUCHES.map((t) => t.kind)).toEqual(["check_in", "offer", "maintenance"]);
  });

  it("only the offer touch carries a price", () => {
    // Touch 1 asks how they are; touch 3 names only the maintenance floor. A
    // price on the first contact after a silence is the thing this cadence was
    // shaped to avoid.
    expect(WINBACK_TOUCHES[0].kind).toBe("check_in");
  });

  it("fires the latest due touch, not a backlog of all three", () => {
    // A client discovered late gets one message, not three in a morning.
    const d = winbackDecision(input({ todayYmd: dayAfterEnd(42) }));
    expect(d.draft).toBe(true);
    if (d.draft) expect(d.touch.n).toBe(3);
  });

  it("moves on to the next touch once one is handled", () => {
    const d = winbackDecision(input({ todayYmd: dayAfterEnd(32), touchesHandled: [1] }));
    expect(d.draft).toBe(true);
    if (d.draft) expect(d.touch.n).toBe(2);
  });

  it("stops after all three", () => {
    const d = winbackDecision(input({ todayYmd: dayAfterEnd(60), touchesHandled: [1, 2, 3] }));
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/complete/i);
  });

  it("will not backfill an ancient ending on first run", () => {
    // Without this cap the cron's first run drafts for every client who has
    // ever lapsed — years of endings arriving as one batch of money-asks.
    const lastDay = WINBACK_TOUCHES[WINBACK_TOUCHES.length - 1].day;
    const d = winbackDecision({
      ...input({ todayYmd: dayAfterEnd(lastDay + WINBACK_BACKFILL_DAYS + 1) }),
    });
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/backfill/i);
  });
});

describe("win-back drip — the graduation notice", () => {
  it("stays quiet either side of it", () => {
    // graduation-notice sends a warm message that explicitly does not sell
    // ("the door back is named, not pushed"). Pitching days later makes a liar
    // of it.
    const d = winbackDecision(
      input({
        todayYmd: dayAfterEnd(22),
        graduationSentAt: `${dayAfterEnd(22 - (GRADUATION_QUIET_DAYS - 1))}T10:00:00Z`,
      }),
    );
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/graduation/i);
  });

  it("speaks again once the quiet window has passed", () => {
    const d = winbackDecision(
      input({
        todayYmd: dayAfterEnd(22),
        graduationSentAt: `${dayAfterEnd(22 - GRADUATION_QUIET_DAYS)}T10:00:00Z`,
      }),
    );
    expect(d.draft).toBe(true);
  });

  it("a late graduation notice still silences the drip", () => {
    // That cron backfills up to 30 days, so the notice can land well after its
    // nominal day. Checked against the actual send, never the expected date.
    const d = winbackDecision(
      input({ todayYmd: dayAfterEnd(32), touchesHandled: [1], graduationSentAt: `${dayAfterEnd(31)}T10:00:00Z` }),
    );
    expect(d.draft).toBe(false);
  });
});

describe("nextTouch", () => {
  it("names what a scheduled client is waiting on", () => {
    expect(nextTouch([])?.n).toBe(1);
    expect(nextTouch([1])?.n).toBe(2);
    expect(nextTouch([1, 2, 3])).toBeNull();
  });
});

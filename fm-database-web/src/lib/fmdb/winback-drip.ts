/**
 * Win-back drip — deciding whether a lapsed client is owed a draft today.
 *
 * THE GAP THIS CLOSES. The renewal queue is a heads-up for the coach; it sends
 * nothing. If she never gets to writing the letter — a busy fortnight, a client
 * who had already gone quiet — then after the queue's tail runs out, NOTHING
 * ever reaches that person again. They simply fall off. This module decides,
 * for one client on one day, whether a win-back email should be DRAFTED.
 *
 * It is PURE — no I/O, no clock, no React. The eligibility loader reads from
 * disk and the server actions do the writing; every rule that could put an
 * email in front of the wrong person lives here, where a test can fail on it.
 *
 * NOTHING HERE SENDS. `draft: true` produces a draft the coach must approve.
 * That is the same gate the hand-authored renewal letter has had since it
 * existed, and for the same reason: see .claude/skills/author-renewal §3, where
 * a mother came within a week of being asked for ₹50,000 for her daughter's
 * renewal six days before her own, because nobody had looked at the household.
 * A drip that sends by itself cannot look at anything.
 *
 * THE CADENCE IS CONSTRAINED FROM BOTH ENDS, and neither end is arbitrary:
 *
 *   day 0    the plan window closes
 *   0..14    the coach's renewal queue is asking her about them
 *   day 14   the roster lapses them (RENEWAL_GRACE_DAYS)
 *   day 16   graduation-notice sends its own warm, deliberately non-selling
 *            message ("the door back is named, not pushed")
 *   day 22   ── the earliest this drip may speak ──
 *
 * Touch 1 cannot land before day 15 without contradicting the queue, and
 * cannot land near day 16 without pitching a client days after a message that
 * promised not to. Hence 22 / 32 / 42: three touches across the six weeks after
 * expiry, starting the moment both constraints are clear.
 */

import type { RenewalDecision } from "./renewal-queue";

/** What each touch is for. The kind drives the copy and the price rules. */
export type WinbackTouchKind = "check_in" | "offer" | "maintenance";

export interface WinbackTouch {
  n: 1 | 2 | 3;
  /** Days after the plan's effective end date that this touch becomes due. */
  day: number;
  kind: WinbackTouchKind;
}

/**
 * Three touches over the six weeks after expiry.
 *
 * Touch 1 carries NO price and no pitch — it asks how they are. Touch 2 is the
 * only one that makes the full offer. Touch 3 drops the programme entirely and
 * names only the maintenance floor, because a third ask at the same price is a
 * chase rather than an invitation.
 */
export const WINBACK_TOUCHES: readonly WinbackTouch[] = [
  { n: 1, day: 22, kind: "check_in" },
  { n: 2, day: 32, kind: "offer" },
  { n: 3, day: 42, kind: "maintenance" },
] as const;

/**
 * How far past a touch's due date it may still be drafted.
 *
 * Without a cap, the first run of this cron would draft for every client who
 * has ever lapsed — years of endings arriving in one batch, each reading as
 * news to whoever opens the panel. graduation-notice learned this the same way
 * and capped its own backfill at 30 days; 14 is tighter here because these
 * drafts ask for money.
 */
export const WINBACK_BACKFILL_DAYS = 14;

/**
 * Days either side of the graduation notice in which this drip stays silent.
 *
 * The graduation message exists to tell someone their programme is complete and
 * explicitly not to sell to them. A renewal pitch arriving three days later
 * makes a liar of it.
 */
export const GRADUATION_QUIET_DAYS = 5;

/**
 * How long a `deferred` decision holds the drip off.
 *
 * "Ask again later" is a real answer and deserves to be honoured for longer
 * than a touch gap, or the drip simply overrides the coach. After this it
 * lapses back to undecided rather than blocking forever — a deferral nobody
 * ever revisited is exactly the silence this feature exists to catch.
 */
export const DEFERRED_HOLD_DAYS = 30;

export interface WinbackDecisionInput {
  /** Today in the client-facing zone (IST), as YYYY-MM-DD. */
  todayYmd: string;
  /** The plan's effective end date, YYYY-MM-DD. Must come from planEndDate. */
  endsOn: string;
  /**
   * What the coach recorded about this plan ending, if anything.
   *
   * Typed as a bare string, NOT RenewalDecision, because the file it comes from
   * is hand-edited as well as dashboard-written and demonstrably holds values
   * outside that union — `offer_sent` was live on 2026-08-28. Narrowing the
   * type here would have hidden that behind a cast; keeping it wide forces the
   * unknown case to be handled, and it fails closed.
   */
  decision: { decision: RenewalDecision | string; at: string } | null;
  /**
   * Does a live successor plan exist (draft, ready, or published)? A draft
   * counts: it is the coach mid-way through the next phase, which is the
   * strongest possible signal this person has not gone anywhere.
   */
  hasSuccessor: boolean;
  /** No email address, no email drip. */
  hasEmail: boolean;
  /**
   * ISO timestamp of the most recent sign of life since the plan ended — an
   * inbound message on any channel, or a booking. Null when silent.
   */
  lastEngagementAt: string | null;
  /** ISO timestamp of the graduation notice, if one has been sent. */
  graduationSentAt: string | null;
  /** Touch numbers already drafted, sent, skipped or expired. */
  touchesHandled: readonly number[];
  /** The coach has stopped this drip by hand. */
  exited: boolean;
}

export type WinbackDecision =
  | { draft: false; reason: string; daysSinceEnd?: number }
  | { draft: true; touch: WinbackTouch; reason: string; daysSinceEnd: number };

/** Whole days between two YYYY-MM-DD dates, in UTC. */
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 864e5);
}

/** The YYYY-MM-DD prefix of an ISO timestamp, or null if it is not one. */
function ymdOf(iso: string | null): string | null {
  if (typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Is a win-back draft due for this client today, and which one?
 *
 * Every `draft: false` carries a reason in words rather than a bare boolean.
 * The failure mode being guarded against is a client who should have been
 * contacted and silently wasn't — the very silence this feature exists to fix —
 * so a quiet day has to stay legible to whoever reads the cron log.
 */
export function winbackDecision(input: WinbackDecisionInput): WinbackDecision {
  const { todayYmd, endsOn } = input;

  if (input.exited) {
    return { draft: false, reason: "coach stopped this drip" };
  }

  const daysSinceEnd = daysBetween(endsOn, todayYmd);
  if (Number.isNaN(daysSinceEnd)) {
    return { draft: false, reason: `unparseable dates (ends ${endsOn}, today ${todayYmd})` };
  }

  // ── The entry condition, in the order that matters ───────────────────────
  //
  // Successor first. A client between phases has no plan running today and is
  // not lapsed at all — fmdb/plan/renewals.py carries the regression case: a
  // plan ending 7 Aug and its successor starting 13 Aug, a six-day gap that
  // exists BECAUSE she renewed. Asking "is one running today" win-backs her
  // mid-gap, four days before her new phase opens.
  if (input.hasSuccessor) {
    return { draft: false, reason: "a successor plan exists — they renewed", daysSinceEnd };
  }

  if (input.decision) {
    const d = input.decision.decision;
    if (d === "renewed") {
      return { draft: false, reason: "coach recorded: renewed", daysSinceEnd };
    }
    if (d === "not_renewing") {
      // They said no to a person. Chasing them with automation afterwards is
      // the single worst thing this system could do.
      return { draft: false, reason: "coach recorded: not renewing", daysSinceEnd };
    }
    if (d === "deferred") {
      const at = ymdOf(input.decision.at);
      // An unreadable stamp is treated as a live deferral: the cost of holding
      // off is a quiet client, the cost of getting it wrong is overriding an
      // explicit "ask again later".
      if (at === null) {
        return { draft: false, reason: "deferred (unreadable stamp) — holding off", daysSinceEnd };
      }
      const held = daysBetween(at, todayYmd);
      if (held < DEFERRED_HOLD_DAYS) {
        return {
          draft: false,
          reason: `deferred ${held}d ago — held for ${DEFERRED_HOLD_DAYS}d`,
          daysSinceEnd,
        };
      }
    } else if (d !== "renewed" && d !== "not_renewing") {
      // ── UNKNOWN DECISION VALUES FAIL CLOSED ──────────────────────────────
      // `_renewal_decisions.yaml` is hand-edited as well as written by the
      // dashboard, so it holds values outside the RenewalDecision union. On
      // 2026-08-28 the live file carried `offer_sent` against
      // sudarshan-plan-1: the coach had emailed him a renewal offer on 20 Aug
      // holding his original ₹31,000 against the current ₹85,000 for fifteen
      // days. Falling through to "eligible" on an unrecognised value would
      // have had this drip chase a client with a priced offer already in
      // flight — two asks colliding, which is the exact failure the renewal
      // system was built to prevent.
      //
      // openRenewals() drops ANY non-null decision, so a value it does not
      // recognise silently removes that client from the coach's queue too.
      // Anything this module does not understand therefore belongs to a
      // conversation already in progress, and it must stay out of it.
      return {
        draft: false,
        reason: `decision "${String(d)}" recorded — not one this drip understands, so leaving it alone`,
        daysSinceEnd,
      };
    }
  }

  if (!input.hasEmail) {
    return { draft: false, reason: "no email address on file", daysSinceEnd };
  }

  // ── Anyone already back in conversation is a person, not a queue row ─────
  // If they have replied or booked since their plan ended, the coach is
  // already talking to them. Generic win-back copy arriving on top of a live
  // conversation is worse than no copy at all.
  if (input.lastEngagementAt) {
    const at = ymdOf(input.lastEngagementAt);
    if (at !== null && daysBetween(endsOn, at) >= 0) {
      return {
        draft: false,
        reason: `back in touch since the plan ended (${at}) — handle personally`,
        daysSinceEnd,
      };
    }
  }

  // ── Which touch, if any ──────────────────────────────────────────────────
  // The LATEST due touch wins, and earlier undone ones are passed over rather
  // than fired as a backlog. A client discovered at day 40 gets one message,
  // not three in a morning.
  const due = WINBACK_TOUCHES.filter(
    (t) => daysSinceEnd >= t.day && !input.touchesHandled.includes(t.n),
  );
  if (due.length === 0) {
    const next = WINBACK_TOUCHES.find((t) => !input.touchesHandled.includes(t.n));
    return {
      draft: false,
      reason: next
        ? `touch ${next.n} is due at day ${next.day}; day ${daysSinceEnd} today`
        : "all three touches handled — drip complete",
      daysSinceEnd,
    };
  }
  const touch = due[due.length - 1];

  if (daysSinceEnd > touch.day + WINBACK_BACKFILL_DAYS) {
    return {
      draft: false,
      reason: `day ${daysSinceEnd} is beyond the ${WINBACK_BACKFILL_DAYS}d backfill window for touch ${touch.n}`,
      daysSinceEnd,
    };
  }

  // ── Never speak on top of the graduation notice ──────────────────────────
  // Checked against the actual send rather than the nominal day-16 date,
  // because that cron backfills up to 30 days and can land late.
  if (input.graduationSentAt) {
    const at = ymdOf(input.graduationSentAt);
    if (at !== null) {
      const gap = Math.abs(daysBetween(at, todayYmd));
      if (gap < GRADUATION_QUIET_DAYS) {
        return {
          draft: false,
          reason: `graduation notice sent ${at} — staying quiet for ${GRADUATION_QUIET_DAYS}d either side`,
          daysSinceEnd,
        };
      }
    }
  }

  return {
    draft: true,
    touch,
    daysSinceEnd,
    reason: `touch ${touch.n} (${touch.kind}) due — day ${daysSinceEnd} since the plan ended`,
  };
}

/** The next touch a client is waiting on, for the panel's scheduled rows. */
export function nextTouch(touchesHandled: readonly number[]): WinbackTouch | null {
  return WINBACK_TOUCHES.find((t) => !touchesHandled.includes(t.n)) ?? null;
}

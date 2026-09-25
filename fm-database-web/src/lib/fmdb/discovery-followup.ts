/**
 * Discovery follow-up — what a person who had a call with the coach but has
 * not signed up is owed, and when.
 *
 * THE GAP THIS CLOSES. Before this, the only automated message a post-call
 * prospect ever received was the intake reminder. Three free-call bookings
 * from early September (cl-902, cl-903, cl-905) had no follow-up of any kind
 * two weeks later, and the one paid Foundation client (cl-904) was five days
 * into her 15-day credit window without anyone having told her it existed.
 * The conversion window was closing in silence.
 *
 * THREE TRACKS, BECAUSE THE CALLS SELL DIFFERENT THINGS (coach, 2026-09-25):
 *
 *   free        — the free discovery call (15-min cal.com "Discover" call, or
 *                 the website Discovery Call). There is NO credit attached to
 *                 it. Its next rung is the paid Foundation session.
 *   triage      — the PAID ₹999 short call. Same next rung as the free call,
 *                 but its ₹999 is credited in full: Foundation costs ₹11,001.
 *   foundation  — the paid ₹12,000 Foundation session. Its ₹12,000 is adjusted
 *                 against the 12-week programme if they join within 15 days of
 *                 the call (DISCOVERY_CREDIT_WINDOW_DAYS). Its next rung is the
 *                 programme.
 *
 * A free-call message must never mention a credit the person does not have,
 * and a Foundation message must never pitch the Foundation session they have
 * already bought. `renderFollowupEmail` and `checkFollowupEmail` both
 * enforce that split — the second one at send time, over whatever the coach
 * finally has on screen.
 *
 * The anchor for the foundation track is `discovery_call_date`, because that is
 * the date the client's own app counts the credit window from — the message
 * and the app must never disagree about when the credit expires. Which is also
 * why a free call must NEVER be recorded with "Mark discovery call done": that
 * button sets discovery_call_date and starts a credit clock in the app.
 *
 * It is PURE — no I/O, no clock. NOTHING HERE SENDS: a `draft: true` decision
 * produces a draft the coach approves in the dashboard, the same gate the
 * win-back drip uses and for the same reason (these messages ask for money).
 */

import { DISCOVERY_CREDIT_WINDOW_DAYS } from "./discovery-tier";

export type FollowupTrack = "free" | "triage" | "foundation";

/** The ₹999 short call, credited in full toward the Foundation session. */
export const TRIAGE_CREDIT_INR = 999;
/** What a ₹999 caller pays for the Foundation session (12,000 − 999). */
export const FOUNDATION_AFTER_TRIAGE_INR = 12000 - TRIAGE_CREDIT_INR;

export type FollowupTouchKind =
  // free track
  | "free_thanks"
  | "free_foundation_offer"
  | "free_check_in"
  // foundation track
  | "fdn_recap"
  | "fdn_journey"
  | "fdn_credit_expiring"
  // both
  | "door_open";

export interface FollowupTouch {
  n: 1 | 2 | 3 | 4;
  /** Days after the call that this touch becomes due. */
  day: number;
  kind: FollowupTouchKind;
}

/**
 * Free call → Foundation session.
 *
 * Day 1 thanks them and names the next step without a price. Day 5 is the one
 * message that states the Foundation price. Day 12 asks what is in the way —
 * the objection is worth more than a second pitch. Day 25 leaves the door open
 * and ends the sequence.
 */
export const FREE_TOUCHES: readonly FollowupTouch[] = [
  { n: 1, day: 1, kind: "free_thanks" },
  { n: 2, day: 5, kind: "free_foundation_offer" },
  { n: 3, day: 12, kind: "free_check_in" },
  { n: 4, day: 25, kind: "door_open" },
] as const;

/**
 * Foundation session → 12-week programme, timed to the 15-day credit window.
 *
 * Day 1 points them at their Starting Map. Day 6 describes what the programme
 * would take on. Day 12 lands three days before the credit expires (day 15) —
 * late enough to be a real deadline, early enough to act on. Day 22 is after
 * expiry, carries no price, and ends the sequence.
 */
export const FOUNDATION_TOUCHES: readonly FollowupTouch[] = [
  { n: 1, day: 1, kind: "fdn_recap" },
  { n: 2, day: 6, kind: "fdn_journey" },
  { n: 3, day: 12, kind: "fdn_credit_expiring" },
  { n: 4, day: 22, kind: "door_open" },
] as const;

/** The ₹999 short call sells the same next step as the free call (the
 *  Foundation session), so it shares the free cadence; only the copy differs. */
export function touchesFor(track: FollowupTrack): readonly FollowupTouch[] {
  return track === "foundation" ? FOUNDATION_TOUCHES : FREE_TOUCHES;
}

/**
 * How far past its due day a touch may still be drafted.
 *
 * Tighter than the win-back drip's 14 because these cadences are days apart:
 * a day-1 thank-you drafted on day 9 reads as an afterthought, and by then the
 * next touch is due anyway.
 */
export const FOLLOWUP_BACKFILL_DAYS = 5;

/**
 * An inbound message this recent means the coach is in a live conversation
 * with them. A templated nudge landing in the middle of that is worse than
 * nothing — hold, and let the next day's scan look again.
 */
export const LIVE_CONVERSATION_DAYS = 4;

export interface FollowupDecisionInput {
  todayYmd: string;
  track: FollowupTrack;
  /** YYYY-MM-DD of the call the sequence counts from. */
  callDate: string;
  /**
   * engagement_status as written on the record. MISSING means not enrolled
   * (see engagement.ts) and is the only state besides `pending` this drip
   * treats as open.
   */
  engagementStatus: string | null;
  /** Any plan at all — draft, ready or published. */
  hasPlan: boolean;
  hasEmail: boolean;
  /** ISO timestamp of the most recent inbound message, if any. */
  lastInboundAt: string | null;
  /** ISO start time of a booking still in the future, if any. */
  upcomingBookingAt: string | null;
  /** Touch numbers already drafted, sent, skipped or expired on this track. */
  touchesHandled: readonly number[];
  exited: boolean;
}

export type FollowupDecision =
  | { draft: false; reason: string; daysSinceCall?: number }
  | { draft: true; touch: FollowupTouch; reason: string; daysSinceCall: number };

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 864e5);
}

function ymdOf(iso: string | null): string | null {
  if (typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The date the Foundation credit expires — the same arithmetic the app uses. */
export function creditExpiresOn(callDate: string): string {
  return addDaysYmd(callDate, DISCOVERY_CREDIT_WINDOW_DAYS);
}

/**
 * Is a follow-up draft due for this person today, and which one?
 *
 * Every `draft: false` carries its reason in words, so a quiet day stays
 * legible in the cron log — the failure being guarded against is a person who
 * should have heard from the coach and silently did not.
 */
export function followupDecision(input: FollowupDecisionInput): FollowupDecision {
  const { todayYmd, callDate, track } = input;

  if (input.exited) return { draft: false, reason: "coach stopped this follow-up" };

  const es = (input.engagementStatus ?? "").trim();
  if (es === "signed_up") return { draft: false, reason: "signed up — converted" };
  if (es === "declined") {
    // They said no to a person. Automation chasing them afterwards is the worst
    // thing this could do.
    return { draft: false, reason: "coach recorded: declined" };
  }
  if (es !== "" && es !== "pending") {
    // lapsed, or anything hand-written we do not recognise. Fail closed: an
    // unknown state belongs to a conversation this module knows nothing about.
    return { draft: false, reason: `engagement "${es}" — not a prospect, leaving alone` };
  }
  if (input.hasPlan) {
    return { draft: false, reason: "a plan exists — they are past the prospect stage" };
  }

  const daysSinceCall = daysBetween(callDate, todayYmd);
  if (Number.isNaN(daysSinceCall)) {
    return { draft: false, reason: `unparseable call date ${callDate}` };
  }
  if (daysSinceCall < 0) {
    return { draft: false, reason: `call is on ${callDate} — not happened yet`, daysSinceCall };
  }

  if (!input.hasEmail) {
    return { draft: false, reason: "no email address on file", daysSinceCall };
  }

  const inbound = ymdOf(input.lastInboundAt);
  if (inbound !== null && daysBetween(inbound, todayYmd) < LIVE_CONVERSATION_DAYS) {
    return {
      draft: false,
      reason: `messaged on ${inbound} — in conversation, reply personally`,
      daysSinceCall,
    };
  }

  const upcoming = ymdOf(input.upcomingBookingAt);
  if (upcoming !== null && upcoming >= todayYmd) {
    return {
      draft: false,
      reason: `another call booked for ${upcoming} — nothing to chase`,
      daysSinceCall,
    };
  }

  const touches = touchesFor(track);
  const due = touches.filter(
    (t) => daysSinceCall >= t.day && !input.touchesHandled.includes(t.n),
  );
  if (due.length === 0) {
    const next = touches.find((t) => !input.touchesHandled.includes(t.n));
    return {
      draft: false,
      reason: next
        ? `touch ${next.n} is due on day ${next.day}; day ${daysSinceCall} today`
        : "all touches handled — sequence complete",
      daysSinceCall,
    };
  }
  // The latest due touch wins; earlier undone ones are passed over, so someone
  // picked up late gets one message, not a backlog of four.
  const touch = due[due.length - 1];
  if (daysSinceCall > touch.day + FOLLOWUP_BACKFILL_DAYS) {
    return {
      draft: false,
      reason: `day ${daysSinceCall} is beyond the ${FOLLOWUP_BACKFILL_DAYS}d window for touch ${touch.n}`,
      daysSinceCall,
    };
  }
  return {
    draft: true,
    touch,
    daysSinceCall,
    reason: `touch ${touch.n} (${touch.kind}) due — day ${daysSinceCall} since the call`,
  };
}

export function nextFollowupTouch(
  track: FollowupTrack,
  touchesHandled: readonly number[],
): FollowupTouch | null {
  return touchesFor(track).find((t) => !touchesHandled.includes(t.n)) ?? null;
}

// ── copy ────────────────────────────────────────────────────────────────────

export interface FollowupFacts {
  firstName: string;
  /** The concern they named at booking, short and in their own words. */
  concern: string | null;
  /** The client's app link, only when a Starting Map exists to show there. */
  appUrl: string | null;
  callDate: string;
}

/** "5 October" — the form every client-facing date in these messages uses. */
export function humanDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * A booking-form concern short and plain enough to quote back to them.
 *
 * Booking forms carry anything from "Gut health" to a paragraph of diagnoses.
 * A long one quoted back into an email reads like a form letter, so anything
 * over a sentence's worth is dropped and the copy falls back to a phrasing that
 * does not name it. Lower-cased only at the start, so "MS" and "Hashimoto's"
 * survive.
 */
export function quotableConcern(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (!s || s.length > 60) return null;
  if (/[\n[\]{}]/.test(s)) return null;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export interface FollowupEmail {
  subject: string;
  body: string;
}

/** Sign-off used on every follow-up, matching the win-back emails. */
export const FOLLOWUP_SIGN_OFF = "Shivani";

/** Wrap paragraphs in the greeting and sign-off every follow-up email shares. */
function letter(firstName: string, paragraphs: string[]): string {
  return [`Hi ${firstName},`, ...paragraphs, `Warmly,\n${FOLLOWUP_SIGN_OFF}`].join("\n\n");
}

/**
 * The follow-up email for one touch — subject and plain-text body.
 *
 * Email only (coach decision 2026-09-25): these are sent from her mailbox, not
 * WhatsApp. The body is plain text with paragraph breaks; the send path wraps
 * it in minimal HTML.
 */
export function renderFollowupEmail(
  kind: FollowupTouchKind,
  f: FollowupFacts,
  track: FollowupTrack,
): FollowupEmail {
  // "what you shared about X" reads naturally whether X is "gut health" or a
  // comma list like "migraine, iron and vitamin deficiency, sleep".
  const about = f.concern ? `what you shared about ${f.concern}` : "what you're dealing with";
  const expiry = humanDate(creditExpiresOn(f.callDate));
  const name = f.firstName;
  switch (kind) {
    case "free_thanks":
      return {
        subject: "Thank you for our chat",
        body: letter(name, [
          "Thank you for taking the time to talk with me.",
          `If you'd like to go deeper into ${about}, the next step is a Foundation session. We go through your full health history together, I give you the list of labs worth doing, and then we read the results side by side so you know where you actually stand.`,
          ...(track === "triage"
            ? [`The ₹${TRIAGE_CREDIT_INR} you paid for our call comes off the Foundation session, so it isn't lost.`]
            : []),
          "Would you like me to send you the details? Just reply to this email.",
        ]),
      };
    case "free_foundation_offer":
      return {
        subject: "The next step, if you'd like it",
        body: letter(name, [
          track === "triage"
            ? `I wanted to follow up on our call. The Foundation session is ₹12,000, and the ₹${TRIAGE_CREDIT_INR} you paid for our call comes off it, so it is ₹${FOUNDATION_AFTER_TRIAGE_INR.toLocaleString("en-IN")} for you. It is where we map ${about} properly: your history, the right labs, and what the results mean for you.`
            : `I wanted to follow up on our chat. The Foundation session is ₹12,000, and it is where we map ${about} properly: your history, the right labs, and what the results mean for you.`,
          "If you then decide to do the 12-week programme within 15 days of that session, the ₹12,000 is adjusted against it, so nothing is wasted.",
          "Reply to this email and I'll send you the link to book.",
        ]),
      };
    case "free_check_in":
      return {
        subject: "Checking in",
        body: letter(name, [
          "It's been a couple of weeks since we spoke, and I wanted to check in on how you are doing.",
          "If something is holding you back from the next step (timing, cost, or questions about how it works), tell me honestly and we can talk it through.",
          ...(track === "triage"
            ? [`Your ₹${TRIAGE_CREDIT_INR} from our call still counts towards the Foundation session whenever you're ready.`]
            : []),
        ]),
      };
    case "fdn_recap":
      return {
        subject: "Your Starting Map",
        body: letter(
          name,
          f.appUrl
            ? [
                "Thank you for our Foundation session.",
                `Your Starting Map is now in your Ochre Tree app:\n${f.appUrl}`,
                "It has what we found and the first changes to begin with. Start with just the first one this week; that is enough.",
              ]
            : [
                "Thank you for our Foundation session.",
                "Start with just the first change we discussed this week; that is enough. I will share your written Starting Map with you shortly.",
              ],
        ),
      };
    case "fdn_journey":
      return {
        subject: "Where we could go from here",
        body: letter(name, [
          "I hope the first changes are settling in.",
          `When you're ready to go further with ${about}, the 12-week programme is where we build your full plan: food, the right labs over time, and me alongside you throughout.`,
          `Your ₹12,000 from the Foundation session is adjusted against the programme until ${expiry}.`,
        ]),
      };
    case "fdn_credit_expiring":
      return {
        subject: `Your Foundation credit is open until ${expiry}`,
        body: letter(name, [
          `A quick heads-up that your ₹12,000 Foundation credit towards the 12-week programme is open until ${expiry}.`,
          "If you'd like to begin, reply to this email and I'll send your enrolment link. If something is holding you back, tell me and we can talk it through.",
        ]),
      };
    case "door_open":
      return {
        subject: "Whenever you're ready",
        body: letter(
          name,
          track === "foundation"
            ? [
                "No pressure at all from my side. Whenever you feel ready for the next step, just reply to this email.",
                "Your reports and Starting Map stay in your Ochre Tree app in the meantime.",
              ]
            : [
                "No pressure at all from my side. Whenever you feel ready to look into this properly, just reply to this email and we'll pick it up.",
                ...(track === "triage"
                  ? [`The ₹${TRIAGE_CREDIT_INR} you paid for our call stays credited towards the Foundation session.`]
                  : []),
              ],
        ),
      };
  }
}

/** What the coach sees as the purpose of each touch. */
export const TOUCH_LABEL: Record<FollowupTouchKind, string> = {
  free_thanks: "Thank-you + next step (no price)",
  free_foundation_offer: "Foundation session offer (₹12,000)",
  free_check_in: "Check-in — what's holding you back?",
  fdn_recap: "Recap + Starting Map (no price)",
  fdn_journey: "What the programme would tackle + credit date",
  fdn_credit_expiring: "Credit expires in 3 days",
  door_open: "Door open — final, no price",
};

// ── the send-time gate ─────────────────────────────────────────────────────

export interface FollowupGateResult {
  ok: boolean;
  refuse: string[];
  warn: string[];
}

export const MAX_BODY_CHARS = 3000;

/**
 * Checked over what the coach finally has on screen, at approval.
 *
 * Refuses: an empty subject or body, unfilled brackets, an over-long body, and
 * — the rule this feature exists for — any mention of a credit to someone who
 * came through the FREE call. A free-call email may describe the Foundation
 * session's own credit only in the approved phrasing ("adjusted against it"
 * alongside "within 15 days of that session"); a looser mention would read as
 * though the free call itself carried money forward.
 */
export function checkFollowupEmail(
  subject: string,
  body: string,
  track: FollowupTrack,
): FollowupGateResult {
  const refuse: string[] = [];
  const warn: string[] = [];
  const b = body.trim();
  const all = `${subject}\n${b}`;

  if (!subject.trim()) refuse.push("the subject is empty");
  if (!b) refuse.push("the email is empty");
  if (/\[[^\]]*\]|\{\{/.test(all)) refuse.push("there is an unfilled [bracket] or {{placeholder}} in the email");
  if (b.length > MAX_BODY_CHARS) refuse.push(`the email is ${b.length} characters; keep it under ${MAX_BODY_CHARS}`);

  if (track === "triage") {
    // A ₹999 caller's only credit is that ₹999. Mentioning a credit is fine;
    // presenting them with the Foundation session's own ₹12,000 credit (which
    // they do not have until they buy it) is not.
    if (/₹\s?12,?000 (foundation )?credit/i.test(all)) {
      refuse.push("this person paid ₹999, not ₹12,000 — their only credit so far is the ₹999");
    }
    if (/foundation session is ₹\s?12,?000/i.test(all) && !/11,?001/.test(all)) {
      refuse.push("they paid for the ₹999 call — quote ₹11,001 for the Foundation session, not ₹12,000");
    }
  }
  if (track === "free") {
    if (/\bcredit(ed|s)?\b|\bdeduct/i.test(all)) {
      refuse.push("this person had the FREE call — there is no credit to mention");
    }
    if (/adjusted against/i.test(all) && !/within 15 days of that session/i.test(all)) {
      refuse.push(
        "\"adjusted against\" must stay tied to the Foundation session (\"within 15 days of that session\") — the free call carries no credit",
      );
    }
  } else if (track === "foundation") {
    if (/foundation session is ₹|book (a|your) foundation/i.test(all)) {
      refuse.push("this person already had the Foundation session — don't sell it to them again");
    }
  }

  const rupees = all.match(/₹\s?[\d,]+/g) ?? [];
  for (const r of rupees) {
    const n = Number(r.replace(/[^\d]/g, ""));
    const known = track === "triage" ? [12000, TRIAGE_CREDIT_INR, FOUNDATION_AFTER_TRIAGE_INR] : [12000];
    if (!known.includes(n)) warn.push(`${r} is quoted — double-check it is the current price`);
  }
  return { ok: refuse.length === 0, refuse, warn };
}

// ── finding the free call's date ────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * The call date written into a booking-form session's coach_notes.
 *
 * The notes read "Booked 15 min Discover call for Tue, 8 Sept, 2026, 11:00 am
 * IST." (cal.com) or "Booked Discovery Call for Tue, 22 Sept, 2026, 2:45 pm
 * IST." (the website). Returns YYYY-MM-DD, or null when the line is absent or
 * does not parse — a guessed date would time every message wrong.
 */
export function parseBookedCallDate(notes: string | null | undefined): string | null {
  if (typeof notes !== "string") return null;
  const m = notes.match(
    /Booked\s+(?:15\s*min\s+Discover(?:y)?\s+call|Discovery\s+Call)\s+for\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/i,
  );
  if (!m) return null;
  const day = Number(m[1]);
  const monKey = m[2].toLowerCase();
  const mon = MONTHS[monKey] ?? MONTHS[monKey.slice(0, 3)];
  const year = Number(m[3]);
  if (!mon || day < 1 || day > 31) return null;
  const ymd = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return null;
  return ymd;
}

/** Is this cal.com event the free discovery call (not a paid session)? */
export function isFreeCallEventSlug(slug: string | null | undefined): boolean {
  if (typeof slug !== "string") return false;
  return /(^|-)15min($|-)|discover/i.test(slug);
}

/**
 * contact-gate.ts — ONE answer to "may I contact this person for this purpose".
 *
 * Before 2026-10-23 nine separate pieces of code did the network send (three
 * WhatsApp POSTs, seven nodemailer transports, two web-push senders) and none
 * of the client-facing ones checked opt-out, lapsed, maintenance or declined
 * at send time. The checks that existed lived in SOME callers — the interest
 * notes looked at `marketing_opt_out`, the app-reminders cron looked at
 * `isLapsed`, everything else trusted whoever called it. So a daily "take your
 * supplements" push kept firing a month after cl-004's programme ended, and a
 * parked prospect could still be reached by any button on her page.
 *
 * This module is the matrix (purpose × lifecycle state), pure and
 * unit-testable. `contact-gate-server.ts` resolves a person's lifecycle off
 * disk and calls `mayContact`; the three client-facing senders
 * (`sendWhatsAppAction` family, `sendClientEmailAction` /
 * `sendEducationPackAction`, `sendPushToClient`) call THAT, so a caller cannot
 * forget the gate — it can only forget to say what it is sending, which the
 * sender logs as an ungated send so it stays visible in pm2.
 *
 * See docs/COACH_APP_RESTRUCTURE_REVIEW.md §C.
 */

import {
  LAPSED_WINBACK_DAYS,
  PROSPECT_FOLLOWUP_DAYS,
  type Lifecycle,
  type LifecycleState,
} from "./lifecycle";

/**
 * Why a message is being sent. The gate reasons about the PURPOSE, never the
 * template name or channel — the same template can be a reply or a chase.
 *
 *   reply            answering something they wrote (coach-typed, or the
 *                    "Shivani replied in your app" nudge)
 *   transactional    payment links, receipts, lab-order confirmations,
 *                    reminders for a booking that exists, the intake link the
 *                    coach pressed — things they asked for or paid for
 *   plan             menus, cards, plan letters, push reminders,
 *                    supplement-change notices — the programme itself
 *   session_booking  "book your next session" from AUTOMATION — never allowed;
 *                    the coach books from the client page, which does not
 *                    call the gate
 *   intake           automated intake chasing (the intake-reminder cron)
 *   followup_drip    the post-call follow-up emails to a prospect
 *   renewal          the end-of-plan renewal letter
 *   winback          the win-back drip after a plan ended
 *   content_note     a "thought of you" note carrying one library item
 *   marketing        anything else promotional
 */
export type ContactPurpose =
  | "reply"
  | "transactional"
  | "plan"
  | "session_booking"
  | "intake"
  | "followup_drip"
  | "renewal"
  | "winback"
  | "content_note"
  | "marketing";

export interface ContactVerdict {
  ok: boolean;
  /** One line for the coach / the log — why. "ok" when allowed. */
  reason: string;
}

/** Purposes `marketing_opt_out` switches off everywhere. */
export const MARKETING_PURPOSES: ReadonlySet<ContactPurpose> = new Set([
  "followup_drip",
  "winback",
  "content_note",
  "marketing",
]);

/** How many days late a follow-up touch may still go (mirrors the drip's
 *  own "draftable up to 5 days late"). */
export const FOLLOWUP_DRIP_GRACE_DAYS = 5;
/** How many days late a win-back touch may still go (mirrors the drip's
 *  own "draftable up to 14 days late"). */
export const WINBACK_GRACE_DAYS = 14;

/** States each purpose is allowed in. `session_booking` is deliberately
 *  absent: automation never chases a session. */
const ALLOWED: Record<Exclude<ContactPurpose, "session_booking">, ReadonlySet<LifecycleState>> = {
  reply: new Set(["maintenance", "active", "ending", "onboarding", "lapsed", "prospect"]),
  transactional: new Set(["maintenance", "active", "ending", "onboarding", "lapsed", "prospect"]),
  plan: new Set(["active", "ending", "maintenance", "onboarding"]),
  intake: new Set(["onboarding"]),
  followup_drip: new Set(["prospect"]),
  renewal: new Set(["ending"]),
  winback: new Set(["lapsed"]),
  content_note: new Set(["prospect"]),
  marketing: new Set(["prospect", "lapsed"]),
};

export const SESSION_BOOKING_REFUSAL =
  "the coach does not auto-chase clients; book from the client page";

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000,
  );
}

/** Whole days from `sinceYmd` to `todayYmd`; null when `since` is unknown. */
export function daysSince(sinceYmd: string | null | undefined, todayYmd: string): number | null {
  if (!sinceYmd || !/^\d{4}-\d{2}-\d{2}$/.test(sinceYmd)) return null;
  return daysBetween(sinceYmd, todayYmd);
}

/**
 * The matrix. Rows = purpose, columns = lifecycle state.
 *
 *                  archived maintenance active ending onboarding lapsed prospect
 *   reply            no        yes       yes    yes     yes       yes     yes
 *   transactional    no        yes       yes    yes     yes       yes     yes
 *   plan             no        yes       yes    yes     yes       no      no
 *   session_booking  no        no        no     no      no        no      no
 *   intake           no        no        no     no      yes       no      no
 *   followup_drip    no        no        no     no      no        no      ≤ day 35
 *   renewal          no        no        no     yes     no        no      no
 *   winback          no        no        no     no      no        ≤ day 70 no
 *   content_note     no        no        no     no      no        no      yes
 *   marketing        no        no        no     no      no        yes     yes
 *
 * Overlays: `optedOut` blocks followup_drip / winback / content_note /
 * marketing; `declined` blocks everything except reply and transactional.
 *
 * @param todayYmd  needed only for the dated rows (followup_drip, winback);
 *                  defaults to today's UTC date — pass the IST date from
 *                  server code.
 */
export function mayContact(
  lifecycle: Lifecycle,
  purpose: ContactPurpose,
  todayYmd: string = new Date().toISOString().slice(0, 10),
): ContactVerdict {
  const state = lifecycle.state;

  if (purpose === "session_booking") {
    return { ok: false, reason: SESSION_BOOKING_REFUSAL };
  }
  if (state === "archived") {
    return { ok: false, reason: "archived — out of every list" };
  }
  if (lifecycle.optedOut && MARKETING_PURPOSES.has(purpose)) {
    return { ok: false, reason: "marketing_opt_out" };
  }
  if (lifecycle.declined && purpose !== "reply" && purpose !== "transactional") {
    return { ok: false, reason: "declined the programme — reply or transactional only" };
  }
  if (!ALLOWED[purpose].has(state)) {
    return { ok: false, reason: `${purpose} is not sent to a ${state} person` };
  }

  if (purpose === "followup_drip") {
    const d = daysSince(lifecycle.since, todayYmd);
    const limit = PROSPECT_FOLLOWUP_DAYS + FOLLOWUP_DRIP_GRACE_DAYS;
    if (d !== null && d > limit) {
      return { ok: false, reason: `follow-up drip finished — day ${d} of ${limit}` };
    }
  }
  if (purpose === "winback") {
    const d = lifecycle.daysSinceEnd;
    const limit = LAPSED_WINBACK_DAYS + WINBACK_GRACE_DAYS;
    if (d !== null && d > limit) {
      return { ok: false, reason: `win-back window closed — day ${d} of ${limit} after the plan ended` };
    }
  }

  return { ok: true, reason: "ok" };
}

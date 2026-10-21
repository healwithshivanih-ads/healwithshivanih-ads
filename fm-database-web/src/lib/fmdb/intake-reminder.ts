/**
 * Who the daily intake-reminder cron (`/api/cron/intake-reminders`) may nudge.
 *
 * The `fm_intake_reminder` template tells the client "your intake form is
 * still waiting for you". That is only true of a client who has NOT
 * submitted. A submitted intake keeps its token live (Path A: the client can
 * still re-edit) and stays un-finalised until the coach presses Finalise —
 * so `intake_token` + no `intake_finalised_at` does NOT mean "unfilled".
 * cl-906 submitted the full form on 2026-09-21 and was told twice (Oct 3 and
 * Oct 8) that it was still waiting, because submission was only ever used as
 * a "days since last nudge" anchor.
 *
 * Pure (no fs, no send) so the rule is testable; the route owns I/O.
 */

export const MIN_DAYS_BETWEEN_REMINDERS = 5;
export const MAX_REMINDERS_PER_TOKEN = 2;
/** Default intake-token TTL — used to back out the issue date from expiry. */
const TOKEN_TTL_DAYS = 14;

export type IntakeReminderClient = Record<string, unknown>;

export type IntakeReminderDecision =
  | { send: true; anchor: Date | null; remindersSent: number }
  | { send: false; reason: string };

/** True once the client has submitted the form at least once. */
export function hasSubmittedIntake(c: IntakeReminderClient): boolean {
  const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
  return filled(c.intake_submitted_at) || filled(c.intake_last_submitted_at);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function intakeReminderDecision(
  c: IntakeReminderClient,
  today: Date,
): IntakeReminderDecision {
  const token = c.intake_token as string | undefined;
  if (!token) return { send: false, reason: "no_token" };
  if (c.intake_finalised_at) return { send: false, reason: "finalised" };
  // Submitted but not yet finalised: the link stays open for re-edits, but
  // there is nothing "waiting" — the coach's Finalise is the next step.
  if (hasSubmittedIntake(c)) return { send: false, reason: "submitted" };
  // Coach-opt-in: only clients whose link was issued via the
  // SendIntakeFormButton (sets intake_reminder_enabled=true). The coach can
  // flip it off to stop reminders mid-cycle.
  if (c.intake_reminder_enabled !== true) return { send: false, reason: "not_enabled" };

  const expiresIso = c.intake_token_expires_at as string | undefined;
  let issued: Date | null = null;
  if (expiresIso) {
    const exp = new Date(expiresIso);
    if (!Number.isNaN(exp.getTime())) {
      if (exp < today) return { send: false, reason: "expired" };
      // Coarse: expires_at − default TTL.
      issued = new Date(exp.getTime() - TOKEN_TTL_DAYS * 86_400_000);
    }
  }

  const remindersSentAt = (c.intake_reminders_sent_at as string[] | undefined) ?? [];
  if (remindersSentAt.length >= MAX_REMINDERS_PER_TOKEN) {
    return { send: false, reason: "cap_reached" };
  }

  // "Days since last nudge" = most recent of token issue / last reminder.
  const anchorCandidates: Date[] = [];
  if (issued) anchorCandidates.push(issued);
  if (remindersSentAt.length > 0) {
    anchorCandidates.push(new Date(remindersSentAt[remindersSentAt.length - 1]));
  }
  const anchor =
    anchorCandidates
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  if (anchor && daysBetween(anchor, today) < MIN_DAYS_BETWEEN_REMINDERS) {
    return { send: false, reason: "too_soon" };
  }

  return { send: true, anchor, remindersSent: remindersSentAt.length };
}

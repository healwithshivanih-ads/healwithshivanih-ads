/**
 * When does a weekly menu actually get drafted, and what does "no draft yet"
 * mean on any given morning.
 *
 * WHY THIS EXISTS: the digest looks 7 days ahead; the drafter only drafts
 * within 3. Every client therefore spends several days listed under a heading
 * that reads "may have failed or hit the API cap" while nothing whatsoever is
 * wrong — they simply aren't due yet. On 6 Aug 2026 three of the four rows in
 * that section were routine (Nazneen and Krittika drafting on the 7th, Pranati
 * on the 9th) and one was a genuine failure, and the email gave the coach no
 * way to tell them apart. A warning that cries wolf gets skimmed, which is how
 * the real failure gets missed.
 *
 * The window lives HERE rather than in either caller because the two numbers
 * being different is precisely the bug: the digest must classify against the
 * same threshold the drafter acts on, or the split re-introduces the drift it
 * was written to remove.
 */

/**
 * How close the client's next plan week must be before the drafter builds it.
 * Read by the weekly-menu-drafts cron (what it acts on) and by the approval
 * digest (how it classifies a row that has no draft).
 */
export const DRAFT_WINDOW_DAYS = 3;

/** The fields the split needs — structural, so both callers' rows satisfy it. */
export type CadenceRow = {
  behind: boolean;
  daysToNextWeek: number;
};

/**
 * Split rows that have no pending draft into the two things they can be.
 *
 * `scheduled` — not due yet. The drafter will pick them up on its own; there
 * is nothing for the coach to do, and saying otherwise is the false alarm.
 *
 * `stalled` — either the CURRENT week's menu is missing (urgent regardless of
 * dates), or the row is inside the draft window and still has no draft. The
 * digest runs at 07:30 IST, half an hour AFTER the drafter, so by the time
 * this is evaluated anything inside the window has already had its turn — no
 * draft at that point is a real failure worth naming.
 */
export function splitByDraftWindow<T extends CadenceRow>(
  rows: T[],
): { stalled: T[]; scheduled: T[] } {
  const stalled: T[] = [];
  const scheduled: T[] = [];
  for (const r of rows) {
    if (!r.behind && r.daysToNextWeek > DRAFT_WINDOW_DAYS) scheduled.push(r);
    else stalled.push(r);
  }
  return { stalled, scheduled };
}

/** Days from now until the drafter will reach this row. Never negative. */
export function daysUntilDrafted(daysToNextWeek: number): number {
  return Math.max(0, daysToNextWeek - DRAFT_WINDOW_DAYS);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Human label for the morning the drafter will build this menu — "tomorrow",
 * "Friday", or a date once it's far enough out that a weekday name is
 * ambiguous. Named in IST because that's the clock the cron runs on and the
 * one the coach reads the email in.
 */
export function draftDayLabel(daysToNextWeek: number, now = new Date()): string {
  const days = daysUntilDrafted(daysToNextWeek);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const ist = new Date(now.getTime() + 5.5 * 3600_000 + days * 86_400_000);
  if (days <= 6) return WEEKDAYS[ist.getUTCDay()];
  return `${ist.getUTCDate()} ${ist.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

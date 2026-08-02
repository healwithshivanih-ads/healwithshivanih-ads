/**
 * Which menu weeks survive an approval.
 *
 * The app shows the current week and the next one — no more — so approving a
 * week trims everything else away. That trim used to be "keep the two
 * numerically highest weeks", which quietly assumes week numbers only ever
 * climb inside one plan.
 *
 * A continuing client breaks the assumption. Her phase-3 plan carries the
 * predecessor's weeks 11 and 12 (deliberately — otherwise her app has no menu
 * at all between the new plan publishing and its first week being approved),
 * so approving week 1 of the new phase produced [1, 11, 12], and keeping the
 * highest two discarded the week that had just been approved. On 2026-08-02
 * the coach approved a menu, the amendment logged "approved and live", and it
 * was gone.
 *
 * Anchoring on the APPROVED week instead is both correct and self-cleaning:
 * the moment a new phase's week 1 lands, the old phase's carried weeks fall
 * away on their own.
 *
 * Pure — no I/O — so the rule is testable without touching a plan file.
 */

export interface MenuWeekLike {
  week?: number;
}

/**
 * The weeks to keep after approving `approvedWeek`: that week plus the one
 * before it, in ascending order. A phase's first week legitimately returns
 * just itself — there is no earlier week to show.
 */
export function weeksAfterApproval<T extends MenuWeekLike>(
  weeks: T[],
  approvedWeek: number,
): T[] {
  const keep = new Set([approvedWeek, approvedWeek - 1]);
  return weeks
    .filter((w) => keep.has(Number(w.week)))
    .sort((a, b) => Number(a.week) - Number(b.week));
}

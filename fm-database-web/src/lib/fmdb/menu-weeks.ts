/**
 * Which menu weeks survive an approval — and which week the app shows when
 * the client's current week has no menu yet.
 *
 * APPROVAL APPENDS. IT NEVER REPLACES. (Coach rule, 2026-08-22.)
 *
 * Until today this was a trim: "keep the approved week and the one before
 * it, the app only shows two". Every approval evicted the oldest live week,
 * so a client's earlier menus — and with them the food options and recipes
 * those weeks introduced — vanished from her app the moment the coach
 * approved the next one. Nazneen (cl-022) reported it twice: once on
 * 2026-08-09 when week 1 went, again on 2026-08-22 when weeks 2 and 3 went.
 * Every client on the weekly cadence was on the same two-week window.
 *
 * The rule now: every week already live stays live. Approving week N
 * replaces any existing week N (a re-approval is a correction, not a second
 * copy) and otherwise adds to the list.
 *
 * The ONE thing that is still dropped is a week carried over from a previous
 * phase. A successor plan copies its predecessor's `app_menu` on purpose —
 * otherwise the client has no menu at all between the new plan publishing
 * and its first week being approved (author-plan skill: "CARRY IT"). Those
 * weeks are numbered from the OLD phase (e.g. 11 and 12), and must leave the
 * moment the new phase's own weeks arrive, or the picker shows "Week 12" of a
 * plan that is on week 1. Two signals identify them:
 *
 *   1. `source_plan` — stamped on every week at approval time from now on.
 *      A week whose `source_plan` is set and is not THIS plan's slug is
 *      foreign, full stop.
 *   2. For weeks that pre-date the stamp: drafting only ever targets the
 *      current week or the next one, so a live week can sit at most one
 *      above the week being approved. Anything further ahead cannot belong
 *      to this phase — it was carried.
 *
 * 2026-08-02 is the case the second signal must keep handling: Nidhi's
 * phase-3 plan carried [11, 12]; approving week 1 must yield [1], not
 * [1, 11, 12] and not (as the old slice(-2) did) [11, 12] with the approved
 * week thrown away.
 *
 * Pure — no I/O — so the rule is testable without touching a plan file.
 */

export interface MenuWeekLike {
  week?: number;
  /** Slug of the plan whose approval produced this week. Absent on weeks
   *  approved before 2026-08-22 and on the initial generator's output. */
  source_plan?: string;
}

/**
 * The weeks to keep after approving `approvedWeek` on plan `planSlug`:
 * everything already live plus the approved week (replacing a same-numbered
 * one), minus weeks carried from another plan. Ascending order.
 *
 * `weeks` is expected to already contain the approved week (the caller
 * pushes it before calling); if it does not, the result simply has no entry
 * for it — this function never invents a week.
 */
export function weeksAfterApproval<T extends MenuWeekLike>(
  weeks: T[],
  approvedWeek: number,
  planSlug?: string,
): T[] {
  const slug = (planSlug ?? "").trim();
  const seen = new Set<number>();
  const kept: T[] = [];
  // Walk from the END so that, when two entries share a week number, the most
  // recently pushed one (the approval) wins over the stale copy.
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    const n = Number(w?.week);
    if (!Number.isFinite(n)) continue; // malformed — drop rather than throw
    if (seen.has(n)) continue;
    const src = typeof w.source_plan === "string" ? w.source_plan.trim() : "";
    if (src && slug && src !== slug) continue; // carried from another plan
    // No stamp to judge by (unstamped week, or caller gave no slug): a week
    // beyond drafting's reach cannot be this phase's — it was carried.
    if ((!src || !slug) && n > approvedWeek + 1) continue;
    seen.add(n);
    kept.push(w);
  }
  return kept.sort((a, b) => Number(a.week) - Number(b.week));
}

/**
 * Which live week the app should show for plan week `current` when no week
 * carries that exact number: the most recent week at or before it (the menu
 * the client is still eating from — a frozen client stays on her last loaded
 * week), else the earliest week ahead (a successor plan whose carried weeks
 * are all numbered higher), else null.
 *
 * This replaced a "fortnight rotation" (`((current - 1) % n) + 1`) that was
 * harmless while only two weeks were ever live, but with every week retained
 * it would have sent a client on week 6 with weeks 1–5 loaded back to week 1.
 */
export function fallbackWeekFor(liveWeeks: number[], current: number): number | null {
  const nums = liveWeeks.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const before = nums.filter((n) => n <= current);
  if (before.length) return Math.max(...before);
  return Math.min(...nums);
}

/**
 * The client's current plan week (1-based) from her Day-1 anchor — the same
 * arithmetic everywhere it is needed (menu cadence, grocery refresh, the app),
 * so the surfaces cannot disagree about which week "now" is. Returns 1 when
 * there is no anchor yet.
 */
export function planWeekFromStart(startYmd: string | null | undefined, nowMs: number): number {
  if (!startYmd) return 1;
  const startMs = new Date(`${startYmd}T00:00:00Z`).getTime();
  if (!Number.isFinite(startMs)) return 1;
  const days = Math.floor((nowMs - startMs) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/**
 * Which alternatives to offer when a client swaps a meal, and in what order.
 *
 * The candidates are never invented: they are the other dishes THIS plan serves
 * in the SAME slot, so anything offered is coach-approved by construction. What
 * was missing was any sense of size. The list was simply the first three found
 * in table order, so a client could be shown a 700 kcal lunch as the headline
 * alternative to a 350 kcal one — and for someone eating to a calorie target,
 * taking that swap quietly spends the day's deficit.
 *
 * So the ordering carries the meaning:
 *
 *   · like-for-like first — smallest difference from the meal being replaced,
 *     because that is what "swap" is supposed to mean;
 *   · for a client on a weight-loss target, a HEAVIER option never outranks a
 *     lighter or equal one. It is still offered — the coach put it on the plan
 *     and hiding food from someone losing weight is its own harm — but it is
 *     offered after the ones that do not cost them anything;
 *   · each option carries its difference so the app can say plainly whether it
 *     is about the same, lighter, or more.
 *
 * Pure (no fs, no server-only) so both the loader and the tests use it.
 */

export interface SwapCandidate {
  name: string;
  note: string;
  kcal?: number;
}

export interface RankedSwap extends SwapCandidate {
  /** kcal difference from the meal being replaced. Absent when either side's
   *  calories are unknown — the app then says nothing rather than guessing. */
  kcalDelta?: number;
  /** materially more than the meal it replaces (see HEAVIER_KCAL/PCT). Only set
   *  for a client eating to a target, where it is the one thing worth flagging. */
  heavier?: boolean;
}

/** A swap is "about the same" inside this band — below a rounding error's worth
 *  of difference there is nothing useful to tell the client. */
export const SAME_KCAL_BAND = 40;

/** Materially heavier: enough to matter against a daily target. Both a floor
 *  and a proportion, so it holds for a 200 kcal snack and an 800 kcal dinner. */
const HEAVIER_KCAL = 80;
const HEAVIER_PCT = 0.15;

/**
 * Rank the alternatives for one meal.
 *
 * `mealKcal` is the dish being replaced. `weightLossActive` marks a client
 * eating to a calorie target — the only case where "heavier" is worth ranking
 * on, since for everyone else the coach's rotation is simply the plan.
 */
export function rankSwaps(
  candidates: SwapCandidate[],
  mealKcal: number | undefined,
  weightLossActive: boolean,
  limit = 3,
): RankedSwap[] {
  const ranked: RankedSwap[] = candidates.map((c) => {
    const delta =
      typeof mealKcal === "number" && typeof c.kcal === "number" ? c.kcal - mealKcal : undefined;
    const heavier =
      weightLossActive &&
      delta !== undefined &&
      delta > HEAVIER_KCAL &&
      (mealKcal ? delta / mealKcal > HEAVIER_PCT : true);
    return { ...c, ...(delta !== undefined ? { kcalDelta: delta } : {}), ...(heavier ? { heavier: true } : {}) };
  });

  return ranked
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      // 1. on a weight-loss plan, anything that costs nothing comes first
      if (weightLossActive) {
        const ah = a.s.heavier ? 1 : 0;
        const bh = b.s.heavier ? 1 : 0;
        if (ah !== bh) return ah - bh;
      }
      // 2. closest in size — a swap should be a swap
      const ad = a.s.kcalDelta === undefined ? Infinity : Math.abs(a.s.kcalDelta);
      const bd = b.s.kcalDelta === undefined ? Infinity : Math.abs(b.s.kcalDelta);
      if (ad !== bd) return ad - bd;
      // 3. stable: keep the plan's own order for anything still tied, so the
      //    list does not reshuffle between page loads
      return a.i - b.i;
    })
    .slice(0, limit)
    .map(({ s }) => s);
}

/**
 * The one short phrase shown under a swap. Deliberately plain: this app does not
 * lecture, and for a client not counting calories "about the same" is all the
 * information there is to give.
 */
export function swapDeltaLabel(delta: number | undefined): string | null {
  if (delta === undefined) return null;
  if (Math.abs(delta) <= SAME_KCAL_BAND) return "about the same";
  return delta < 0 ? `${Math.abs(Math.round(delta))} kcal lighter` : `${Math.round(delta)} kcal more`;
}

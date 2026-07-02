/**
 * growing-tree-state.ts — PURE, framework-free tree state.
 *
 * The single source of truth for "given the client's real data, what should the
 * tree look like". No DOM, no engine imports, node-testable. `deriveTreeState`
 * maps app data (week on plan + today's daily check-ins) onto the deterministic
 * `TreeState` that the renderer consumes.
 *
 * The renderer (growing-tree-engine.ts) is a pure function of `TreeState`: the
 * same state always renders the same tree. Everything here is clamped so the tree
 * can never wilt — stage and leafFill are monotonic in `week`, never negative, and
 * a lower week must never crash the renderer.
 */

/** The five growth stages, in order, keyed to weeks-on-plan. */
export type TreeStage = "sapling" | "young" | "mature" | "flowering" | "fruiting";

/** Human label for each stage — matches the prototype's stage captions. */
export const STAGE_LABEL: Record<TreeStage, string> = {
  sapling: "Sapling",
  young: "Young tree",
  mature: "Mature canopy",
  flowering: "Flowering",
  fruiting: "Fruiting",
};

/** The complete, deterministic input the renderer needs to draw one tree. */
export interface TreeState {
  /** Weeks on plan (0..totalWeeks), clamped ≥ 0. Drives trunk height + stage. */
  week: number;
  /** Plan length in weeks (≥ 1). Used for progress framing. */
  totalWeeks: number;
  /** The growth stage derived from `week`. */
  stage: TreeStage;
  /** Human-readable stage label (STAGE_LABEL[stage]). */
  stageLabel: string;
  /** Whether to draw the night scene (moon, fireflies) vs the day scene. */
  night: boolean;
  /** Today's completed daily actions (≥ 0). */
  dailyDone: number;
  /** Today's total daily actions (≥ 0). */
  dailyTotal: number;
  /** Today's completion, 0..1. `dailyDone / dailyTotal`, or 0 when total is 0. */
  leafFill: number;
  /** Consecutive-day streak (≥ 0). Feeds bird/chick count in the renderer. */
  streak: number;
  /**
   * Extra leaves earned today from a full check-in — a small, bounded bonus so a
   * fully-completed day reads a touch lusher than a half-done one. Always ≥ 0.
   */
  extraLeaves: number;
  /** Milestone blossoms — one per symptom-score win. Added on top of the
   *  stage-based blossoms so real progress makes the tree flower earlier. */
  blossoms: number;
  /** Milestone fruit — one per completed check-in. Added on top of stage fruit. */
  fruit: number;
}

/** Raw app data → tree. Everything the app already has on hand. */
export interface TreeInput {
  week: number;
  totalWeeks: number;
  dailyDone: number;
  dailyTotal: number;
  night: boolean;
  /** Optional consecutive-day streak; defaults to 0 when the app hasn't computed one. */
  streak?: number;
  /** Optional milestone counts (symptom-score wins / completed check-ins). */
  blossoms?: number;
  fruit?: number;
}

/** Clamp to a finite integer ≥ 0 (defends against NaN / negative / fractional input). */
function nonNegInt(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Map weeks-on-plan → growth stage. Boundaries mirror the prototype exactly:
 *   sapling 0–1 · young 2–4 · mature 5–8 · flowering 9–11 · fruiting 12+.
 * Monotonic: a higher week never yields an earlier stage.
 */
export function stageForWeek(week: number): TreeStage {
  const w = nonNegInt(week);
  if (w <= 1) return "sapling";
  if (w <= 4) return "young";
  if (w <= 8) return "mature";
  if (w <= 11) return "flowering";
  return "fruiting";
}

/**
 * Pure mapping from app data to the renderer's TreeState.
 *
 * - `week` clamped ≥ 0 and ≤ totalWeeks (never past the plan length).
 * - `stage` from `stageForWeek` (monotonic in week).
 * - `leafFill` = dailyDone / dailyTotal, clamped to 0..1; **0 when dailyTotal is 0**
 *   (no divide-by-zero).
 * - `extraLeaves` is a small bounded bonus (0..6) that only appears once the day is
 *   fully complete — a fully-logged day earns a slightly fuller canopy.
 */
export function deriveTreeState(input: TreeInput): TreeState {
  const totalWeeks = Math.max(1, nonNegInt(input.totalWeeks));
  const week = Math.min(totalWeeks, nonNegInt(input.week));

  const dailyTotal = nonNegInt(input.dailyTotal);
  const dailyDone = Math.min(dailyTotal, nonNegInt(input.dailyDone));
  const leafFill = dailyTotal > 0 ? dailyDone / dailyTotal : 0;

  const streak = nonNegInt(input.streak ?? 0);
  const stage = stageForWeek(week);

  // A completed day earns a small, bounded canopy bonus. Never negative, capped so
  // it can never dominate the stage-driven leaf budget.
  const fullDay = dailyTotal > 0 && dailyDone >= dailyTotal;
  const extraLeaves = fullDay ? Math.min(6, dailyTotal) : 0;

  // Milestone counts, bounded so a long history can't overload the canopy (the
  // renderer also caps against available leaf points).
  const blossoms = Math.min(8, nonNegInt(input.blossoms ?? 0));
  const fruit = Math.min(20, nonNegInt(input.fruit ?? 0));

  return {
    week,
    totalWeeks,
    stage,
    stageLabel: STAGE_LABEL[stage],
    night: !!input.night,
    dailyDone,
    dailyTotal,
    leafFill,
    streak,
    extraLeaves,
    blossoms,
    fruit,
  };
}

/**
 * Plan timing helpers — mirrors the effective_* methods on the Python Plan
 * model (fm-database/fmdb/plan/models.py).
 *
 * Why effective dates matter:
 *
 *   When the coach publishes a plan, the client doesn't actually start it
 *   that day. Empirically (Shivani, 2026-05-14):
 *     - Meal plan starts ~3 days later (need to grocery shop, prep)
 *     - Supplements start ~1 week later (have to order, await delivery,
 *       then build the habit)
 *
 *   If we compute recheck as `plan_period_start + plan_period_weeks * 7`,
 *   the recheck arrives 3-7 days before the client has done a full
 *   plan_period_weeks of the actual protocol. So we shift the basis to
 *   the effective meal-plan start.
 *
 *   Coach can override either start date when she learns the real value
 *   from the client (Plan.meal_plan_started_on / supplements_started_on).
 *   When unset, we fall back to plan_period_start + the default delay.
 */

export const MEAL_PLAN_DEFAULT_DELAY_DAYS = 3;
export const SUPPLEMENTS_DEFAULT_DELAY_DAYS = 7;

export interface PlanLike {
  // js-yaml will parse unquoted YYYY-MM-DD as a Date object; quoted will be
  // a string. Real production plans quote everything, but a single rogue YAML
  // (manual edit, dummy data, broken writer) used to crash every surface
  // that iterated all plans via this helper. We now accept both shapes and
  // coerce inside parseYmd, plus return null on anything unparseable.
  plan_period_start?: string | Date;
  plan_period_weeks?: number;
  plan_period_recheck_date?: string | Date;
  meal_plan_started_on?: string | Date | null;
  supplements_started_on?: string | Date | null;
}

/**
 * Coerce-and-validate any incoming value into a usable Date.
 *
 * Accepts: YYYY-MM-DD string (preferred), full ISO timestamp string, JS Date
 * object (when js-yaml has parsed an unquoted date), or null/undefined.
 *
 * Returns null on anything we can't make sense of — including Invalid Date
 * objects, empty strings, numbers, plain dicts, etc. The callers then
 * propagate null up; the dashboard treats absent timing data as "we can't
 * compute it" instead of crashing.
 *
 * The warning helps surface bad YAML during dev without taking the page
 * down — single rogue plan no longer kills the whole list view.
 */
function parseYmd(value: unknown): Date | null {
  if (value == null) return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // YYYY-MM-DD only → parse as UTC midnight so it round-trips cleanly
    // through toYmd() (which formats via toISOString(), i.e. UTC). Using
    // local midnight shifted the date back a day in TZs east of UTC (IST
    // +5:30); effectiveRecheckDate round-trips twice → −2 days (recheck
    // rendered 2 days early). Full ISO timestamps still parse with their
    // own offset.
    d =
      /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? new Date(trimmed + "T00:00:00Z")
        : new Date(trimmed);
  } else {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[plan-timing] parseYmd got non-string non-Date value:", value);
    }
    return null;
  }
  if (Number.isNaN(d.getTime())) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[plan-timing] parseYmd produced Invalid Date for input:", value);
    }
    return null;
  }
  return d;
}

function toYmd(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  // Advance in UTC to stay consistent with UTC parsing/formatting above —
  // setDate() (local) would re-introduce the timezone skew this module had.
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Date the client actually started (or is assumed to have started) the meal
 * plan. Coach-asserted `meal_plan_started_on` wins; otherwise
 * `plan_period_start + MEAL_PLAN_DEFAULT_DELAY_DAYS`. Returns YYYY-MM-DD or
 * null if neither input is available.
 */
export function effectiveMealPlanStart(plan: PlanLike): string | null {
  const asserted = parseYmd(plan.meal_plan_started_on);
  if (asserted) return toYmd(asserted);
  const start = parseYmd(plan.plan_period_start);
  if (!start) return null;
  return toYmd(addDays(start, MEAL_PLAN_DEFAULT_DELAY_DAYS));
}

/**
 * Has the client's meal plan actually begun as of `todayYmd`?
 * A published plan whose effective start is in the FUTURE hasn't started —
 * used to keep not-yet-started clients out of "active care" / needs-attention.
 * Conservative: when no start date is known, returns true (don't hide a plan
 * we can't date).
 */
export function hasPlanStarted(plan: PlanLike, todayYmd: string): boolean {
  const start = effectiveMealPlanStart(plan);
  if (!start) return true;
  return start <= todayYmd;
}

/**
 * Date the client actually started supplements. Coach-asserted
 * `supplements_started_on` wins; otherwise `plan_period_start +
 * SUPPLEMENTS_DEFAULT_DELAY_DAYS`. Returns YYYY-MM-DD or null.
 */
export function effectiveSupplementsStart(plan: PlanLike): string | null {
  const asserted = parseYmd(plan.supplements_started_on);
  if (asserted) return toYmd(asserted);
  const start = parseYmd(plan.plan_period_start);
  if (!start) return null;
  return toYmd(addDays(start, SUPPLEMENTS_DEFAULT_DELAY_DAYS));
}

export interface EffectiveStartOpts {
  /**
   * Raw date the meal-plan / consolidated letter was sent (YYYY-MM-DD), when
   * the caller knows it (the coach plan page derives this from the letter
   * staleness scan; the client app can't, and passes nothing). The resolver
   * adds the ~3-day adoption lag itself — pass the RAW send date, not +3.
   */
  letterSentYmd?: string | null;
}

/**
 * THE canonical "when did/does this plan start" anchor — the single source of
 * truth so the client app's Day-1/week counter and the coach's retest dates
 * cannot drift apart. Priority (first hit wins):
 *
 *   1. meal_plan_started_on    — coach/client-confirmed meal start (locks it)
 *   2. supplements_started_on  — coach-confirmed; a real "they engaged" signal
 *   3. letterSentYmd + 3d      — a letter went out → ~3-day adoption lag
 *   4. plan_period_start + 3d  — authoring anchor + default adoption lag
 *   → null when none are known.
 *
 * The +3 adoption lag lives HERE in the estimate, so effectiveRecheckDate is
 * simply start + weeks×7 — there is exactly ONE lag in the chain, not two.
 *
 * Surfaces that can't supply `letterSentYmd` (the client app) use the narrower
 * effectiveMealPlanStart() instead, which collapses to step 1 → step 4 — i.e.
 * they AGREE with this resolver on every confirmed plan and on the plan_period
 * floor; they only forgo the letter-sent refinement they have no access to.
 */
export function effectivePlanStart(
  plan: PlanLike,
  opts: EffectiveStartOpts = {},
): string | null {
  const meal = parseYmd(plan.meal_plan_started_on);
  if (meal) return toYmd(meal);
  const supp = parseYmd(plan.supplements_started_on);
  if (supp) return toYmd(supp);
  const letter = parseYmd(opts.letterSentYmd ?? null);
  if (letter) return toYmd(addDays(letter, MEAL_PLAN_DEFAULT_DELAY_DAYS));
  const start = parseYmd(plan.plan_period_start);
  if (start) return toYmd(addDays(start, MEAL_PLAN_DEFAULT_DELAY_DAYS));
  return null;
}

/**
 * Effective recheck date = effective_meal_plan_start + plan_period_weeks × 7.
 *
 * This is the recheck the dashboard / calendar / coach-nudges should use.
 * The stored `plan_period_recheck_date` field is the originally-scheduled
 * date (audit / legacy display) — it does NOT move when the coach updates
 * the actual start date, but the effective recheck DOES.
 *
 * Returns YYYY-MM-DD or null if we can't compute it.
 */
export function effectiveRecheckDate(plan: PlanLike): string | null {
  const start = effectiveMealPlanStart(plan);
  if (!start || !plan.plan_period_weeks) return null;
  const parsed = parseYmd(start);
  if (!parsed) return null;
  return toYmd(addDays(parsed, plan.plan_period_weeks * 7));
}

/**
 * Is the effective recheck overdue relative to today (YYYY-MM-DD)?
 * Returns false if recheck can't be computed.
 */
export function isRecheckOverdue(plan: PlanLike, todayYmd: string): boolean {
  const recheck = effectiveRecheckDate(plan);
  if (!recheck) return false;
  return recheck < todayYmd;
}

/**
 * Whether the coach has explicitly captured the client's actual start date
 * (true) or we're operating off the default-delay assumption (false).
 * Used by the plan editor to surface "you're showing the default — confirm
 * when the client actually started" prompts.
 */
export function hasAssertedStart(plan: PlanLike): {
  meal: boolean;
  supplements: boolean;
} {
  // Use parseYmd so a malformed value (Invalid Date string, empty string,
  // rogue object) registers as "not asserted" instead of truthy-but-broken.
  return {
    meal: parseYmd(plan.meal_plan_started_on) != null,
    supplements: parseYmd(plan.supplements_started_on) != null,
  };
}

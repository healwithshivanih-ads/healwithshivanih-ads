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

// ── Travel extension (coach 2026-07-05) ─────────────────────────────────────
// When a client is on genuine travel or is ill, they're not actively running
// the protocol. Rather than push Day-1 (which corrupts the whole clock — the
// 2026-07-01 Dhanishta bug), we PAUSE: the paused days are added to the recheck
// and excluded from the week counter, so the client keeps their full N active
// weeks. Fully DERIVED from client.weight_loss.week_overrides on every render —
// never written to disk, so it can't rot into a stale Day-1 again.
//
// Rules (coach-confirmed): context ∈ {travel, illness} with mode ∈
// {maintenance, skip} pauses; deeper_deficit does NOT (she's working harder).
// Festival / plateau_break never extend. Capped at 14 days total per plan.
export const TRAVEL_EXTENSION_CAP_DAYS = 14;
/** Weight-loss clients: the goal weigh-in must never land on travel bloat, so
 *  the recheck is held to at least this many days after the last travel return. */
export const WEIGHT_LOSS_REENTRY_BUFFER_DAYS = 6;

const EXTENDING_CONTEXTS = new Set(["travel", "illness"]);
const EXTENDING_MODES = new Set(["maintenance", "skip"]);

/** Shape of a client.weight_loss.week_overrides[] entry, loosely typed — we
 *  only read the fields the extension needs, and tolerate legacy/partial rows. */
export interface TravelOverrideLike {
  date_from?: string | Date | null;
  date_to?: string | Date | null;
  mode?: string;
  context?: string;
  /** Destination, for the app's travel card (not used by the math). */
  location?: string;
  /** Defensive: some inbound rows carry a cancel flag; never count those. */
  cancelled?: boolean;
}

/** True when this override is a genuine pause that should extend the plan. */
function isPausingOverride(o: TravelOverrideLike): boolean {
  if (!o || o.cancelled) return false;
  if (!o.context || !EXTENDING_CONTEXTS.has(o.context)) return false;
  // Missing mode → treat as maintenance (the travel default; covers legacy rows
  // written before `mode` existed). deeper_deficit is the only excluded mode.
  const mode = o.mode || "maintenance";
  return EXTENDING_MODES.has(mode);
}

/** Whole-day overlap (inclusive) between [aStart,aEnd] and [bStart,bEnd]. */
function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Paused days from qualifying travel/illness overrides that fall inside the
 * window [windowStartYmd, windowEndYmd], capped at TRAVEL_EXTENSION_CAP_DAYS.
 * Pass window = [start, base-recheck] for the recheck extension, or
 * [start, today] for "how many paused days has she already used" (the week
 * counter). Returns 0 for no overrides / unparseable inputs.
 */
export function travelExtensionDays(
  overrides: TravelOverrideLike[] | undefined | null,
  windowStartYmd: string | null,
  windowEndYmd: string | null,
): number {
  if (!overrides?.length) return 0;
  const ws = parseYmd(windowStartYmd);
  const we = parseYmd(windowEndYmd);
  if (!ws || !we || we < ws) return 0;
  let days = 0;
  for (const o of overrides) {
    if (!isPausingOverride(o)) continue;
    const f = parseYmd(o.date_from ?? null);
    const t = parseYmd(o.date_to ?? null);
    if (!f || !t || t < f) continue;
    days += overlapDays(f, t, ws, we);
  }
  return Math.min(days, TRAVEL_EXTENSION_CAP_DAYS);
}

/** Latest travel/illness return date (date_to) among qualifying overrides that
 *  overlap [windowStartYmd, windowEndYmd]. Drives the weight-loss re-entry
 *  buffer. Returns a Date or null. */
function latestTravelReturn(
  overrides: TravelOverrideLike[] | undefined | null,
  windowStartYmd: string | null,
  windowEndYmd: string | null,
): Date | null {
  if (!overrides?.length) return null;
  const ws = parseYmd(windowStartYmd);
  const we = parseYmd(windowEndYmd);
  if (!ws || !we) return null;
  let latest: Date | null = null;
  for (const o of overrides) {
    if (!isPausingOverride(o)) continue;
    const f = parseYmd(o.date_from ?? null);
    const t = parseYmd(o.date_to ?? null);
    if (!f || !t || t < f) continue;
    if (overlapDays(f, t, ws, we) === 0) continue;
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

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

/** Optional inputs that shift the recheck for travel / weight-loss clients.
 *  Callers that have the client pass these; callers that don't get the plain
 *  start + weeks×7 recheck (unchanged behavior). */
export interface RecheckOpts {
  /** client.weight_loss.week_overrides — the travel/illness pause windows. */
  overrides?: TravelOverrideLike[] | null;
  /** client.weight_loss.enabled — turns on the post-travel weigh-in buffer. */
  weightLossEnabled?: boolean;
}

/**
 * Effective recheck date = effective_meal_plan_start + plan_period_weeks × 7,
 * plus any travel/illness pause (capped 14d), plus — for weight-loss clients —
 * a re-entry buffer so the goal weigh-in never lands on travel bloat.
 *
 * This is the recheck the dashboard / calendar / coach-nudges should use.
 * The stored `plan_period_recheck_date` field is the originally-scheduled
 * date (audit / legacy display) — it does NOT move when the coach updates
 * the actual start date, but the effective recheck DOES.
 *
 * `opts` is optional and back-compat: with no overrides the result is
 * identical to the old start + weeks×7.
 *
 * Returns YYYY-MM-DD or null if we can't compute it.
 */
export function effectiveRecheckDate(
  plan: PlanLike,
  opts: RecheckOpts = {},
): string | null {
  const start = effectiveMealPlanStart(plan);
  if (!start || !plan.plan_period_weeks) return null;
  const parsed = parseYmd(start);
  if (!parsed) return null;
  const base = addDays(parsed, plan.plan_period_weeks * 7);
  // Travel/illness pause: count paused days inside [start, base], cap 14.
  const ext = travelExtensionDays(opts.overrides, start, toYmd(base));
  let recheck = addDays(base, ext);
  // Weight-loss re-entry buffer: hold the weigh-in ≥6d past the last return.
  if (opts.weightLossEnabled) {
    const ret = latestTravelReturn(opts.overrides, start, toYmd(recheck));
    if (ret) {
      const buffered = addDays(ret, WEIGHT_LOSS_REENTRY_BUFFER_DAYS);
      if (buffered.getTime() > recheck.getTime()) recheck = buffered;
    }
  }
  return toYmd(recheck);
}

/**
 * Is the effective recheck overdue relative to today (YYYY-MM-DD)?
 * Returns false if recheck can't be computed.
 */
export function isRecheckOverdue(
  plan: PlanLike,
  todayYmd: string,
  opts: RecheckOpts = {},
): boolean {
  const recheck = effectiveRecheckDate(plan, opts);
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

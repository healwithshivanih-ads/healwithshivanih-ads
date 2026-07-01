/**
 * Weight-loss progress detector (#2) — the plateau / behind-pace brain.
 *
 * The system computes a calorie deficit once, sends the letter, and then
 * never looks at whether the client is actually losing weight. A client
 * losing 0.15 kg/wk against a 0.5 kg/wk goal — with no lab or adherence
 * red flag — sails through all 12 weeks untouched. This closes that loop:
 * given the client's weight-loss goal + their actual weigh-ins, it decides
 * whether they're on track, behind, plateaued, regaining, or overdue for a
 * weigh-in, and produces a coach-facing summary the dashboard / overview
 * can surface and the rework AI can act on.
 *
 * Pure + dependency-free, mirroring the plan-timing.ts pattern. A Python
 * twin lives in scripts/assess-rework.py (_weight_progress_summary) so the
 * rework AI sees the same judgment — kept deliberately duplicated, like the
 * alias-matching logic, since the two callers (engine vs UI) differ.
 *
 * IMPORTANT — weigh-ins come from THREE places and the detector unions all
 * of them. The client logs weight in the Ochre Tree app → that lands in
 * client.health_snapshots[] (source "client_app"), NOT measurements_log.
 * The coach's Log-entry button writes measurements_log. Intake writes the
 * flat client.measurements. A detector that read only one source would miss
 * most of a self-logging client's data.
 */

import { computeCaloriePhases } from "./calorie-phases";

// ── Tunables ────────────────────────────────────────────────────────────
/** Below this many weeks of elapsed data we don't judge pace — too noisy
 *  (water weight, a single early weigh-in) to call behind/plateau yet. */
const MIN_WEEKS_TO_JUDGE = 2;
/** actual loss below this fraction of expected loss → "behind". */
const BEHIND_ATTAINMENT = 0.5;
/** actual loss above this fraction of expected → "ahead". */
const AHEAD_ATTAINMENT = 1.3;
/** How far back from the latest weigh-in to gather "recent" readings for
 *  plateau detection. Wide enough to catch fortnightly weigh-ins. */
const PLATEAU_LOOKBACK_DAYS = 24;
/** Need at least this much flat stretch before calling it a plateau. */
const PLATEAU_MIN_SPAN_DAYS = 14;
/** Net change within ±this over the recent span counts as "flat". */
const PLATEAU_FLAT_KG = 0.25;
/** Gaining more than this above start (after MIN_WEEKS) → "regain". */
const REGAIN_KG = 0.3;
/** No weigh-in for this many days → nudge the client (separate axis). */
const STALE_WEIGH_IN_DAYS = 14;

/** Fallback expected weekly loss by pace tag, when the goal has no usable
 *  target date to derive the committed rate from. */
const PACE_WEEKLY_KG: Record<string, number> = {
  slow: 0.25,
  moderate: 0.5,
  faster: 0.75,
};

export type WeightProgressStatus =
  | "no_goal" // no (enabled, complete) weight-loss goal — nothing to assess
  | "no_data" // goal set but no weigh-in after the start date
  | "too_early" // < MIN_WEEKS_TO_JUDGE elapsed — too soon to judge pace
  | "on_track"
  | "ahead"
  | "behind" // actual loss < half expected
  | "plateau" // recent weights flat while a deficit is expected
  | "regain"; // trending up vs start

export interface WeightProgressResult {
  status: WeightProgressStatus;
  /** Short coach-facing line, e.g. "Behind pace · 1.6 of ~3.0 kg expected". */
  headline: string;
  /** One sentence of context / what to do. */
  detail: string;
  /** True for behind | plateau | regain, OR when the weigh-in is stale. */
  needsAttention: boolean;

  // Metrics — null when not computable.
  startKg: number | null;
  latestKg: number | null;
  latestDate: string | null; // YYYY-MM-DD
  weeksElapsed: number | null; // start → latest weigh-in
  expectedWeeklyKg: number | null;
  actualWeeklyKg: number | null;
  expectedLossKg: number | null;
  actualLossKg: number | null;
  attainmentPct: number | null; // actualLoss / expectedLoss × 100
  staleDays: number | null; // today − latest weigh-in
  readingsCount: number;
}

interface WeightLossGoalLike {
  enabled?: boolean;
  starting_weight_kg?: number;
  starting_date?: string;
  goal_kg?: number; // total kg to lose
  goal_target_date?: string;
  pace?: string;
  activity_level?: string;
  tdee_override?: number | null; // coach-applied observed-TDEE correction (#3)
}

interface ClientLike {
  weight_loss?: WeightLossGoalLike | null;
  measurements?: Record<string, unknown> | null;
  measurements_log?: Array<Record<string, unknown>> | null;
  health_snapshots?: Array<{
    date?: string;
    source?: string;
    measurements?: { weight_kg?: number | null } | null;
  }> | null;
}

interface Reading {
  date: string; // YYYY-MM-DD
  kg: number;
}

function parseYmd(value: unknown): Date | null {
  if (value == null) return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(t + "T00:00:00Z") : new Date(t);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(value: unknown): string | null {
  const d = parseYmd(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function daysBetween(aYmd: string, bYmd: string): number | null {
  const a = parseYmd(aYmd);
  const b = parseYmd(bYmd);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Union every weight reading across health_snapshots (client-app + lab),
 * measurements_log (coach Log entry), and the flat measurements object.
 * Returns ascending-by-date, one reading per date (measurements_log wins a
 * same-date tie as the explicit coach record, else the snapshot value).
 */
export function collectWeightSeries(client: ClientLike): Reading[] {
  const byDate = new Map<string, { kg: number; rank: number }>();
  // rank: higher wins a same-date collision. snapshot=1, log=2, flat=0.
  const put = (rawDate: unknown, rawKg: unknown, rank: number) => {
    const date = ymd(rawDate);
    const kg = typeof rawKg === "number" && Number.isFinite(rawKg) ? rawKg : null;
    if (!date || kg == null || kg < 20 || kg > 400) return;
    const existing = byDate.get(date);
    if (!existing || rank >= existing.rank) byDate.set(date, { kg, rank });
  };

  for (const s of client.health_snapshots ?? []) {
    put(s?.date, s?.measurements?.weight_kg, 1);
  }
  for (const e of client.measurements_log ?? []) {
    put(e?.date, (e as { weight_kg?: unknown })?.weight_kg, 2);
  }
  // Flat bio measurement — only usable if it carries a date. Inventing
  // "today" for an undated weight is wrong (non-deterministic, and it masks a
  // stale weigh-in by faking a fresh one) — skip it instead.
  const flat = client.measurements;
  if (flat && typeof flat.measured_on === "string" && flat.measured_on.trim()) {
    put(flat.measured_on, flat.weight_kg, 0);
  }

  return [...byDate.entries()]
    .map(([date, v]) => ({ date, kg: v.kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function goalIsComplete(g: WeightLossGoalLike | null | undefined): g is WeightLossGoalLike {
  return Boolean(
    g &&
      g.enabled !== false &&
      typeof g.starting_weight_kg === "number" &&
      g.starting_weight_kg > 0 &&
      typeof g.goal_kg === "number" &&
      g.goal_kg > 0 &&
      g.starting_date,
  );
}

const EMPTY = (
  status: WeightProgressStatus,
  headline: string,
  detail: string,
  readingsCount = 0,
): WeightProgressResult => ({
  status,
  headline,
  detail,
  needsAttention: false,
  startKg: null,
  latestKg: null,
  latestDate: null,
  weeksElapsed: null,
  expectedWeeklyKg: null,
  actualWeeklyKg: null,
  expectedLossKg: null,
  actualLossKg: null,
  attainmentPct: null,
  staleDays: null,
  readingsCount,
});

/**
 * Assess weight-loss progress for one client. `todayYmd` defaults to the
 * current date (injectable for tests / deterministic rendering).
 */
export function assessWeightProgress(
  client: ClientLike,
  todayYmd?: string,
): WeightProgressResult {
  const today = todayYmd ?? new Date().toISOString().slice(0, 10);
  const goal = client.weight_loss ?? null;

  if (!goalIsComplete(goal)) {
    return EMPTY("no_goal", "No weight-loss goal", "No active goal to track.");
  }

  const startKg = goal.starting_weight_kg as number;
  const startDate = ymd(goal.starting_date) as string;

  // Committed weekly rate: prefer goal_kg over the goal window; fall back to
  // the pace tag. This is the rate the client actually signed up for.
  let expectedWeeklyKg: number;
  const totalDays = goal.goal_target_date ? daysBetween(startDate, ymd(goal.goal_target_date) as string) : null;
  if (totalDays && totalDays >= 7 && goal.goal_kg) {
    expectedWeeklyKg = goal.goal_kg / (totalDays / 7);
  } else {
    expectedWeeklyKg = PACE_WEEKLY_KG[goal.pace ?? "moderate"] ?? 0.5;
  }

  // Weigh-ins on or after the start date (a reading before start isn't
  // progress against this goal).
  const series = collectWeightSeries(client).filter((r) => r.date >= startDate);
  const readingsCount = series.length;

  if (readingsCount === 0) {
    const r = EMPTY(
      "no_data",
      "No weigh-ins yet",
      "Goal is set but the client hasn't logged a weight since starting — ask them to weigh in so we can track the trend.",
    );
    r.startKg = startKg;
    r.expectedWeeklyKg = round1(expectedWeeklyKg);
    return r;
  }

  const latest = series[series.length - 1];
  const latestKg = latest.kg;
  const latestDate = latest.date;
  const daysElapsed = daysBetween(startDate, latestDate) ?? 0;
  const weeksElapsed = daysElapsed / 7;
  const staleDays = daysBetween(latestDate, today);

  const actualLossKg = round1(startKg - latestKg);
  const expectedLossKg = round1(expectedWeeklyKg * weeksElapsed);
  const actualWeeklyKg = weeksElapsed > 0 ? round1((startKg - latestKg) / weeksElapsed) : 0;
  const attainmentPct =
    expectedLossKg > 0 ? Math.round(((startKg - latestKg) / (expectedWeeklyKg * weeksElapsed)) * 100) : null;

  // Recent-window flatness for plateau detection: readings within the last
  // PLATEAU_WINDOW_DAYS of the latest weigh-in.
  const windowStart = latestDate;
  const recent = series.filter((r) => {
    const d = daysBetween(r.date, windowStart);
    return d != null && d >= 0 && d <= PLATEAU_LOOKBACK_DAYS;
  });
  let recentSpanDays = 0;
  let recentNetKg = 0;
  if (recent.length >= 2) {
    recentSpanDays = daysBetween(recent[0].date, recent[recent.length - 1].date) ?? 0;
    recentNetKg = recent[0].kg - recent[recent.length - 1].kg; // positive = lost
  }

  const base: WeightProgressResult = {
    status: "on_track",
    headline: "",
    detail: "",
    needsAttention: false,
    startKg,
    latestKg: round1(latestKg),
    latestDate,
    weeksElapsed: round1(weeksElapsed),
    expectedWeeklyKg: round1(expectedWeeklyKg),
    actualWeeklyKg,
    expectedLossKg,
    actualLossKg,
    attainmentPct,
    staleDays,
    readingsCount,
  };

  const stale = staleDays != null && staleDays > STALE_WEIGH_IN_DAYS;

  // Too early to judge pace — but still surface staleness if applicable.
  if (weeksElapsed < MIN_WEEKS_TO_JUDGE) {
    base.status = "too_early";
    base.headline = `Week ${Math.max(1, Math.round(weeksElapsed))} · ${actualLossKg > 0 ? `down ${actualLossKg} kg` : "no change yet"}`;
    base.detail = stale
      ? `Last weigh-in ${staleDays} days ago — ask for a fresh weight. Too early to judge pace.`
      : "Too early to judge pace — give it a couple of weeks of data.";
    base.needsAttention = stale;
    return base;
  }

  const expStr = `~${expectedLossKg} kg`;
  const plateau =
    recent.length >= 2 &&
    recentSpanDays >= PLATEAU_MIN_SPAN_DAYS &&
    Math.abs(recentNetKg) <= PLATEAU_FLAT_KG &&
    expectedWeeklyKg > 0;

  if (latestKg > startKg + REGAIN_KG) {
    base.status = "regain";
    base.headline = `Regaining · up ${round1(latestKg - startKg)} kg vs start`;
    base.detail = `Weight is above the starting point after ${Math.round(weeksElapsed)} weeks. Something is off — re-check the deficit, adherence, sleep/stress, thyroid, and any weight-gain medication before pushing harder.`;
    base.needsAttention = true;
  } else if (plateau) {
    base.status = "plateau";
    base.headline = `Plateau · flat ~${Math.round(recentSpanDays / 7)} wk`;
    base.detail = `Weight has barely moved (${round1(recentNetKg)} kg) over the last ${recentSpanDays} days while a deficit is expected. Time to adjust — recompute the target, tighten portions, add a refeed/diet-break, or look at the metabolic blockers (thyroid, cortisol, sleep).`;
    base.needsAttention = true;
  } else if (attainmentPct != null && attainmentPct < BEHIND_ATTAINMENT * 100) {
    base.status = "behind";
    base.headline = `Behind pace · ${actualLossKg} of ${expStr} expected`;
    base.detail = `Losing ~${actualWeeklyKg} kg/wk vs the ~${round1(expectedWeeklyKg)} kg/wk plan (${attainmentPct}% of expected by now). The prescribed deficit may not be a real deficit — verify portions/adherence and consider re-running the plan.`;
    base.needsAttention = true;
  } else if (attainmentPct != null && attainmentPct > AHEAD_ATTAINMENT * 100) {
    base.status = "ahead";
    base.headline = `Ahead of pace · ${actualLossKg} kg down`;
    base.detail = `Losing faster than planned (${attainmentPct}% of expected). Make sure it's sustainable and not muscle — check protein + that the floor (≥1200 kcal) is respected.`;
    base.needsAttention = false;
  } else {
    base.status = "on_track";
    base.headline = `On track · ${actualLossKg} of ${expStr}`;
    base.detail = `Losing ~${actualWeeklyKg} kg/wk, roughly on the ~${round1(expectedWeeklyKg)} kg/wk plan.`;
    base.needsAttention = false;
  }

  // Staleness is an independent axis — flag a nudge even when the trend is fine.
  if (stale) {
    base.needsAttention = true;
    base.detail += ` (Last weigh-in ${staleDays} days ago — ask for a fresh weight to keep the trend live.)`;
  }

  return base;
}

// ── Observed-TDEE reality check (#3) ──────────────────────────────────────
//
// Predicted TDEE (Mifflin × activity) systematically overestimates real
// energy expenditure for perimenopausal / hypothyroid / insulin-resistant
// women, so the prescribed "deficit" often isn't a real deficit. Once a
// client has ~2+ weeks of weigh-ins we can MEASURE their real burn from
// energy balance — and that beats the formula. Caveat: this assumes the
// client ate roughly at the prescribed target; if not, the same correction
// still helps (eating-over-plan and low-TDEE both call for a lower target).

const KCAL_PER_KG = 7700;
// 3 weeks minimum: the first 1-2 weeks of a deficit shed water + glycogen,
// not fat, which inflates an energy-balance TDEE estimate (and would wrongly
// RAISE the target). Wait for the whoosh to settle before measuring.
const MIN_TDEE_WINDOW_DAYS = 21;
// Under 4 weeks the estimate is directional, not firm — flag it.
const LOW_CONFIDENCE_WINDOW_DAYS = 28;
const CALORIE_FLOOR = 1200;

export interface ObservedTdeeEstimate {
  /** TDEE currently driving the plan (Mifflin, or an applied override). */
  modelTdee: number;
  /** TDEE measured from the client's actual weight change. */
  observedTdee: number;
  /** (observed − model) / model × 100. Negative = real burn below the model. */
  divergencePct: number;
  avgPrescribedIntake: number;
  observedLossKg: number;
  windowDays: number;
  expectedWeeklyKg: number;
  requiredDailyDeficit: number;
  /** The full-deficit daily target recomputed off observed TDEE (floored). */
  correctedFullTarget: number;
  /** True when hitting the goal pace would require going below the floor. */
  flooredAtMin: boolean;
  /** Fastest safe loss at the calorie floor given the observed burn. */
  achievablePaceAtFloor: number;
  /** Value the coach would store as weight_loss.tdee_override. */
  recommendedOverride: number;
  currentOverride: number | null;
  alreadyApplied: boolean;
  /** < 4 weeks of data — directional only, partly water-weight-driven. */
  lowConfidence: boolean;
}

function phaseBucketWeekly(phases: { wk1_2: number; wk3_4: number; wk5_8: number; wk9_10: number; wk11_12: number }, week: number): number {
  if (week <= 2) return phases.wk1_2;
  if (week <= 4) return phases.wk3_4;
  if (week <= 8) return phases.wk5_8;
  if (week <= 10) return phases.wk9_10;
  return phases.wk11_12;
}

/**
 * Estimate the client's real TDEE from observed weight change and recommend
 * a corrected calorie target. Returns null when there isn't enough data
 * (needs a goal, ≥ MIN_TDEE_WINDOW_DAYS elapsed, and a computable calorie
 * model). Pure; `todayYmd` injectable for tests.
 */
export function estimateObservedTdee(
  client: ClientLike,
  todayYmd?: string,
): ObservedTdeeEstimate | null {
  const wp = assessWeightProgress(client, todayYmd);
  if (
    wp.status === "no_goal" ||
    wp.status === "no_data" ||
    wp.weeksElapsed == null ||
    wp.startKg == null ||
    wp.latestKg == null ||
    wp.expectedWeeklyKg == null
  ) {
    return null;
  }
  const windowDays = Math.round(wp.weeksElapsed * 7);
  if (windowDays < MIN_TDEE_WINDOW_DAYS) return null;

  const wl = client.weight_loss ?? {};
  const phases = computeCaloriePhases(
    client as Parameters<typeof computeCaloriePhases>[0],
    wl as Parameters<typeof computeCaloriePhases>[1],
  );
  if (!phases) return null;

  // Average daily intake actually prescribed across the elapsed weeks.
  const weeks = Math.max(1, Math.ceil(wp.weeksElapsed));
  let intakeSum = 0;
  for (let w = 1; w <= weeks; w++) intakeSum += phaseBucketWeekly(phases.phases, w);
  const avgPrescribedIntake = intakeSum / weeks;

  // Energy balance: lost_kg × 7700 = (TDEE − intake) × days.
  const observedLossKg = wp.startKg - wp.latestKg; // may be negative (regain)
  const observedTdee = Math.round(avgPrescribedIntake + (observedLossKg * KCAL_PER_KG) / windowDays);
  if (observedTdee < 800 || observedTdee > 4500) return null; // implausible → don't mislead

  const requiredDailyDeficit = Math.round((wp.expectedWeeklyKg * KCAL_PER_KG) / 7);
  const correctedRaw = observedTdee - requiredDailyDeficit;
  const correctedFullTarget = Math.max(CALORIE_FLOOR, Math.round(correctedRaw));
  const achievablePaceAtFloor =
    observedTdee > CALORIE_FLOOR ? round1(((observedTdee - CALORIE_FLOOR) * 7) / KCAL_PER_KG) : 0;
  const currentOverride =
    typeof wl.tdee_override === "number" && wl.tdee_override > 0 ? wl.tdee_override : null;

  return {
    modelTdee: phases.tdee,
    observedTdee,
    divergencePct: Math.round(((observedTdee - phases.tdee) / phases.tdee) * 100),
    avgPrescribedIntake: Math.round(avgPrescribedIntake),
    observedLossKg: round1(observedLossKg),
    windowDays,
    expectedWeeklyKg: wp.expectedWeeklyKg,
    requiredDailyDeficit,
    correctedFullTarget,
    flooredAtMin: correctedRaw < CALORIE_FLOOR,
    achievablePaceAtFloor,
    recommendedOverride: observedTdee,
    currentOverride,
    alreadyApplied: currentOverride != null && Math.abs(currentOverride - observedTdee) <= 30,
    lowConfidence: windowDays < LOW_CONFIDENCE_WINDOW_DAYS,
  };
}

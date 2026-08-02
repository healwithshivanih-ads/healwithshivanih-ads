/**
 * Programme tenure — how long this client has been with the coach, across
 * every phase, not just the plan that happens to be current.
 *
 * THE PROBLEM THIS EXISTS FOR. Every surface used to ask "where is she in the
 * plan?" and nothing asked "how long has she been here?", so a continuing
 * client was indistinguishable from a new one the moment a successor plan
 * published. Nidhi Jain published phase 3 on 2026-08-02 and was: sent the
 * onboarding welcome email, put back into the "Foundation" phase arc, and —
 * the one that made the coach stop — handed a sapling in place of the fruiting
 * tree she had grown over twelve weeks.
 *
 * The fix is one primitive, consumed everywhere, rather than each surface
 * inventing its own idea of "week".
 *
 * DEFINITIONS (chosen deliberately — see the tests for the cases that pin them):
 *
 *   phaseNumber        The coach's own numbering, read from the `…-plan-N-…`
 *                      slug when present, else the length of the supersede
 *                      chain. Slug-first because that is what the coach, the
 *                      letters and the client all already call it — Nidhi's
 *                      first plan is `nidhi-plan-2-…`, so her chain is 2 long
 *                      while everyone calls the current one phase 3.
 *
 *   weeksWithCoach     Weeks actually spent ON a protocol, summed across the
 *                      chain. A gap between phases is NOT counted: a client who
 *                      took three months off did not spend them with the coach.
 *                      Travel/illness pauses are subtracted per phase, the same
 *                      way each phase's own recheck extends (plan-timing.ts).
 *
 *   totalWeeksWithCoach  Sum of every phase's planned length. Pairs with
 *                      weeksWithCoach for consumers that clamp (the growing
 *                      tree clamps week to totalWeeks — feed it a cumulative
 *                      week without a cumulative total and it clamps straight
 *                      back to 12).
 *
 *   weekOfPhase        Week within the CURRENT plan — what "Week 3 of 12"
 *                      already means on every screen today. Unchanged meaning,
 *                      kept here so callers need one call, not two.
 *
 * Pure: no I/O, no React. Callers pass the client's plans (all buckets — the
 * chain runs through `superseded/`, which `loadAllPlans()` already reads).
 */

import {
  effectiveMealPlanStart,
  effectiveRecheckDate,
  travelExtensionDays,
  type RecheckOpts,
  type PlanLike,
} from "./plan-timing";

/** The plan fields tenure reads. Duck-typed so a raw loader row satisfies it. */
export interface TenurePlanLike extends PlanLike {
  slug?: string;
  supersedes?: string | null;
  client_id?: string;
}

export interface ProgrammeTenure {
  /** Coach-facing phase number (slug-first, chain-length fallback). ≥ 1. */
  phaseNumber: number;
  /** True when this plan continues a prior one — the single flag most callers want. */
  continued: boolean;
  /** Week within the current plan, 1-based, clamped to the plan's length. */
  weekOfPhase: number;
  /** Cumulative weeks on a protocol across all phases, 1-based, gaps excluded. */
  weeksWithCoach: number;
  /** Sum of every phase's planned weeks — the ceiling for weeksWithCoach. */
  totalWeeksWithCoach: number;
  /** Effective start of the EARLIEST phase — her real day one. YYYY-MM-DD. */
  firstStartYmd: string | null;
  /** How many plans are in the supersede chain, including the current one. */
  chainLength: number;
}

const MS_PER_DAY = 86_400_000;
const MAX_CHAIN = 24; // runaway/cycle backstop; nobody has 24 phases

function parseYmdUtc(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function planWeeks(p: TenurePlanLike | undefined): number {
  const n = Number(p?.plan_period_weeks);
  return Number.isFinite(n) && n >= 1 && n <= 52 ? Math.round(n) : 12;
}

/** `<stem>-plan-N-<rest>` → N. Mirrors the same parse in render-client-letter.py
 *  so the letter's "phase 3" and the app's phase number can never disagree. */
export function phaseNumberFromSlug(slug: string | undefined | null): number | null {
  const m = /^(.+?)-plan-(\d+)-(.+)$/.exec(String(slug ?? ""));
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Walk the supersede chain from `current` back to the earliest ancestor.
 * Returns oldest-first. Missing ancestors simply end the walk — a plan whose
 * predecessor was deleted still yields a valid (shorter) chain rather than
 * throwing.
 */
export function supersedeChain(
  current: TenurePlanLike | null | undefined,
  allPlans: TenurePlanLike[],
): TenurePlanLike[] {
  if (!current) return [];
  const bySlug = new Map<string, TenurePlanLike>();
  for (const p of allPlans) {
    const s = String(p.slug ?? "");
    // First writer wins: a slug can exist in two buckets mid-transition
    // (published/<slug>-vN.yaml lingering next to a superseded copy).
    if (s && !bySlug.has(s)) bySlug.set(s, p);
  }
  const chain: TenurePlanLike[] = [current];
  const seen = new Set<string>([String(current.slug ?? "")]);
  let cursor = current;
  while (chain.length < MAX_CHAIN) {
    const prevSlug = String(cursor.supersedes ?? "").trim();
    if (!prevSlug || seen.has(prevSlug)) break;
    const prev = bySlug.get(prevSlug);
    if (!prev) break;
    seen.add(prevSlug);
    chain.unshift(prev);
    cursor = prev;
  }
  return chain;
}

/**
 * Build the tenure snapshot.
 *
 * `todayYmd` is the caller's "today" (IST-local day for this app, matching
 * client-app.ts). `opts` carries the travel/illness overrides so paused days
 * are excluded — pass the same ones the recheck resolver gets.
 */
export function buildTenure(
  currentPlan: TenurePlanLike | null | undefined,
  allPlans: TenurePlanLike[],
  todayYmd: string,
  opts: RecheckOpts = {},
): ProgrammeTenure {
  const empty: ProgrammeTenure = {
    phaseNumber: 1,
    continued: false,
    weekOfPhase: 1,
    weeksWithCoach: 1,
    totalWeeksWithCoach: planWeeks(currentPlan ?? undefined),
    firstStartYmd: null,
    chainLength: currentPlan ? 1 : 0,
  };
  if (!currentPlan) return empty;

  const chain = supersedeChain(currentPlan, allPlans);
  const today = parseYmdUtc(todayYmd);
  const totalWeeksWithCoach = chain.reduce((n, p) => n + planWeeks(p), 0) || planWeeks(currentPlan);

  // Each phase contributes only the days actually lived INSIDE it: from its
  // effective start to the earliest of
  //   today · the next phase's start · this phase's own effective recheck.
  //
  // All three caps are load-bearing. Without the next-phase cap, a phase that
  // overruns double-counts days its successor owns. Without its OWN end cap, a
  // three-month gap between phases gets credited to the older phase — which is
  // exactly what the gap test caught: a client who stopped for a season would
  // have accrued tenure for the time she was away.
  let elapsedDays = 0;
  let firstStartYmd: string | null = null;
  for (let i = 0; i < chain.length; i++) {
    const startYmd = effectiveMealPlanStart(chain[i]);
    const start = parseYmdUtc(startYmd);
    if (!start) continue;
    if (!firstStartYmd) firstStartYmd = startYmd;
    const candidates: Date[] = [];
    if (today) candidates.push(today);
    const nextStart = i + 1 < chain.length ? parseYmdUtc(effectiveMealPlanStart(chain[i + 1])) : null;
    if (nextStart) candidates.push(nextStart);
    const ownEnd = parseYmdUtc(effectiveRecheckDate(chain[i], opts));
    if (ownEnd) candidates.push(ownEnd);
    if (candidates.length === 0) continue;
    const hardEnd = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    const rawDays = Math.floor((hardEnd.getTime() - start.getTime()) / MS_PER_DAY);
    if (rawDays <= 0) continue; // phase hasn't begun (future start)
    const endYmd = new Date(start.getTime() + rawDays * MS_PER_DAY).toISOString().slice(0, 10);
    const paused = travelExtensionDays(opts.overrides, startYmd, endYmd);
    elapsedDays += Math.max(0, rawDays - paused);
  }

  const weeksWithCoach = Math.min(
    Math.max(1, Math.floor(elapsedDays / 7) + 1),
    Math.max(1, totalWeeksWithCoach),
  );

  // Week within the current plan — same arithmetic client-app.ts runs, kept
  // here so a caller needs one source, not two that can drift.
  const curStartYmd = effectiveMealPlanStart(currentPlan);
  const curStart = parseYmdUtc(curStartYmd);
  let weekOfPhase = 1;
  if (curStart && today) {
    const ref = today.getTime() < curStart.getTime() ? curStart : today;
    const days = Math.floor((ref.getTime() - curStart.getTime()) / MS_PER_DAY);
    const paused = travelExtensionDays(opts.overrides, curStartYmd, todayYmd);
    weekOfPhase = Math.min(
      Math.max(Math.floor((days - paused) / 7) + 1, 1),
      planWeeks(currentPlan),
    );
  }

  const chainLength = chain.length;
  const phaseNumber = phaseNumberFromSlug(currentPlan.slug) ?? chainLength;

  return {
    phaseNumber: Math.max(1, phaseNumber),
    continued: chainLength > 1 || Boolean(String(currentPlan.supersedes ?? "").trim()),
    weekOfPhase,
    weeksWithCoach,
    totalWeeksWithCoach: Math.max(1, totalWeeksWithCoach),
    firstStartYmd,
    chainLength,
  };
}

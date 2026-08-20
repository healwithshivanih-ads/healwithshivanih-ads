/**
 * App-state resolver — the single source of truth for which mode the client
 * companion app (The Ochre Tree) renders in. See docs/PLAN_END_GAME_SPEC.md
 * and docs/PLAN_END_GAME_BUILD_CHECKLIST.md.
 *
 * "End of plan" is a decision point, never an app lock-out. The app NEVER hard
 * locks — at week 12 it transitions to a REVIEW state, then to one of the paid
 * tracks, and if the client pays for nothing it degrades gracefully to a frozen
 * LIBRARY floor that does not expire.
 *
 * This is a PURE function — no I/O, no React. Every UI gate and nudge reads its
 * result; never branch app modes ad hoc anywhere else.
 *
 * Modes (the spec lists six; PHASE2 collapses into ACTIVE here — see below):
 *   ACTIVE      — inside the protocol window (incl. continued phase-2 plans)
 *   REVIEW      — at/near the recheck: show graduation report + Continue/Maintain
 *   MAINTENANCE — paid hands-free tier is current
 *   GRACE       — maintenance lapsed, still inside the 15-day full-access window
 *   LIBRARY     — frozen free floor (never paid, lapsed past grace, or no plan)
 *
 * PHASE2 from the spec ("a newer published plan supersedes the old one →
 * resolves to ACTIVE") is not a distinct render mode: by the time we resolve,
 * the app token already points at the latest published plan, and a continued
 * phase renders identically to ACTIVE. We surface it via `result.continued`
 * (true when plan.supersedes is set) so callers can label it without a separate
 * gating branch.
 */

import { effectiveRecheckDate, type RecheckOpts } from "./plan-timing";

export type AppMode = "ACTIVE" | "REVIEW" | "MAINTENANCE" | "GRACE" | "LIBRARY";

/** Days before the effective recheck that the REVIEW window opens. */
export const REVIEW_LEAD_DAYS = 14;
/** Shorter REVIEW lead for short engagements (coach decision 2026-07-07): a
 *  14-day lead on a 4-week plan would show graduation copy at the halfway
 *  mark, so plans of SHORT_PLAN_MAX_WEEKS or fewer open REVIEW 7 days out. */
export const REVIEW_LEAD_DAYS_SHORT = 7;
export const SHORT_PLAN_MAX_WEEKS = 6;
/** Full-access window after maintenance lapses before dropping to LIBRARY. */
export const GRACE_DAYS = 15;
/** Days before the effective recheck that the "your programme is finishing"
 *  heads-up appears in the app. Deliberately SHORTER than the REVIEW lead:
 *  REVIEW opens 14 days out (7 for short plans) and carries the graduation
 *  report; this note is the final-week, dated "here's the day, and here's what
 *  stays" reassurance — see resolveFinalStretch. */
export const FINAL_STRETCH_DAYS = 7;

/** Plan timing/lifecycle fields the resolver reads. Duck-typed so a raw loader
 *  object (which carries far more) satisfies it. */
export interface AppModePlan {
  // Required on a real Plan, so never null — kept assignable to PlanLike in
  // plan-timing.ts. (parseYmd there still coerces any rogue null at runtime.)
  plan_period_start?: string | Date;
  plan_period_weeks?: number;
  meal_plan_started_on?: string | Date | null;
  supplements_started_on?: string | Date | null;
  supersedes?: string | null;
  status?: string | null;
}

/** REVIEW lead for a given plan: REVIEW_LEAD_DAYS_SHORT for short engagements
 *  (plan_period_weeks ≤ SHORT_PLAN_MAX_WEEKS), REVIEW_LEAD_DAYS otherwise.
 *  Every REVIEW-window computation (resolver + coach nudges) must go through
 *  this so the app and the coach dashboard agree on when the window opens. */
export function reviewLeadDays(plan: AppModePlan | null | undefined): number {
  const w = Number(plan?.plan_period_weeks);
  return Number.isFinite(w) && w >= 1 && w <= SHORT_PLAN_MAX_WEEKS
    ? REVIEW_LEAD_DAYS_SHORT
    : REVIEW_LEAD_DAYS;
}

export interface AppModeInput {
  /** Coarse label; the resolver trusts `maintenance_paid_through` over this. */
  maintenance_status?: string | null;
  /** YYYY-MM-DD. The truth that drives MAINTENANCE / GRACE / LIBRARY. */
  maintenance_paid_through?: string | null;
  /** The current published plan (latest, as resolved from the app token). */
  plan?: AppModePlan | null;
  /** Travel/illness pause + weight-loss buffer, so graduation timing extends
   *  for travellers instead of flipping to REVIEW ~2 weeks early. */
  recheckOpts?: RecheckOpts;
}

export interface AppModeResult {
  mode: AppMode;
  /** Human-readable why, for telemetry + the coach-facing chip. */
  reason: string;
  /** True when the plan continues a prior one (spec's PHASE2; renders ACTIVE). */
  continued: boolean;
}

/** Add n days to a YYYY-MM-DD string in UTC, returning YYYY-MM-DD. Mirrors the
 *  UTC discipline in plan-timing.ts so comparisons never skew in IST. */
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD strings compare lexicographically === chronologically. */
function isValidYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Whole days from `fromYmd` to `toYmd` (UTC, so no IST skew). */
function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00Z").getTime();
  const b = new Date(toYmd + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Resolve the client's current app mode. `todayYmd` is the caller's "today" in
 * YYYY-MM-DD (pass IST-local day; the app uses Asia/Kolkata).
 *
 * Precedence:
 *   1. A maintenance record (status active/lapsed OR a paid_through date) takes
 *      precedence over the base plan window — it keys MAINTENANCE/GRACE/LIBRARY
 *      purely off `maintenance_paid_through`.
 *   2. Otherwise the plan window decides ACTIVE vs REVIEW.
 *   3. Nothing usable → LIBRARY (the silent floor).
 *
 * Decline → LIBRARY (coach decision 2026-06-15): REVIEW runs from
 * REVIEW_LEAD_DAYS before the recheck through GRACE_DAYS after it. A client who
 * neither continues nor maintains within that window falls to the LIBRARY floor
 * automatically — the same 15-day grace the maintenance-lapse path uses. It is
 * purely time-based (no explicit "decline" tap needed) and fully recoverable:
 * publishing the next plan or starting maintenance flips them back out.
 */
export function resolveAppMode(
  input: AppModeInput,
  todayYmd: string,
): AppModeResult {
  const continued = !!input.plan?.supersedes;

  // ── 1. Maintenance track present? Drive purely off paid_through. ──────────
  const paidThrough = isValidYmd(input.maintenance_paid_through)
    ? input.maintenance_paid_through
    : null;
  const onMaintenanceTrack =
    input.maintenance_status === "active" ||
    input.maintenance_status === "lapsed" ||
    paidThrough != null;

  if (onMaintenanceTrack) {
    if (!paidThrough) {
      // Status set but no date: trust the coarse label, fail safe.
      if (input.maintenance_status === "active") {
        return { mode: "MAINTENANCE", reason: "maintenance active (no paid_through on file)", continued };
      }
      return { mode: "LIBRARY", reason: "maintenance lapsed (no paid_through on file)", continued };
    }
    if (todayYmd <= paidThrough) {
      return { mode: "MAINTENANCE", reason: `paid through ${paidThrough}`, continued };
    }
    const graceEnd = addDaysYmd(paidThrough, GRACE_DAYS);
    if (todayYmd <= graceEnd) {
      return { mode: "GRACE", reason: `lapsed ${paidThrough}; grace until ${graceEnd}`, continued };
    }
    return { mode: "LIBRARY", reason: `lapsed past grace (${graceEnd})`, continued };
  }

  // ── 2. No maintenance → the plan window decides. ─────────────────────────
  if (!input.plan) {
    return { mode: "LIBRARY", reason: "no plan on file", continued };
  }

  const recheck = effectiveRecheckDate(input.plan, input.recheckOpts);
  if (!recheck) {
    // Published plan but we can't compute the window (missing dates) — stay
    // ACTIVE rather than prematurely show graduation.
    return { mode: "ACTIVE", reason: "active; recheck date unknown", continued };
  }

  const reviewStart = addDaysYmd(recheck, -reviewLeadDays(input.plan));
  if (todayYmd < reviewStart) {
    return { mode: "ACTIVE", reason: `in protocol; recheck ${recheck}`, continued };
  }

  // REVIEW runs from the plan's review lead before the recheck through GRACE_DAYS
  // after it. Past that window with no continue/maintain decision → LIBRARY
  // (same 15-day grace as the maintenance-lapse path; coach decision 2026-06-15).
  const reviewEnd = addDaysYmd(recheck, GRACE_DAYS);
  if (todayYmd <= reviewEnd) {
    return {
      mode: "REVIEW",
      reason:
        todayYmd <= recheck
          ? `recheck ${recheck} approaching`
          : `recheck ${recheck} passed; grace until ${reviewEnd}`,
      continued,
    };
  }
  return { mode: "LIBRARY", reason: `review lapsed (no decision by ${reviewEnd})`, continued };
}

/** The final-week heads-up: the plan's last day, and how far off it is. */
export interface FinalStretchNote {
  /** The EFFECTIVE recheck — travel/illness pauses and the weight-loss re-entry
   *  buffer already applied, so a client who paused is never warned early. */
  recheckDate: string;
  /** Whole days from today to that date: FINAL_STRETCH_DAYS … 1, then 0 on the
   *  day itself. Never negative — past the date this resolver returns null. */
  daysLeft: number;
}

/**
 * Should the app show the "your programme is finishing" heads-up today?
 *
 * The problem it solves: a client's app switches from their live plan to the
 * frozen LIBRARY floor purely on dates. cl-017 dropped on 19 Aug and opened the
 * app the next day to find it changed — it reads as something being taken away.
 * This makes the change EXPECTED: a dated, calm note in the final stretch.
 *
 * Three gates, all of which must hold:
 *
 *   1. mode === "REVIEW". Anything else already owns its own message and this
 *      note would contradict it — a MAINTENANCE client is not finishing, and a
 *      LIBRARY client has already finished. (In practice ACTIVE can never be
 *      inside the window either: REVIEW opens 14 days out, 7 for short plans.)
 *   2. Today is on or before the effective recheck. REVIEW runs GRACE_DAYS PAST
 *      the recheck; once it's passed, the graduation report's "you've reached
 *      the finish line" is the truth and "finishing soon" would be a lie.
 *   3. Today is within FINAL_STRETCH_DAYS of it — not from day one.
 *
 * `recheckOpts` must carry the client's travel overrides + weight-loss flag
 * (client.weight_loss). A bare call is travel-blind: a client who paused for a
 * fortnight would be told they finish on the un-extended date, which is both
 * wrong and exactly the kind of surprise this note exists to prevent.
 */
export function resolveFinalStretch(
  mode: AppMode,
  plan: AppModePlan | null | undefined,
  todayYmd: string,
  recheckOpts: RecheckOpts = {},
): FinalStretchNote | null {
  if (mode !== "REVIEW" || !plan || !isValidYmd(todayYmd)) return null;
  const recheck = effectiveRecheckDate(plan, recheckOpts);
  if (!isValidYmd(recheck)) return null;
  // Past the finish date → the graduation copy owns it, not this note.
  if (todayYmd > recheck) return null;
  const daysLeft = daysBetweenYmd(todayYmd, recheck);
  if (daysLeft > FINAL_STRETCH_DAYS) return null;
  return { recheckDate: recheck, daysLeft };
}

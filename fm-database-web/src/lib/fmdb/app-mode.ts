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
/** Full-access window after maintenance lapses before dropping to LIBRARY. */
export const GRACE_DAYS = 15;

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

  const reviewStart = addDaysYmd(recheck, -REVIEW_LEAD_DAYS);
  if (todayYmd < reviewStart) {
    return { mode: "ACTIVE", reason: `in protocol; recheck ${recheck}`, continued };
  }

  // REVIEW runs from REVIEW_LEAD_DAYS before the recheck through GRACE_DAYS
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

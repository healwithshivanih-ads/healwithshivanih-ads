/**
 * lifecycle.ts — ONE answer to "where is this person in their journey".
 *
 * Before 2026-10-23 that fact was spread across thirteen stores
 * (engagement_status, lapsed_on, lifecycle_state, maintenance_paid_through,
 * plan.is_maintenance, the published/ folder, _renewal_decisions.yaml,
 * next_contact_date, the prospects/ folder, archived, marketing_opt_out,
 * intake_finalised_at, per-flow state files) with four definitions of "ended"
 * and three of "prospect". Sixteen independent "due" clocks on the dashboard
 * each read two or three of them and none read the others, so a client who had
 * clearly left was still "recheck due", still pre-ticked for the poll, still
 * listed in nine panels at once. See docs/COACH_APP_RESTRUCTURE_REVIEW.md.
 *
 * This module is the single resolver. Every reader that needs "is this person
 * in care / a prospect / gone" goes through `resolveLifecycle`. The inputs
 * (engagement_status, plans, decisions …) stay as inputs; nothing reads them
 * directly for a who-is-in-care decision any more.
 *
 * Mirrored field-for-field by `fm-database/fmdb/plan/lifecycle.py` (the
 * nightly renewal sweep stamps `lifecycle` + `lifecycle_since` on client.yaml
 * with it, so chat and Python see the same word). `lifecycle.test.ts` runs the
 * same fixtures through both and fails on any divergence — keep them together.
 *
 * States, in order of precedence (first match wins):
 *
 *   archived     out of every list                     client.archived
 *   maintenance  hands-free paid tier                  maintenance_paid_through ≥ today,
 *                                                      or a live is_maintenance plan
 *   active       a programme plan in flight            newest non-maintenance published plan,
 *                                                      started, before end + grace
 *                                                      (also: ended but successor renewed /
 *                                                      in draft — "between phases")
 *   ending       active + inside the renewal window    end − 15d .. end + 14d, no decision
 *   onboarding   paid, no plan started yet             signed_up, no started plan
 *   lapsed       programme ended, nothing followed     engagement lapsed, or ended + grace
 *   prospect     never paid for a programme            everything else; `declined` sub-flag
 *
 * Plan evidence beats engagement_status for ACTIVE: a non-maintenance published
 * plan in flight makes someone active even if engagement_status is blank or
 * "pending" — losing a paying client over a data gap is worse than the roster
 * being one too high. The reason line says so, and the roster-review chip
 * still flags the mismatch.
 */

import {
  effectiveMealPlanStart,
  effectiveRecheckDate,
  hasPlanStarted,
  type PlanLike,
  type TravelOverrideLike,
} from "./plan-timing";

export type LifecycleState =
  | "archived"
  | "maintenance"
  | "active"
  | "ending"
  | "onboarding"
  | "lapsed"
  | "prospect";

/** Days after a plan's effective end before "ended" becomes "lapsed".
 *  Mirrors RENEWAL_GRACE_DAYS in fmdb/plan/renewals.py and
 *  OVERDUE_TAIL_DAYS in renewal-queue.ts. */
export const ENDED_GRACE_DAYS = 14;
/** Days before a plan's end at which the renewal decision becomes due.
 *  Mirrors LOOKAHEAD_DAYS in renewal-queue.ts. */
export const ENDING_LOOKAHEAD_DAYS = 15;
/** How long a prospect's call follow-up drip runs (free track: touches on
 *  days 1/5/12/25, each draftable up to 5 days late). */
export const PROSPECT_FOLLOWUP_DAYS = 30;
/** How long the win-back drip runs after a plan ends (touches on days
 *  22/32/42, each draftable up to 14 days late). */
export const LAPSED_WINBACK_DAYS = 56;

export interface LifecycleClientLike {
  client_id: string;
  display_name?: string;
  engagement_status?: unknown;
  archived?: unknown;
  archived_at?: unknown;
  lapsed_on?: unknown;
  maintenance_status?: unknown;
  maintenance_paid_through?: unknown;
  intake_date?: unknown;
  created_at?: unknown;
  marketing_opt_out?: unknown;
  next_contact_date?: unknown;
  weight_loss?: {
    enabled?: boolean;
    week_overrides?: TravelOverrideLike[] | null;
  } | null;
}

export interface LifecyclePlanLike extends PlanLike {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  is_maintenance?: boolean;
}

export type RenewalDecisionLike = { decision: string } | string | null | undefined;

export interface Lifecycle {
  state: LifecycleState;
  /** YYYY-MM-DD when this state began, best effort; null when undatable. */
  since: string | null;
  /** One line for the coach — why this state. */
  reason: string;
  /** The plan the state is about (the live one, or the one that ended). */
  planSlug: string | null;
  /** Effective end of that plan, YYYY-MM-DD. */
  planEndsOn: string | null;
  /** Whole days since the plan ended (negative = still running). */
  daysSinceEnd: number | null;
  /** Prospect who said no. */
  declined: boolean;
  /** marketing_opt_out — blocks every marketing purpose everywhere. */
  optedOut: boolean;
  /** engagement_status as written, lower-cased ("" when absent). */
  engagement: string;
}

const PUBLISHED = new Set(["published"]);
const PIPELINE = new Set(["draft", "drafts", "ready", "ready_to_publish"]);

function ymdOf(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const s = v.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return null;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000,
  );
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bucketOf(p: LifecyclePlanLike): string {
  return String(p._bucket ?? p.status ?? "").toLowerCase();
}

function decisionOf(d: RenewalDecisionLike): string | null {
  if (!d) return null;
  if (typeof d === "string") return d;
  return typeof d.decision === "string" ? d.decision : null;
}

export interface ResolveOpts {
  /** planSlug → renewal decision (from _renewal_decisions.yaml). */
  decisions?: Record<string, RenewalDecisionLike>;
  /** Draft / ready plans too — only needed to recognise "between phases". */
}

/**
 * Resolve one person's lifecycle state.
 *
 * @param client   the client.yaml record (any superset shape)
 * @param plans    EVERY plan for this client, across buckets (published,
 *                 draft, ready, superseded, revoked) — pass what
 *                 loadAllPlans() gives for this client_id
 * @param todayYmd today as YYYY-MM-DD (IST date, the caller decides)
 * @param opts     renewal decisions keyed by plan slug
 */
export function resolveLifecycle(
  client: LifecycleClientLike,
  plans: readonly LifecyclePlanLike[],
  todayYmd: string,
  opts: ResolveOpts = {},
): Lifecycle {
  const engagement =
    typeof client.engagement_status === "string"
      ? client.engagement_status.trim().toLowerCase()
      : "";
  const declined = engagement === "declined";
  const optedOut = client.marketing_opt_out === true;
  const decisions = opts.decisions ?? {};
  const base = {
    planSlug: null as string | null,
    planEndsOn: null as string | null,
    daysSinceEnd: null as number | null,
    declined,
    optedOut,
    engagement,
  };
  const firstTouch = ymdOf(client.intake_date) ?? ymdOf(client.created_at);

  // 1. archived — out of every list.
  if (client.archived === true) {
    return {
      ...base,
      state: "archived",
      since: ymdOf(client.archived_at),
      reason: "archived",
    };
  }

  const rOpts = {
    overrides: client.weight_loss?.week_overrides ?? undefined,
    weightLossEnabled: client.weight_loss?.enabled === true,
  };

  // Plans this person owns, split the way the states need them.
  const mine = plans.filter((p) => !p.client_id || p.client_id === client.client_id);
  const published = mine.filter((p) => PUBLISHED.has(bucketOf(p)));
  const pipeline = mine.filter((p) => PIPELINE.has(bucketOf(p)));

  type Dated = { plan: LifecyclePlanLike; start: string; end: string | null };
  const dated: Dated[] = [];
  for (const p of published) {
    const start = effectiveMealPlanStart(p);
    if (!start) continue;
    dated.push({ plan: p, start, end: effectiveRecheckDate(p, rOpts) });
  }
  // Newest first by effective start.
  dated.sort((a, b) => b.start.localeCompare(a.start));

  const maintenancePlans = dated.filter((d) => d.plan.is_maintenance === true);
  const programmePlans = dated.filter((d) => d.plan.is_maintenance !== true);

  // 2. maintenance — paid through a future date, or a maintenance plan live.
  const paidThrough = ymdOf(client.maintenance_paid_through);
  const liveMaintenance = maintenancePlans.find(
    (d) => hasPlanStarted(d.plan, todayYmd) && (!d.end || d.end >= todayYmd),
  );
  if ((paidThrough && paidThrough >= todayYmd) || liveMaintenance) {
    const m = liveMaintenance ?? maintenancePlans[0];
    return {
      ...base,
      state: "maintenance",
      since: m?.start ?? null,
      planSlug: m?.plan.slug ?? null,
      planEndsOn: paidThrough ?? m?.end ?? null,
      daysSinceEnd: null,
      reason: paidThrough
        ? `maintenance, paid through ${paidThrough}`
        : `maintenance plan ${m?.plan.slug ?? ""} live`,
    };
  }

  // 3/4. active / ending — the newest programme plan decides.
  const newest = programmePlans[0];
  if (newest) {
    const started = hasPlanStarted(newest.plan, todayYmd);
    const end = newest.end;
    const daysSinceEnd = end ? daysBetween(end, todayYmd) : null;
    const decision = decisionOf(decisions[newest.plan.slug]);
    const successor = pipeline[0] ?? null;
    const planBase = {
      ...base,
      planSlug: newest.plan.slug,
      planEndsOn: end,
      daysSinceEnd,
    };

    if (!started) {
      // Published, starts in the future. A paid client between phases, or a
      // new one whose Day 1 is ahead.
      return {
        ...planBase,
        state: "onboarding",
        since: firstTouch,
        reason: `plan ${newest.plan.slug} starts ${newest.start}`,
      };
    }

    if (end === null || daysSinceEnd === null) {
      // Started but undatable end — treat as running; never hide a plan we
      // cannot date.
      return {
        ...planBase,
        state: "active",
        since: newest.start,
        reason: `plan ${newest.plan.slug} running (end not datable)`,
      };
    }

    // Inside the window, or ended within the grace tail.
    if (daysSinceEnd <= ENDED_GRACE_DAYS) {
      const inRenewalWindow = daysSinceEnd >= -ENDING_LOOKAHEAD_DAYS;
      if (inRenewalWindow && !decision && !successor) {
        return {
          ...planBase,
          state: "ending",
          since: addDays(end, -ENDING_LOOKAHEAD_DAYS),
          reason:
            daysSinceEnd < 0
              ? `plan ends in ${-daysSinceEnd} day${daysSinceEnd === -1 ? "" : "s"} — renewal decision due`
              : `plan ended ${daysSinceEnd} day${daysSinceEnd === 1 ? "" : "s"} ago — renewal decision due`,
        };
      }
      return {
        ...planBase,
        state: "active",
        since: newest.start,
        reason:
          daysSinceEnd < 0
            ? `plan ${newest.plan.slug} running, ends ${end}`
            : successor
              ? `between phases — successor ${successor.slug} in ${bucketOf(successor)}`
              : `plan ended ${end}, decision: ${decision}`,
      };
    }

    // Ended more than the grace tail ago.
    if (successor || decision === "renewed") {
      return {
        ...planBase,
        state: "active",
        since: newest.start,
        reason: successor
          ? `between phases — successor ${successor.slug} in ${bucketOf(successor)}`
          : "renewed — successor plan not yet drafted",
      };
    }
    if (engagement === "signed_up" && decision === "deferred") {
      return {
        ...planBase,
        state: "active",
        since: newest.start,
        reason: `plan ended ${end}, renewal deferred`,
      };
    }
    return {
      ...planBase,
      state: "lapsed",
      since: ymdOf(client.lapsed_on) ?? addDays(end, ENDED_GRACE_DAYS),
      reason: decision
        ? `plan ended ${end}, decision: ${decision}`
        : `plan ended ${end}, nothing followed`,
    };
  }

  // No programme plan ever datable. A maintenance plan that has ended is a
  // lapsed maintenance client.
  const endedMaintenance = maintenancePlans[0];
  if (endedMaintenance) {
    return {
      ...base,
      state: "lapsed",
      since: ymdOf(client.lapsed_on) ?? endedMaintenance.end ?? null,
      planSlug: endedMaintenance.plan.slug,
      planEndsOn: endedMaintenance.end,
      daysSinceEnd: endedMaintenance.end ? daysBetween(endedMaintenance.end, todayYmd) : null,
      reason: paidThrough
        ? `maintenance lapsed — paid through ${paidThrough}`
        : "maintenance plan ended",
    };
  }

  // 5. onboarding — paid, nothing started.
  if (engagement === "signed_up") {
    const draft = pipeline[0];
    return {
      ...base,
      state: "onboarding",
      since: firstTouch,
      planSlug: draft?.slug ?? null,
      reason: draft ? `signed up — plan ${draft.slug} in ${bucketOf(draft)}` : "signed up — no plan yet",
    };
  }

  // 6. lapsed — the sweep said so and no plan evidence contradicts it.
  if (engagement === "lapsed") {
    return {
      ...base,
      state: "lapsed",
      since: ymdOf(client.lapsed_on),
      reason: "marked lapsed",
    };
  }

  // 7. prospect — everyone else.
  return {
    ...base,
    state: "prospect",
    since: firstTouch,
    reason: declined ? "declined the programme" : engagement ? `engagement_status ${engagement}` : "no sign-up on record",
  };
}

/** Index every client's lifecycle in one pass. */
export function resolveLifecycles<C extends LifecycleClientLike>(
  clients: readonly C[],
  plans: readonly LifecyclePlanLike[],
  todayYmd: string,
  opts: ResolveOpts = {},
): Map<string, Lifecycle> {
  const byClient = new Map<string, LifecyclePlanLike[]>();
  for (const p of plans) {
    const cid = p.client_id;
    if (!cid) continue;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid)!.push(p);
  }
  const out = new Map<string, Lifecycle>();
  for (const c of clients) {
    out.set(c.client_id, resolveLifecycle(c, byClient.get(c.client_id) ?? [], todayYmd, opts));
  }
  return out;
}

/** States that mean "in care" — automation may draft/generate/push for them. */
export const IN_CARE: ReadonlySet<LifecycleState> = new Set(["active", "ending", "maintenance", "onboarding"]);

export function isInCare(l: Lifecycle | LifecycleState): boolean {
  return IN_CARE.has(typeof l === "string" ? l : l.state);
}

/** Coach-facing label + tone for a state chip. */
export const LIFECYCLE_META: Record<LifecycleState, { label: string; icon: string; tone: "ok" | "warn" | "muted" | "primary" }> = {
  active: { label: "Active", icon: "🟢", tone: "ok" },
  ending: { label: "Plan ending", icon: "🟠", tone: "warn" },
  maintenance: { label: "Maintenance", icon: "🌿", tone: "ok" },
  onboarding: { label: "Onboarding", icon: "🌱", tone: "primary" },
  prospect: { label: "Prospect", icon: "💬", tone: "muted" },
  lapsed: { label: "Lapsed", icon: "⏸", tone: "muted" },
  archived: { label: "Archived", icon: "🗄", tone: "muted" },
};

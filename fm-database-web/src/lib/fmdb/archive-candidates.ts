import "server-only";
import { loadClientSessions } from "./loader-extras";
import { effectiveRecheckDate } from "./plan-timing";
import { loadDecisions } from "./renewal-queue";

/**
 * Archive candidates — the "declutter" suggestion layer.
 *
 * The dashboard NEVER auto-archives. It surfaces a nudge listing inactive
 * clients the coach can one-click archive. A candidate is one of:
 *
 *   1. A prospect who never converted — no active plan, engagement pending /
 *      unset, quiet >= `windowDays` (category "no_signup").
 *   2. A declined discovery — same, with engagement declined ("declined").
 *   3. A programme that ENDED and is going nowhere (category
 *      "programme_ended", added 2026-08-21): every published plan is past its
 *      effective recheck, no draft/ready successor is in build, and either
 *      the renewal decision on the ended plan is `not_renewing` or the
 *      client's engagement_status is `lapsed`. Before this, a published-
 *      but-finished plan counted as "active" forever, so ex-clients could
 *      never be suggested for archive and lingered on every roster surface.
 *
 * Signed-up clients WITHOUT an ended programme are always excluded — a
 * signed-up client with no plan yet is mid-onboarding, not clutter. "Cold
 * returning" ex-clients who might still renew are also not candidates: an
 * ended plan with no decision recorded stays out of this list (it lives in
 * the renewal queue until the coach decides).
 *
 * Staleness anchor = most recent of { latest session date, intake_date,
 * programme end date } — so a plan that ended yesterday is never "21 days
 * quiet" no matter how long ago the last session was.
 */

const BUILDING_PLAN_BUCKETS = new Set(["draft", "ready_to_publish"]);

export interface ArchiveCandidate {
  client_id: string;
  display_name: string;
  /** Coarse category — drives the archived_reason written on confirm. */
  category: "declined" | "no_signup" | "programme_ended";
  /** Human one-liner for the nudge row. */
  reason: string;
  /** Whole days since the staleness anchor. */
  daysInactive: number;
  /** YYYY-MM-DD of the anchor (last activity), or undefined if none on file. */
  lastActivity?: string;
}

interface PlanLike {
  status?: string;
  _bucket?: string;
  slug?: string;
  plan_period_start?: string | Date;
  plan_period_weeks?: number;
  plan_period_recheck_date?: string | Date;
  meal_plan_started_on?: string | Date | null;
  supplements_started_on?: string | Date | null;
}

interface ClientLike {
  client_id: string;
  display_name?: string;
  engagement_status?: string;
  intake_date?: string;
  archived?: boolean;
}

function pick(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" && v ? v : undefined;
}

/** Effective end date of a published plan, YYYY-MM-DD, or undefined when the
 *  plan can't be dated (conservative: an undatable plan counts as in-flight). */
function planEndYmd(p: PlanLike): string | undefined {
  const eff = effectiveRecheckDate(p);
  if (eff) return eff;
  const stored = p.plan_period_recheck_date;
  if (typeof stored === "string" && stored) return stored.slice(0, 10);
  if (stored instanceof Date && !Number.isNaN(stored.getTime())) {
    return stored.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * Compute the archive-candidate list. Only reads sessions for clients that
 * pass the cheap filters, so the extra fs work is bounded to the prospect /
 * declined / ended tail — never the whole roster.
 */
export async function getArchiveCandidates(
  clients: ClientLike[],
  plansByClient: Map<string, PlanLike[]>,
  todayStr: string,
  windowDays = 21,
): Promise<ArchiveCandidate[]> {
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const renewalDecisions = loadDecisions();
  const out: ArchiveCandidate[] = [];

  await Promise.all(
    clients.map(async (client) => {
      if (client.archived === true) return;

      const engagement = client.engagement_status;
      const plans = plansByClient.get(client.client_id) ?? [];

      // A draft / ready successor in build means active work — never a candidate.
      if (plans.some((p) => BUILDING_PLAN_BUCKETS.has((p._bucket ?? p.status ?? "") as string))) {
        return;
      }

      // Published plans: in-flight (effective recheck today or later, or
      // undatable) means active care. Past-recheck plans are ENDED.
      const published = plans.filter(
        (p) => ((p._bucket ?? p.status ?? "") as string) === "published",
      );
      let latestEnd: string | undefined;
      let latestEndedSlug: string | undefined;
      for (const p of published) {
        const end = planEndYmd(p);
        if (!end || end >= todayStr) return; // in-flight → active care
        if (!latestEnd || end > latestEnd) {
          latestEnd = end;
          latestEndedSlug = typeof p.slug === "string" ? p.slug : undefined;
        }
      }

      let category: ArchiveCandidate["category"];
      let label: string;
      if (latestEnd) {
        // Programme over. Candidate only when the ending is DECIDED dead:
        // not_renewing recorded, or the client marked lapsed. Undecided
        // endings belong to the renewal queue, not the archive nudge.
        const decision = latestEndedSlug
          ? renewalDecisions[latestEndedSlug]?.decision
          : undefined;
        const dead = decision === "not_renewing" || engagement === "lapsed";
        if (!dead) return;
        category = "programme_ended";
        label =
          decision === "not_renewing"
            ? `Programme ended ${latestEnd} · not renewing`
            : `Programme ended ${latestEnd} · lapsed`;
      } else if (engagement === "signed_up") {
        return; // mid-onboarding — never a candidate
      } else if (engagement === "declined") {
        category = "declined";
        label = "Declined";
      } else if (engagement === "lapsed") {
        // Lapsed with no plan history on file — treat as an ended
        // relationship rather than a never-signed-up prospect.
        category = "programme_ended";
        label = "Lapsed";
      } else {
        category = "no_signup";
        label = "Never signed up";
      }

      // Staleness anchor — newest of latest session date, intake_date and
      // (for ended programmes) the programme end date.
      let anchor = client.intake_date ?? "";
      if (latestEnd && latestEnd > anchor) anchor = latestEnd;
      try {
        const sessions = await loadClientSessions(client.client_id);
        for (const s of sessions) {
          const d = pick(s as Record<string, unknown>, "date");
          if (d && d > anchor) anchor = d;
        }
      } catch {
        /* no sessions dir — keep the anchor we have */
      }
      if (!anchor) return; // nothing to date staleness against; leave alone

      const daysInactive = Math.round(
        (todayMs - new Date(`${anchor.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000,
      );
      if (daysInactive < windowDays) return;

      out.push({
        client_id: client.client_id,
        display_name: client.display_name ?? client.client_id,
        category,
        reason: `${label} · quiet ${daysInactive}d`,
        daysInactive,
        lastActivity: anchor || undefined,
      });
    }),
  );

  // Most-stale first.
  out.sort((a, b) => b.daysInactive - a.daysInactive);
  return out;
}

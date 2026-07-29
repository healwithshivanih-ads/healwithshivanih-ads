import "server-only";
import { loadClientSessions } from "./loader-extras";

/**
 * Archive candidates — the "declutter" suggestion layer.
 *
 * The dashboard NEVER auto-archives. It surfaces a nudge listing inactive
 * clients the coach can one-click archive. A candidate is a client who:
 *   - is NOT already archived,
 *   - has NO active plan (published / draft / ready_to_publish), and
 *   - either declined after discovery, or never signed up (engagement
 *     pending / unset), and
 *   - has had no activity for >= `windowDays` (default 21).
 *
 * Signed-up clients are always excluded — a signed-up client without a plan
 * yet is mid-onboarding, not clutter. "Cold returning" ex-clients are
 * deliberately NOT candidates (coach decision 2026-07-13) — only never-
 * converted prospects and declined discoveries.
 *
 * Staleness anchor = most recent of { latest session date, intake_date }.
 */

const ACTIVE_PLAN_BUCKETS = new Set(["published", "draft", "ready_to_publish"]);

export interface ArchiveCandidate {
  client_id: string;
  display_name: string;
  /** Coarse category — drives the archived_reason written on confirm. */
  category: "declined" | "no_signup";
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

/**
 * Compute the archive-candidate list. Only reads sessions for clients that
 * pass the cheap filters (no active plan + not signed up), so the extra fs
 * work is bounded to the prospect / declined tail — never the whole roster.
 */
export async function getArchiveCandidates(
  clients: ClientLike[],
  plansByClient: Map<string, PlanLike[]>,
  todayStr: string,
  windowDays = 21,
): Promise<ArchiveCandidate[]> {
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const out: ArchiveCandidate[] = [];

  await Promise.all(
    clients.map(async (client) => {
      if (client.archived === true) return;

      const engagement = client.engagement_status;
      if (engagement === "signed_up") return; // mid-onboarding — never a candidate

      // Any live plan means active care — not a stale prospect.
      const plans = plansByClient.get(client.client_id) ?? [];
      const hasActivePlan = plans.some((p) =>
        ACTIVE_PLAN_BUCKETS.has((p._bucket ?? p.status ?? "") as string),
      );
      if (hasActivePlan) return;

      const category: ArchiveCandidate["category"] =
        engagement === "declined" ? "declined" : "no_signup";

      // Staleness anchor — newest of latest session date + intake_date.
      let anchor = client.intake_date ?? "";
      try {
        const sessions = await loadClientSessions(client.client_id);
        for (const s of sessions) {
          const d = pick(s as Record<string, unknown>, "date");
          if (d && d > anchor) anchor = d;
        }
      } catch {
        /* no sessions dir — keep intake_date anchor */
      }
      if (!anchor) return; // nothing to date staleness against; leave alone

      const daysInactive = Math.round(
        (todayMs - new Date(`${anchor}T00:00:00Z`).getTime()) / 86_400_000,
      );
      if (daysInactive < windowDays) return;

      out.push({
        client_id: client.client_id,
        display_name: client.display_name ?? client.client_id,
        category,
        reason:
          category === "declined"
            ? `Declined · quiet ${daysInactive}d`
            : `Never signed up · quiet ${daysInactive}d`,
        daysInactive,
        lastActivity: anchor || undefined,
      });
    }),
  );

  // Most-stale first.
  out.sort((a, b) => b.daysInactive - a.daysInactive);
  return out;
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "./paths";

/**
 * "Time to schedule next session" scanner.
 *
 * Combines two signals to decide who needs a booking link:
 *   1. `days_since_last_session` — date of most recent session file in
 *      clients/<id>/sessions/. If ≥ 12 days, flag.
 *   2. `plan_recheck_overdue` — for clients with a published plan,
 *      today > plan_period_recheck_date. Plan-end overrides the
 *      12-day rule (a recheck-overdue client is automatically due).
 *
 * For each flagged client, auto-picks the right booking type:
 *   - `discovery`        — no plan, no intake submitted → prospect
 *   - `programme-intake` — intake token issued but not yet submitted,
 *                          OR submitted but no plan published yet
 *   - `coaching`         — has a published plan (programme active /
 *                          plan recheck overdue / mid-plan)
 *
 * Coach can override per-row in the UI. Auto-picks are heuristics, not
 * rules — they exist to make the bulk-send path safe by default.
 */

export type BookingType = "discovery" | "programme-intake" | "coaching";

export interface SchedulingDueRow {
  client_id: string;
  display_name: string;
  mobile_number?: string;
  recommended_type: BookingType;
  /** Human reason — surfaced in the panel so coach sees WHY each row
   *  was flagged (and which type was picked). */
  reason: string;
  days_since_last_session?: number;
  last_session_date?: string;
  plan_recheck_overdue_days?: number;
  plan_period_recheck_date?: string;
}

interface ClientDictForScan {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  intake_token?: string | null;
  intake_submitted_at?: string | null;
  intake_finalised_at?: string | null;
  lifecycle_state?: string | null;
}

interface PlanLite {
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
}

const DAYS_SINCE_THRESHOLD = 12;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

async function lastSessionDate(clientId: string): Promise<string | undefined> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", clientId, "sessions");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  // Session filenames encode date: "<id>-YYYY-MM-DD-NNN.yaml"
  let max = "";
  for (const name of entries) {
    const m = name.match(/(\d{4}-\d{2}-\d{2})/);
    if (m && m[1] > max) max = m[1];
  }
  return max || undefined;
}

function pickRecommendedType(
  c: ClientDictForScan,
  hasPublishedPlan: boolean,
  planRecheckOverdueDays: number | undefined,
): { type: BookingType; reason: string } {
  // Programme active OR plan recheck overdue → coaching
  if (hasPublishedPlan) {
    if (planRecheckOverdueDays !== undefined && planRecheckOverdueDays > 0) {
      return {
        type: "coaching",
        reason: `Plan recheck ${planRecheckOverdueDays}d overdue`,
      };
    }
    return { type: "coaching", reason: "Active programme · 12d+ since last session" };
  }
  // Has intake token (issued or submitted) but no plan → programme intake
  if (c.intake_token || c.intake_submitted_at) {
    if (!c.intake_submitted_at) {
      return {
        type: "programme-intake",
        reason: "Intake not yet submitted — nudge for intake session",
      };
    }
    return {
      type: "programme-intake",
      reason: "Intake submitted, no plan yet — book intake session",
    };
  }
  // No intake activity → prospect
  return { type: "discovery", reason: "Prospect — no programme or intake yet" };
}

export async function getSchedulingDueRows(
  clients: ClientDictForScan[],
  plans: PlanLite[],
  todayStr: string,
): Promise<SchedulingDueRow[]> {
  const today = new Date(`${todayStr}T00:00:00`);
  const publishedByClient = new Map<string, PlanLite>();
  for (const p of plans) {
    if (!p.client_id) continue;
    const status = p.status ?? p._bucket;
    if (status === "published") publishedByClient.set(p.client_id, p);
  }

  const rows: SchedulingDueRow[] = [];
  for (const c of clients) {
    if (!c.client_id) continue;
    // Skip clients without a phone — can't send anyway.
    if (!(c.mobile_number || "").trim()) continue;
    // Don't nudge if intake_finalised_at is recent (within 7d) — they
    // were JUST onboarded; let the coach do the first session naturally.
    if (c.intake_finalised_at) {
      const fAt = new Date(c.intake_finalised_at);
      if (!Number.isNaN(fAt.getTime()) && daysBetween(today, fAt) < 7) {
        continue;
      }
    }

    const lastDateStr = await lastSessionDate(c.client_id);
    const daysSince = lastDateStr ? daysBetween(today, new Date(`${lastDateStr}T00:00:00`)) : undefined;

    const plan = publishedByClient.get(c.client_id);
    const hasPlan = !!plan;
    let recheckOverdue: number | undefined;
    if (plan?.plan_period_recheck_date) {
      const rd = new Date(`${plan.plan_period_recheck_date}T00:00:00`);
      const od = daysBetween(today, rd);
      if (od > 0) recheckOverdue = od;
    }

    // Flag if either (a) recheck overdue OR (b) 12+ days since last session.
    const dueByRecheck = recheckOverdue !== undefined;
    const dueByGap = daysSince !== undefined && daysSince >= DAYS_SINCE_THRESHOLD;
    // Special case: prospect / not-yet-intake client gets flagged if
    // they've been on file for 12+ days without an intake submission.
    // Use intake_token issue date proxy via the client's existence /
    // lack of last session — handled by the daysSince path below.
    if (!dueByRecheck && !dueByGap) continue;

    const { type, reason } = pickRecommendedType(c, hasPlan, recheckOverdue);

    rows.push({
      client_id: c.client_id,
      display_name: c.display_name || c.client_id,
      mobile_number: c.mobile_number,
      recommended_type: type,
      reason: dueByRecheck && !dueByGap
        ? reason
        : `${reason} · ${daysSince ?? "?"}d since last session`,
      days_since_last_session: daysSince,
      last_session_date: lastDateStr,
      plan_recheck_overdue_days: recheckOverdue,
      plan_period_recheck_date: plan?.plan_period_recheck_date,
    });
  }

  // Most urgent first: recheck overdue, then biggest gap
  rows.sort((a, b) => {
    const aRO = a.plan_recheck_overdue_days ?? -1;
    const bRO = b.plan_recheck_overdue_days ?? -1;
    if (aRO !== bRO) return bRO - aRO;
    return (b.days_since_last_session ?? 0) - (a.days_since_last_session ?? 0);
  });

  return rows;
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "./paths";
import { hasPlanStarted } from "./plan-timing";
import yaml from "js-yaml";

/**
 * "Time to schedule next session" scanner.
 *
 * Three signals determine who needs a booking link sent:
 *   1. `days_since_last_session` — date of most recent session file in
 *      clients/<id>/sessions/.
 *      ≥ 12 days  → flagged overdue (dueByGap).
 *      9–11 days  → flagged upcoming (1–3 days before the threshold).
 *   2. `plan_recheck_overdue` — for clients with a published plan,
 *      today > plan_period_recheck_date → overdue.
 *      Within 3 days → flagged upcoming.
 *   3. `next_contact_date` — coach-set follow-up date within 3 days.
 *
 * Cal.com cross-reference: clients who already have a future cal.com
 * booking are skipped — they don't need a booking link.
 *
 * For each flagged client, auto-picks the right booking type:
 *   - `discovery`        — no plan, no intake submitted → prospect
 *   - `programme-intake` — intake token issued/submitted, no plan yet
 *   - `coaching`         — has a published plan
 *
 * Coach can override per-row in the UI. Auto-picks are heuristics.
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
  /** Set when the row is flagged for an UPCOMING due date (next 1–3 days)
   *  rather than already overdue. Used by the panel to render the amber
   *  "due soon" section vs the red overdue section.
   *
   *  Sources (whichever is soonest):
   *    - plan_period_recheck_date within 3 days
   *    - next_contact_date within 3 days
   *    - days_since_last_session in [9,11] → 1–3 days before 12d threshold
   */
  upcoming_in_days?: number;
  /** ISO date the upcoming-due was anchored on (plan_period_recheck_date
   *  or client.next_contact_date). undefined when derived from session gap. */
  upcoming_due_date?: string;
}

interface ClientDictForScan {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  intake_token?: string | null;
  intake_submitted_at?: string | null;
  intake_finalised_at?: string | null;
  lifecycle_state?: string | null;
  /** Coach-set next contact date — used to flag UPCOMING-due rows. */
  next_contact_date?: string | null;
}

interface PlanLite {
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
  meal_plan_started_on?: string;
  plan_period_start?: string;
}

/** Days since last session before we consider a client overdue. */
const DAYS_SINCE_THRESHOLD = 12;
/** How many days ahead of the threshold (or a specific due date) we
 *  show the "due soon" proactive signal. */
const ADVANCE_WARNING_DAYS = 3;

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

/**
 * Build a Set of client IDs that already have a future cal.com booking.
 * These clients don't need a booking link — they've already scheduled.
 *
 * Reads _calcom_bookings.yaml. A booking counts as "future" when its
 * start_time is > nowMs (not cancelled, not in the past).
 */
async function clientsWithFutureBooking(nowMs: number): Promise<Set<string>> {
  const root = getPlansRoot();
  const result = new Set<string>();
  try {
    const text = await fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8");
    const raw = yaml.load(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [clientId, events] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(events)) continue;
      // Group by uid, latest event per uid wins (rescheduled replaces created)
      const byUid = new Map<string, { start_time?: string; type?: string; received_at?: string }>();
      for (const e of events as Array<Record<string, unknown>>) {
        const uid = e.uid as string | undefined;
        if (!uid) continue;
        const prev = byUid.get(uid);
        if (!prev || String(e.received_at ?? "") > String(prev.received_at ?? "")) {
          byUid.set(uid, e as { start_time?: string; type?: string; received_at?: string });
        }
      }
      for (const e of byUid.values()) {
        // Skip cancellations
        const t = String(e.type ?? "").toLowerCase();
        if (t.includes("cancel")) continue;
        if (!e.start_time) continue;
        const startMs = Date.parse(e.start_time);
        if (!Number.isNaN(startMs) && startMs > nowMs) {
          result.add(clientId);
          break; // one future booking is enough
        }
      }
    }
  } catch {
    // Missing or unparseable file → act as if no future bookings
  }
  return result;
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
    return { type: "coaching", reason: "Active programme" };
  }
  // Has intake token (issued or submitted) but no plan → programme intake
  if (c.intake_token || c.intake_submitted_at) {
    if (!c.intake_submitted_at) {
      return {
        type: "programme-intake",
        reason: "Intake not yet submitted",
      };
    }
    return {
      type: "programme-intake",
      reason: "Intake submitted, no plan yet",
    };
  }
  // No intake activity → prospect
  return { type: "discovery", reason: "Prospect — no programme yet" };
}

export async function getSchedulingDueRows(
  clients: ClientDictForScan[],
  plans: PlanLite[],
  todayStr: string,
): Promise<SchedulingDueRow[]> {
  const today = new Date(`${todayStr}T00:00:00`);
  const nowMs = today.getTime();

  const publishedByClient = new Map<string, PlanLite>();
  for (const p of plans) {
    if (!p.client_id) continue;
    const status = p.status ?? p._bucket;
    if (status === "published") publishedByClient.set(p.client_id, p);
  }

  // Cal.com cross-reference — skip clients who already have a future booking.
  const alreadyBooked = await clientsWithFutureBooking(nowMs);

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
    // Skip if they already have a future cal.com booking.
    if (alreadyBooked.has(c.client_id)) continue;

    const lastDateStr = await lastSessionDate(c.client_id);
    const daysSince = lastDateStr ? daysBetween(today, new Date(`${lastDateStr}T00:00:00`)) : undefined;

    const plan = publishedByClient.get(c.client_id);
    // Plan published but not begun yet → nothing to book until it starts.
    if (plan && !hasPlanStarted(plan, todayStr)) continue;
    const hasPlan = !!plan;
    let recheckOverdue: number | undefined;
    if (plan?.plan_period_recheck_date) {
      const rd = new Date(`${plan.plan_period_recheck_date}T00:00:00`);
      const od = daysBetween(today, rd);
      if (od > 0) recheckOverdue = od;
    }

    // ── Upcoming-due signals (1–3 days ahead). Each sets `upcomingInDays`
    //    to the days remaining. Whichever source is soonest wins.
    let upcomingInDays: number | undefined;
    let upcomingDueDate: string | undefined;
    let upcomingReason: string | undefined;

    // 1. plan_period_recheck_date within ADVANCE_WARNING_DAYS
    if (plan?.plan_period_recheck_date && recheckOverdue === undefined) {
      const rd = new Date(`${plan.plan_period_recheck_date}T00:00:00`);
      const daysAhead = daysBetween(rd, today);
      if (daysAhead >= 0 && daysAhead <= ADVANCE_WARNING_DAYS) {
        upcomingInDays = daysAhead;
        upcomingDueDate = plan.plan_period_recheck_date;
        upcomingReason =
          daysAhead === 0
            ? "Plan recheck is today — send booking link now"
            : `Plan recheck in ${daysAhead} day${daysAhead === 1 ? "" : "s"}`;
      }
    }

    // 2. next_contact_date within ADVANCE_WARNING_DAYS
    if (c.next_contact_date) {
      const ncd = new Date(`${c.next_contact_date}T00:00:00`);
      const daysAhead = daysBetween(ncd, today);
      if (daysAhead >= 0 && daysAhead <= ADVANCE_WARNING_DAYS) {
        if (upcomingInDays === undefined || daysAhead < upcomingInDays) {
          upcomingInDays = daysAhead;
          upcomingDueDate = c.next_contact_date;
          upcomingReason =
            daysAhead === 0
              ? "Next contact date is today"
              : `Follow-up due in ${daysAhead} day${daysAhead === 1 ? "" : "s"}`;
        }
      }
    }

    // 3. Session gap approaching threshold (9–11 days since last session)
    //    = 1–3 days before the 12-day mark. Don't double-count with dueByGap.
    if (
      daysSince !== undefined &&
      daysSince >= DAYS_SINCE_THRESHOLD - ADVANCE_WARNING_DAYS &&
      daysSince < DAYS_SINCE_THRESHOLD
    ) {
      const daysToThreshold = DAYS_SINCE_THRESHOLD - daysSince; // 1, 2, or 3
      if (upcomingInDays === undefined || daysToThreshold < upcomingInDays) {
        upcomingInDays = daysToThreshold;
        upcomingDueDate = undefined; // derived from gap, no specific date
        upcomingReason =
          daysToThreshold === 1
            ? `${daysSince}d since last session — send link today`
            : `${daysSince}d since last session — due in ${daysToThreshold} days`;
      }
    }

    // ── Flag decision ────────────────────────────────────────────────
    const dueByRecheck = recheckOverdue !== undefined;
    const dueByGap = daysSince !== undefined && daysSince >= DAYS_SINCE_THRESHOLD;
    const dueByUpcoming = upcomingInDays !== undefined;
    if (!dueByRecheck && !dueByGap && !dueByUpcoming) continue;

    const { type, reason } = pickRecommendedType(c, hasPlan, recheckOverdue);

    let finalReason: string;
    if (dueByUpcoming && !dueByRecheck && !dueByGap) {
      // Upcoming only — lead with the time-sensitivity
      finalReason = `${upcomingReason!} · ${reason}`;
    } else if (dueByRecheck && !dueByGap) {
      finalReason = reason;
    } else {
      finalReason = `${reason} · ${daysSince ?? "?"}d since last session`;
    }

    rows.push({
      client_id: c.client_id,
      display_name: c.display_name || c.client_id,
      mobile_number: c.mobile_number,
      recommended_type: type,
      reason: finalReason,
      days_since_last_session: daysSince,
      last_session_date: lastDateStr,
      plan_recheck_overdue_days: recheckOverdue,
      plan_period_recheck_date: plan?.plan_period_recheck_date,
      upcoming_in_days: upcomingInDays,
      upcoming_due_date: upcomingDueDate,
    });
  }

  // Sort: upcoming-only rows first (they're the new proactive signal),
  // then overdue — most overdue (by recheck days, then gap) at top.
  rows.sort((a, b) => {
    const aUpcomingOnly = a.upcoming_in_days !== undefined && !a.plan_recheck_overdue_days && (a.days_since_last_session ?? 0) < DAYS_SINCE_THRESHOLD;
    const bUpcomingOnly = b.upcoming_in_days !== undefined && !b.plan_recheck_overdue_days && (b.days_since_last_session ?? 0) < DAYS_SINCE_THRESHOLD;
    if (aUpcomingOnly !== bUpcomingOnly) return aUpcomingOnly ? -1 : 1;
    if (aUpcomingOnly && bUpcomingOnly) {
      // Among upcoming-only: soonest first
      return (a.upcoming_in_days ?? 99) - (b.upcoming_in_days ?? 99);
    }
    // Among overdue: most overdue first
    const aRO = a.plan_recheck_overdue_days ?? -1;
    const bRO = b.plan_recheck_overdue_days ?? -1;
    if (aRO !== bRO) return bRO - aRO;
    return (b.days_since_last_session ?? 0) - (a.days_since_last_session ?? 0);
  });

  return rows;
}

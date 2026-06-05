"use server";

/**
 * Meal-plan fortnight drip reminders.
 *
 * Coach rule (2026-06-04): a client's protocol is exactly 12 weeks, sent
 * 2 weeks at a time, anchored to the day the FIRST meal plan was sent
 * (plan.meal_plan_started_on). Each fortnight letter should go out 3 days
 * BEFORE the currently-active fortnight expires, so the client never runs
 * out of plan.
 *
 * This module does NOT auto-send (coach decision: remind + approve). It
 * surfaces, per active client, the next un-sent fortnight that is due now
 * or coming up, with the date it should be sent. The coach generates +
 * sends the `meal_plan_phase` letter from the client's Communicate page.
 *
 * Schedule math (Day1 = first meal-plan send date, day 1 inclusive):
 *   Fortnight n covers days [(n-1)*14 + 1 .. n*14].
 *   Fortnight n expires at end of day (n*14).
 *   F1 send date = Day1.
 *   Fn send date (n>=2) = Fn-1 expiry - 3 = Day1 + (n-1)*14 - 4 days.
 *   For 12 weeks -> 6 fortnights.
 *
 * "Sent so far" is inferred by counting meal-plan-bearing sends in
 * _send_log.yaml (consolidated counts as F1; each meal_plan/meal_plan_phase
 * counts as the next fortnight). The next un-sent fortnight is nSent + 1.
 */

import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const PLANS_ROOT =
  process.env.FMDB_PLANS_DIR ?? path.join(process.env.HOME ?? "", "fm-plans");

const MEAL_BEARING = new Set(["consolidated", "meal_plan", "meal_plan_phase"]);
const MEAL_PLAN_DEFAULT_DELAY_DAYS = 3;
const FORTNIGHT_DAYS = 14;
const SEND_LEAD_DAYS = 3; // send next fortnight 3 days before current expires

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(fromYmd + "T00:00:00Z");
  const b = Date.parse(toYmd + "T00:00:00Z");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/** Count meal-plan-bearing sends recorded in the client's _send_log.yaml. */
async function countMealSends(clientId: string): Promise<number> {
  const p = path.join(
    PLANS_ROOT,
    "clients",
    clientId,
    "meal-plans",
    "_send_log.yaml",
  );
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = yaml.load(raw);
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (e) =>
        e &&
        typeof e === "object" &&
        Array.isArray((e as { letter_types?: unknown }).letter_types) &&
        ((e as { letter_types: string[] }).letter_types).some((t) =>
          MEAL_BEARING.has(t),
        ),
    ).length;
  } catch {
    return 0;
  }
}

export interface FortnightDue {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  plan_slug: string;
  day1: string; // YYYY-MM-DD — Day 1 the schedule is anchored to
  fortnight_number: number; // 1..total
  total_fortnights: number;
  weeks_label: string; // e.g. "Weeks 5–6"
  covers_start: string;
  covers_end: string;
  send_on: string; // YYYY-MM-DD the coach should send it
  days_until_send: number; // negative = overdue
  status: "due" | "upcoming";
}

/**
 * Return the next un-sent fortnight for each active published plan, when it
 * is due now (send_on <= today) or coming up within `lookaheadDays`.
 */
export async function listMealPlanFortnightsDueAction(
  lookaheadDays: number = 7,
): Promise<
  { ok: true; rows: FortnightDue[] } | { ok: false; error: string }
> {
  try {
    const [clients, plans] = await Promise.all([
      loadAllClients(),
      loadAllPlans(),
    ]);
    const clientMap = new Map(
      (clients as Array<Record<string, unknown>>).map((c) => [
        c.client_id as string,
        c,
      ]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const rows: FortnightDue[] = [];

    for (const p of plans as Array<Record<string, unknown>>) {
      const status = (p.status as string) ?? (p._bucket as string);
      if (status !== "published") continue;

      const clientId = p.client_id as string | undefined;
      const planSlug = p.slug as string | undefined;
      if (!clientId || !planSlug) continue;

      // Day 1 = confirmed meal-plan start, else plan_period_start + 3d.
      const mealStart = (p.meal_plan_started_on as string | undefined) ?? null;
      const periodStart = (p.plan_period_start as string | undefined) ?? null;
      const day1 = mealStart
        ? mealStart
        : periodStart
          ? addDays(periodStart, MEAL_PLAN_DEFAULT_DELAY_DAYS)
          : null;
      if (!day1) continue;

      const weeks = Number(p.plan_period_weeks) || 12;
      const totalFortnights = Math.ceil(weeks / 2);

      const nSent = await countMealSends(clientId);
      const nextFortnight = nSent + 1;
      if (nextFortnight > totalFortnights) continue; // protocol complete

      // Send date for fortnight n.
      const sendOn =
        nextFortnight === 1
          ? day1
          : addDays(day1, (nextFortnight - 1) * FORTNIGHT_DAYS - SEND_LEAD_DAYS);

      const daysUntil = daysBetween(today, sendOn);
      if (daysUntil > lookaheadDays) continue; // not yet on the radar

      const coversStart = addDays(day1, (nextFortnight - 1) * FORTNIGHT_DAYS);
      const coversEnd = addDays(day1, nextFortnight * FORTNIGHT_DAYS - 1);
      const wkA = (nextFortnight - 1) * 2 + 1;
      const wkB = nextFortnight * 2;

      const client = clientMap.get(clientId);
      rows.push({
        client_id: clientId,
        display_name: (client?.display_name as string | undefined) ?? null,
        mobile_number:
          (client?.mobile_number as string | undefined) ??
          (client?.mobile as string | undefined) ??
          null,
        plan_slug: planSlug,
        day1,
        fortnight_number: nextFortnight,
        total_fortnights: totalFortnights,
        weeks_label: `Weeks ${wkA}–${wkB}`,
        covers_start: coversStart,
        covers_end: coversEnd,
        send_on: sendOn,
        days_until_send: daysUntil,
        status: daysUntil <= 0 ? "due" : "upcoming",
      });
    }

    // Most urgent first (overdue/due before upcoming).
    rows.sort((a, b) => a.days_until_send - b.days_until_send);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

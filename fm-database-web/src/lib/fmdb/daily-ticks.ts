/**
 * Reading the client's daily checklist for the coach.
 *
 * The app writes one row per local day to `_daily_ticks.jsonl` — every item
 * she was shown that day, with its name, and whether she ticked it. This
 * aggregates a trailing window into the two things the coach actually acts on:
 *
 *   1. Is she logging at all? (a day strip — a gap is a gap in ENGAGEMENT,
 *      which is different from taking nothing)
 *   2. WHICH item is being skipped? (per-item day counts, worst first — the
 *      one supplement that never gets taken is the conversation to have)
 *
 * Deliberately honest about what it cannot know. A day with no row means the
 * app was not opened, or was opened and nothing was ticked — NOT that she took
 * nothing. Those are never merged into an adherence percentage here, because a
 * number that quietly counts silence as failure is worse than no number: it
 * would have the coach open a difficult conversation on an artefact.
 */
import fs from "fs/promises";
import path from "path";
import { getPlansRoot } from "./paths";

export interface TickRow {
  date: string;
  ts?: string;
  week?: number | null;
  done: number;
  total: number;
  items: { kind: string; id: string; name: string; done: boolean; at?: string | null }[];
}

export interface TickItemSummary {
  kind: string;
  /** Name as the client saw it most recently. */
  name: string;
  /** Days ticked, out of the days this item was actually on her list. */
  doneDays: number;
  offeredDays: number;
}

export interface DailyTicksSummary {
  /** One entry per day in the window, oldest first. `null` = no row that day. */
  days: { date: string; done: number; total: number }[];
  /** Days with a row at all — the engagement denominator. */
  loggedDays: number;
  /** Window length in days. */
  windowDays: number;
  /** Ticks / offered, counted ONLY across days that have a row. */
  tickedOfOffered: { done: number; offered: number } | null;
  items: TickItemSummary[];
  /** Most recent row's date, or null when there is no data at all. */
  lastLoggedOn: string | null;
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Parse the per-client tick log. Returns rows in the trailing `days` window,
 *  oldest first. Malformed lines are skipped, never fatal. */
export async function loadTickRows(clientId: string, days = 14): Promise<TickRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "_daily_ticks.jsonl"),
      "utf-8",
    );
  } catch {
    return [];
  }
  const cutoff = isoDaysAgo(days - 1);
  const rows: TickRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<TickRow>;
      if (typeof r.date !== "string" || r.date < cutoff) continue;
      if (!Array.isArray(r.items)) continue;
      rows.push({
        date: r.date,
        ts: r.ts,
        week: r.week ?? null,
        done: typeof r.done === "number" ? r.done : r.items.filter((i) => i.done).length,
        total: typeof r.total === "number" ? r.total : r.items.length,
        items: r.items,
      });
    } catch {
      /* skip a malformed line */
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export async function loadDailyTicks(clientId: string, days = 14): Promise<DailyTicksSummary> {
  const rows = await loadTickRows(clientId, days);
  const byDate = new Map(rows.map((r) => [r.date, r]));

  const dayList: { date: string; done: number; total: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = isoDaysAgo(i);
    const r = byDate.get(d);
    dayList.push({ date: d, done: r?.done ?? 0, total: r?.total ?? 0 });
  }

  // Per item: count only the days the item was actually ON her list. A
  // supplement added on Tuesday must not read 2/14 — it reads 2/3.
  const agg = new Map<string, TickItemSummary>();
  for (const row of rows) {
    for (const it of row.items) {
      const key = `${it.kind}:${it.id}`;
      const cur = agg.get(key) ?? { kind: it.kind, name: it.name || it.id, doneDays: 0, offeredDays: 0 };
      cur.offeredDays += 1;
      if (it.done) cur.doneDays += 1;
      // rows are oldest-first, so the last name seen is the current one
      if (it.name) cur.name = it.name;
      agg.set(key, cur);
    }
  }

  const items = [...agg.values()].sort((a, b) => {
    const ra = a.offeredDays ? a.doneDays / a.offeredDays : 0;
    const rb = b.offeredDays ? b.doneDays / b.offeredDays : 0;
    if (ra !== rb) return ra - rb; // worst adherence first — that's the action
    return a.name.localeCompare(b.name);
  });

  const done = rows.reduce((n, r) => n + r.done, 0);
  const offered = rows.reduce((n, r) => n + r.total, 0);

  return {
    days: dayList,
    loggedDays: rows.length,
    windowDays: days,
    tickedOfOffered: offered > 0 ? { done, offered } : null,
    items,
    lastLoggedOn: rows.length ? rows[rows.length - 1].date : null,
  };
}

/**
 * The new front's reading of the day: what is NEXT, what is later, what has
 * been ticked, and what the record says about earlier days.
 *
 * Pure functions, no React and no clock of their own — the caller passes the
 * hour and the date — so every rule here can be tested exactly.
 *
 * It sits ON TOP of day-plan.ts (which decides the order of the day) and adds
 * the three things the new Home needs:
 *
 *  1. MOMENTS. day-plan.ts returns a flat list: breakfast, then the capsule
 *     taken with breakfast, then lunch. The Home shows one card per moment —
 *     "Breakfast, take with it: Iron" — so a supplement timed with a main meal
 *     is folded into that meal's moment as its own tick.
 *  2. NEXT. The first unticked moment from the part of the day she is in
 *     onward. Earlier parts of the day are never shown as "next" and never
 *     listed as overdue: she can still tick them in "Your whole day", and the
 *     Home never tells her she missed something.
 *  3. THE RECORD. One line per saved day, naming what was not ticked.
 *
 * Decisions carried from the build plan: a meal tick records the meal only;
 * capsules are their own ticks; a supplement that is not due every day counts
 * only on the days it is ticked.
 */

import type { AppMeal, AppPractice, AppRemedy, AppSupplement, AppTickDay } from "@/lib/fmdb/client-app";
import { crisp } from "./crisp";
import type { TickItem } from "./daily-ticks";
import { BAND_META, BAND_ORDER, buildDay, mealTickId, slotLabel, type BandKey, type DayInput } from "./day-plan";

// ── ticks ──────────────────────────────────────────────────────────────────

/** The day's ticks as today's app already stores them, plus practice times. */
export interface SqTicks {
  /** meals, supplements and remedies: id → the time it was ticked */
  logged: Record<string, string>;
  /** practices: id → done */
  practicesDone: Record<string, boolean>;
  /** practices: id → the time it was ticked (may be absent for an old tick) */
  practiceAt: Record<string, string>;
}

export type SqKind = "meal" | "supp" | "remedy" | "practice";

export const isTicked = (id: string, kind: SqKind, t: SqTicks): boolean =>
  kind === "practice" ? !!t.practicesDone[id] : !!t.logged[id];

/** The time a tick was made ("8:35 am"), or null when not ticked / not known. */
export const tickedAt = (id: string, kind: SqKind, t: SqTicks): string | null =>
  (kind === "practice" ? t.practiceAt[id] : t.logged[id]) || null;

// ── moments ────────────────────────────────────────────────────────────────

/** A supplement taken with a main meal — its own tick under the meal. */
export interface SqWith {
  id: string;
  name: string;
  /** dose and timing, as one line */
  note: string;
  /** false for a supplement not due every day */
  counted: boolean;
}

export interface SqMoment {
  /** the id this moment is ticked under */
  id: string;
  kind: SqKind;
  band: BandKey;
  /** "Breakfast", "On waking", "Before bed" */
  part: string;
  /** a clock hint when the plan gives one ("8:30 am"), else "" */
  time: string;
  title: string;
  /** one supporting line; "" when there is nothing to add */
  sub: string;
  /** the longer how-to, kept a tap away; "" when none */
  how: string;
  /** false for something not due every day (a weekly practice) */
  counted: boolean;
  /** supplements taken with it (main meals only) */
  with: SqWith[];
  /** meals only: the menu slot, which the recipe is keyed by */
  slot?: string;
}

/** Never more than this many dish components on the supporting line; the rest
 *  are COUNTED ("+2 more"), never silently dropped. */
const MEAL_LINE_MAX = 5;

/** Main meals sit at these ranks in day-plan.ts (mealRank). Only these take
 *  "with it" supplements: a mid-morning snack or tea-time bite does not. */
const MAIN_MEAL_RANKS = new Set([19.5, 39.5, 59.5]);
/** A supplement belongs to the main meal just before it when its rank is
 *  within this distance: "with breakfast" is 20 and "timing not set" is 25
 *  against breakfast's 19.5; "with lunch" 40 and "with a meal" 45 against
 *  lunch's 39.5; "with dinner" 60 against dinner's 59.5. Mid-morning (30) and
 *  afternoon (50) are deliberately out of reach. */
const WITH_MEAL_REACH = 5.5;

const shortName = (name: string) => name.split(" (")[0].trim();

/** The name a meal goes by: the matched recipe's name, else its first dish.
 *  A portion written after the name ("Tea with milk (1 cup)") is dropped from
 *  the NAME only — the supporting line still lists every dish with its portion. */
export function mealTitle(meal: AppMeal): string {
  const raw = (meal.dishTitle || meal.components[0]?.title || meal.pills[0] || slotLabel(meal.slot)).trim();
  return raw.replace(/\s*\([^()]*\)\s*$/, "").trim() || raw;
}

function mealSub(meal: AppMeal): string {
  const title = mealTitle(meal).toLowerCase();
  const parts = meal.components.map((c) => (c.portion ? `${c.title} (${c.portion})` : c.title));
  // A single dish that IS the title, with no portion, adds nothing as a second line.
  if (parts.length <= 1 && (parts[0] || "").toLowerCase() === title) return meal.note?.trim() || "";
  const shown = parts.slice(0, MEAL_LINE_MAX).join(" · ");
  return parts.length > MEAL_LINE_MAX ? `${shown} · +${parts.length - MEAL_LINE_MAX} more` : shown;
}

function suppNote(s: AppSupplement): string {
  const timing = s.notDaily === "weekly" ? "Once a week" : s.notDaily === "alternate" ? "Alternate days" : s.timing;
  return [s.dose, timing].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
}

function remedyNote(r: AppRemedy): string {
  return [r.dose, r.timing || r.when].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
}

function practiceLines(p: AppPractice): { title: string; sub: string; how: string } {
  // Headline first; the rest of the sentence and the details stay a tap away.
  const { head, rest } = crisp(p.name);
  const often = p.kind === "weekly" ? (p.perWeek ? `${p.perWeek} times a week` : "A few times a week") : "";
  return { title: head, sub: often, how: [rest, p.details].map((x) => (x || "").trim()).filter(Boolean).join("\n\n") };
}

/**
 * The day as moments, in the order it is lived. Each main meal carries the
 * supplements taken with it; everything else is a moment of its own.
 */
export function buildMoments(input: DayInput): SqMoment[] {
  const out: SqMoment[] = [];
  for (const band of buildDay(input)) {
    /** the main meal a following supplement may attach to, with its rank */
    let anchor: { moment: SqMoment; rank: number } | null = null;
    for (const it of band.items) {
      if (it.type === "meal") {
        const index = Number(it.key.replace("meal-", ""));
        const moment: SqMoment = {
          id: mealTickId(it.meal, index, input.meals),
          kind: "meal",
          band: band.key,
          part: slotLabel(it.meal.slot) || BAND_META[band.key].label,
          time: (it.meal.timeHint || "").trim(),
          title: mealTitle(it.meal),
          sub: mealSub(it.meal),
          how: "",
          counted: true,
          with: [],
          slot: it.meal.slot,
        };
        out.push(moment);
        anchor = MAIN_MEAL_RANKS.has(it.rank) ? { moment, rank: it.rank } : null;
        continue;
      }
      if (it.type === "supp") {
        const withMeal =
          anchor !== null && !it.supp.emptyStomach && it.rank > anchor.rank && it.rank - anchor.rank <= WITH_MEAL_REACH;
        if (withMeal && anchor) {
          anchor.moment.with.push({ id: it.id, name: shortName(it.supp.name), note: suppNote(it.supp), counted: it.counted });
          continue;
        }
        out.push({
          id: it.id,
          kind: "supp",
          band: band.key,
          part: BAND_META[band.key].label,
          time: "",
          title: shortName(it.supp.name),
          sub: suppNote(it.supp),
          how: "",
          counted: it.counted,
          with: [],
        });
        continue;
      }
      if (it.type === "remedy") {
        out.push({
          id: it.id,
          kind: "remedy",
          band: band.key,
          part: BAND_META[band.key].label,
          time: "",
          title: shortName(it.remedy.name),
          sub: remedyNote(it.remedy),
          how: "",
          counted: it.counted,
          with: [],
        });
        continue;
      }
      const lines = practiceLines(it.practice);
      out.push({
        id: it.id,
        kind: "practice",
        band: band.key,
        part: BAND_META[band.key].label,
        time: "",
        title: lines.title,
        sub: lines.sub,
        how: lines.how,
        counted: it.counted,
        with: [],
      });
    }
  }
  return out;
}

// ── next and later ─────────────────────────────────────────────────────────

const bandIndex = (b: BandKey) => BAND_ORDER.indexOf(b);

/**
 * What is still ahead today, in order: unticked moments from the part of the
 * day she is in onward. "Any time" things are never ahead — they have no
 * moment — and are listed separately (anytimeMoments).
 */
export function upcomingMoments(moments: SqMoment[], ticks: SqTicks, nowBand: BandKey): SqMoment[] {
  const now = bandIndex(nowBand);
  return moments.filter((m) => m.band !== "anytime" && bandIndex(m.band) >= now && !isTicked(m.id, m.kind, ticks));
}

/** The one thing the Home shows as "next", or null when nothing is ahead. */
export function nextMoment(moments: SqMoment[], ticks: SqTicks, nowBand: BandKey): SqMoment | null {
  return upcomingMoments(moments, ticks, nowBand)[0] ?? null;
}

/** Unticked things with no set time (a weekly strength session). */
export function anytimeMoments(moments: SqMoment[], ticks: SqTicks): SqMoment[] {
  return moments.filter((m) => m.band === "anytime" && !isTicked(m.id, m.kind, ticks));
}

/** "lunch, dinner, before bed" — the parts still ahead after the next one. */
export function laterSummary(later: SqMoment[]): string {
  const seen: string[] = [];
  for (const m of later) {
    const part = m.part.toLowerCase();
    if (!seen.includes(part)) seen.push(part);
  }
  return seen.join(", ");
}

// ── the count ──────────────────────────────────────────────────────────────

/** Every tick on the day as a flat row: the moment, then what is taken with it. */
export interface SqRow {
  id: string;
  kind: SqKind;
  name: string;
  /** "Breakfast · 8:30 am" for a moment; dose and timing for a supplement */
  note: string;
  counted: boolean;
  /** true for a supplement listed under its meal */
  under: boolean;
}

export function dayRows(moments: SqMoment[]): SqRow[] {
  return moments.flatMap((m) => [
    {
      id: m.id,
      kind: m.kind,
      name: m.title,
      note: m.kind === "meal" ? [m.part, m.time].filter(Boolean).join(" · ") : [m.part, m.sub].filter(Boolean).join(" · "),
      counted: m.counted,
      under: false,
    },
    ...m.with.map((w) => ({ id: w.id, kind: "supp" as const, name: w.name, note: w.note, counted: w.counted, under: true })),
  ]);
}

/**
 * "4 of 11 ticked". The total is what is owed TODAY: everything due every
 * day, plus anything not due every day that she has ticked. A weekly practice
 * she did not do today is not in the total, so a day can always be completed.
 */
export function dayCount(moments: SqMoment[], ticks: SqTicks): { ticked: number; total: number } {
  const rows = dayRows(moments);
  const done = rows.filter((r) => isTicked(r.id, r.kind, ticks));
  return { ticked: done.length, total: rows.filter((r) => r.counted || isTicked(r.id, r.kind, ticks)).length };
}

// ── what the coach is sent ─────────────────────────────────────────────────

/** Today's meals as tick rows for the coach's log. Every meal goes each time,
 *  ticked or not, with the name as she saw it — the same whole-day snapshot
 *  the supplement, remedy and practice rows already use. */
export function mealTickItems(meals: AppMeal[], logged: Record<string, string>): TickItem[] {
  return meals.map((meal, i) => {
    const id = mealTickId(meal, i, meals);
    return { kind: "meal" as const, id, name: mealTitle(meal), done: !!logged[id], at: logged[id] ?? null };
  });
}

// ── the record ─────────────────────────────────────────────────────────────

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const addDays = (ymd: string, n: number) => new Date(utc(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** "Tue 17 Nov" from a YYYY-MM-DD, with no timezone of its own. */
export function dayLabel(ymd: string): string {
  const d = utc(ymd);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** The Monday of the week a day falls in. */
function weekStart(ymd: string): string {
  return addDays(ymd, -((utc(ymd).getUTCDay() + 6) % 7));
}

/** Names past this many are counted, not listed, to keep the line readable. */
const NOT_TICKED_MAX = 3;

/** One line for a saved day: "9 of 11 · not ticked: psyllium husk, sleep wind-down". */
export function recordSummary(items: AppTickDay["items"]): string {
  if (items.length === 0) return "Nothing ticked";
  const missed = items.filter((i) => !i.done).map((i) => i.name.toLowerCase());
  const done = items.length - missed.length;
  if (done === 0) return `Nothing ticked · ${items.length} on the plan`;
  if (missed.length === 0) return `${done} of ${items.length}`;
  const named = missed.slice(0, NOT_TICKED_MAX).join(", ");
  const more = missed.length > NOT_TICKED_MAX ? ` and ${missed.length - NOT_TICKED_MAX} more` : "";
  return `${done} of ${items.length} · not ticked: ${named}${more}`;
}

/** True when a saved day has no meal rows at all: it was logged before meals
 *  could be ticked (or in today's app), so meals were not tracked that day. */
export const mealsNotTracked = (items: AppTickDay["items"]): boolean =>
  items.length > 0 && !items.some((i) => i.kind === "meal");

export interface RecordDay {
  date: string;
  /** "Tue 17 Nov", or "Today · Wed 18 Nov" */
  label: string;
  summary: string;
  today: boolean;
  /** the saved rows; null for today (shown live) and for a day with no row */
  items: AppTickDay["items"] | null;
}

export interface RecordSection {
  title: "This week" | "Last week" | "Earlier";
  days: RecordDay[];
}

/**
 * The record, newest first: today, then each earlier day back to the first
 * day anything was saved (at most `span` days). A day with no saved row reads
 * "Nothing ticked" — that is all that is known about it.
 */
export function buildRecord(history: AppTickDay[], todayYmd: string, todaySummary: string, span = 14): RecordSection[] {
  const byDate = new Map(history.filter((d) => d.date < todayYmd).map((d) => [d.date, d]));
  const oldest = addDays(todayYmd, -(span - 1));
  const first = [...byDate.keys()].filter((d) => d >= oldest).sort()[0] ?? todayYmd;
  const thisWeek = weekStart(todayYmd);
  const lastWeek = addDays(thisWeek, -7);
  const sections: RecordSection[] = [];
  const push = (title: RecordSection["title"], day: RecordDay) => {
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.days.push(day);
    else sections.push({ title, days: [day] });
  };
  for (let d = todayYmd; d >= first; d = addDays(d, -1)) {
    const title = d >= thisWeek ? "This week" : d >= lastWeek ? "Last week" : "Earlier";
    if (d === todayYmd) {
      push(title, { date: d, label: `Today · ${dayLabel(d)}`, summary: todaySummary, today: true, items: null });
      continue;
    }
    const row = byDate.get(d);
    push(title, {
      date: d,
      label: dayLabel(d),
      summary: row ? recordSummary(row.items) : "Nothing ticked",
      today: false,
      items: row ? row.items : null,
    });
  }
  return sections;
}

// ── small things the Home says ─────────────────────────────────────────────

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The return card shows after this many whole days away. */
export const RETURN_AFTER_DAYS = 3;

export const showReturnCard = (daysSinceLastOpen: number | null | undefined): boolean =>
  typeof daysSinceLastOpen === "number" && daysSinceLastOpen >= RETURN_AFTER_DAYS;

/** The start card shows before the plan begins and on its first day. */
export const showStartCard = (notStarted: boolean, planDay: number): boolean => notStarted || planDay === 1;

export interface WeekLine {
  /** which screen the line opens */
  opens: "grocery" | "checkin";
  title: string;
  sub: string;
}

/**
 * The one "This week" line: the shopping list until it is shopped, then the
 * check-in until it is sent, then nothing. Never both, and nothing on the
 * first day (the start card already carries the shopping list).
 */
export function thisWeekLine(o: {
  week: number;
  firstDay: boolean;
  /** items on this week's shopping list; 0 when there is no list */
  groceryCount: number;
  shopped: boolean;
  checkinSent: boolean;
}): WeekLine | null {
  if (o.firstDay) return null;
  if (o.groceryCount > 0 && !o.shopped) {
    return { opens: "grocery", title: "Your shopping list", sub: `${o.groceryCount} ${o.groceryCount === 1 ? "item" : "items"}` };
  }
  if (!o.checkinSent) {
    return { opens: "checkin", title: `Your week ${o.week} check-in`, sub: "About a minute" };
  }
  return null;
}

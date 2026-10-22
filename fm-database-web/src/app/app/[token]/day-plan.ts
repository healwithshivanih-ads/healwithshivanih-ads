/**
 * The client's day, in the order it is lived.
 *
 * Today used to be four separate cards — meals (with the on-waking drinks
 * folded in), supplements (Morning / With meals / Bedtime), daily practices,
 * remedies — so one moment of the day was split across the screen. Nazneen's
 * morning was ten things in three cards: drinks in Meals, the breakfast shake
 * and capsules in Supplements, the ritual and the coffee rule in Practices.
 * She ticked it all at once, hours later, on 17 of 46 days.
 *
 * This builds ONE list per part of the day — on waking, morning, midday,
 * evening, before bed, plus "any time today" — holding every meal, supplement,
 * drink, remedy and practice that belongs to that moment, in time order. The
 * screen renders it; this file decides it, so it can be tested without React.
 *
 * Every placement reuses the clock the rest of the app already uses: a
 * supplement's chronoRank (client-app-format.ts: 10 waking … 70 bedtime,
 * 100 as-needed), a remedy's parsed slots (remedy-slots.ts), a practice's
 * DayPart (practice-kind.ts). Nothing is re-parsed here.
 *
 * COUNTED vs OFFERED. Only things due every day count toward the day's ring.
 * A weekly practice or a once-a-week supplement is shown and tickable, but a
 * day it was not done is not a day failed.
 */
import type { AppMeal, AppPractice, AppRemedy, AppSupplement } from "@/lib/fmdb/client-app";
import { remedySlots, type RemedySlot } from "@/lib/fmdb/remedy-slots";

export type BandKey = "waking" | "morning" | "midday" | "evening" | "bedtime" | "anytime";

export const BAND_META: Record<BandKey, { label: string; hint: string; glyph: string }> = {
  waking: { label: "On waking", hint: "Before breakfast", glyph: "sun" },
  morning: { label: "Morning", hint: "Breakfast and mid-morning", glyph: "sun" },
  midday: { label: "Midday", hint: "Lunch and after", glyph: "bowl" },
  evening: { label: "Evening", hint: "Snack, dinner and after", glyph: "bowl" },
  bedtime: { label: "Before bed", hint: "Winding down", glyph: "moon" },
  anytime: { label: "Any time today", hint: "Whenever suits you", glyph: "sparkle" },
};

export const BAND_ORDER: BandKey[] = ["waking", "morning", "midday", "evening", "bedtime", "anytime"];

export type DayItem =
  | { type: "meal"; key: string; rank: number; meal: AppMeal }
  | { type: "supp"; id: string; rank: number; supp: AppSupplement; counted: boolean }
  | { type: "remedy"; id: string; rank: number; remedy: AppRemedy; counted: boolean }
  | { type: "practice"; id: string; rank: number; practice: AppPractice; counted: boolean };

export interface DayBand {
  key: BandKey;
  items: DayItem[];
  /** ids that count toward the day's ring (daily items only) */
  countedIds: string[];
  /** every tickable id in the band, counted or not */
  tickIds: string[];
}

// ── placement ──────────────────────────────────────────────────────────────

/** A fine rank → the band it lives in. Same cut points as slotFromRank. */
export function bandOfRank(rank: number): BandKey {
  // 19 and 39, not 20 and 40: a meal sits half a point BEFORE the supplements
  // taken with it (breakfast 19.5, lunch 39.5) and belongs to its own part of
  // the day, not the one before.
  if (rank < 19) return "waking";
  if (rank < 39) return "morning";
  if (rank < 50) return "midday";
  if (rank < 70) return "evening";
  if (rank < 100) return "bedtime";
  return "anytime";
}

/** Meals sit just BEFORE the supplements taken with them (with-breakfast is
 *  rank 20, breakfast is 19.5), so the capsule reads under its meal. */
function mealRank(slot: string, index: number): number {
  if (/wak|rising|empty stomach/i.test(slot)) return 8.5;
  if (/breakfast/i.test(slot)) return 19.5;
  if (/mid.?morning|brunch/i.test(slot)) return 29.5;
  if (/lunch/i.test(slot)) return 39.5;
  if (/snack|tea.?time|afternoon/i.test(slot)) return 50.5;
  if (/dinner|supper/i.test(slot)) return 59.5;
  // An unrecognised slot keeps its place among the meals.
  return 20 + index * 10;
}

const SLOT_RANK: Record<RemedySlot, number> = {
  on_waking: 8,
  mid_morning: 33,
  after_lunch: 46,
  mid_afternoon: 51,
  after_dinner: 66,
  bedtime: 72,
};

/** A remedy's EARLIEST slot — CCF tea "mid-morning, mid-afternoon, evening"
 *  is one daily tick, placed at its first moment. Null when unplaced. */
function remedyRank(r: AppRemedy): number | null {
  const slots = remedySlots(r.timing || r.when || "");
  if (slots.length) return Math.min(...slots.map((s) => SLOT_RANK[s]));
  // Supplement-like remedies (triphala churan) carry the supplement grouping.
  if (r.suppSlot === "Bedtime") return 72;
  if (r.suppSlot === "With meals") return 41;
  if (r.suppSlot === "Morning") return 21;
  return null;
}

const PRACTICE_RANK: Record<AppPractice["part"], number> = {
  waking: 9,
  morning: 15,
  midday: 44,
  meals: 47, // "after each meal" — one tick, shown after lunch
  evening: 58,
  bedtime: 75,
  anytime: 150,
};

// ── build ──────────────────────────────────────────────────────────────────

export interface DayInput {
  meals: AppMeal[];
  supplements: AppSupplement[];
  remedies: AppRemedy[];
  practices: AppPractice[];
}

export function buildDay(input: DayInput): DayBand[] {
  const items: DayItem[] = [];

  input.meals.forEach((meal, i) =>
    items.push({ type: "meal", key: `meal-${i}`, rank: mealRank(meal.slot, i), meal }),
  );

  for (const supp of input.supplements) {
    if (supp.asNeeded) continue; // lives in "when you need it", never the day
    items.push({ type: "supp", id: supp.id, rank: supp.chronoRank, supp, counted: !supp.notDaily });
  }

  for (const remedy of input.remedies) {
    if (!remedy.assigned || !remedy.daily) continue;
    const rank = remedyRank(remedy);
    items.push({ type: "remedy", id: "rx-" + remedy.slug, rank: rank ?? 150, remedy, counted: true });
  }

  for (const practice of input.practices) {
    if (practice.dueToday === false) continue; // a weekly practice, not today
    items.push({
      type: "practice",
      id: practice.id,
      rank: PRACTICE_RANK[practice.part] ?? 150,
      practice,
      counted: practice.kind === "daily",
    });
  }

  const byBand = new Map<BandKey, DayItem[]>(BAND_ORDER.map((k) => [k, []]));
  for (const it of items) byBand.get(bandOfRank(it.rank))!.push(it);

  return BAND_ORDER.map((key) => {
    // Array.prototype.sort is stable: equal ranks keep authored order.
    const list = byBand.get(key)!.sort((a, b) => a.rank - b.rank);
    const tickable = list.filter((i): i is Exclude<DayItem, { type: "meal" }> => i.type !== "meal");
    return {
      key,
      items: list,
      countedIds: tickable.filter((i) => i.counted).map((i) => i.id),
      tickIds: tickable.map((i) => i.id),
    };
  }).filter((b) => b.items.length > 0);
}

/** Which band "now" is, for opening the right one by default. */
export function bandForHour(hour: number): BandKey {
  if (hour < 8) return "waking";
  if (hour < 12) return "morning";
  if (hour < 16) return "midday";
  if (hour < 21) return "evening";
  return "bedtime";
}

/** The day's ring: counted items only, plus the one daily energy tap. */
export function dayTotals(bands: DayBand[], logged: Record<string, string>, practicesDone: Record<string, boolean>) {
  const counted = bands.flatMap((b) => b.countedIds);
  const done = counted.filter((id) => !!logged[id] || !!practicesDone[id]).length;
  return { total: counted.length, done };
}

/** A menu slot as the client should read it. Some drafted menus store the
 *  raw key ("on_waking", "lunch"); the old meal row showed it uppercased by
 *  CSS, which hid the underscore — a one-line summary does not. */
export function slotLabel(slot: string): string {
  const t = (slot || "").replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/**
 * The new Home's reading of the day.
 *
 * These are the rules a client lives with every day, so each is pinned from
 * what it MEANS, not from the implementation: what "next" is at a given hour,
 * that nothing prescribed can vanish from the day, that a meal tick is only
 * the meal, that a rest-day supplement is never counted against her, and that
 * the record names what was not ticked without inventing anything.
 *
 * Synthetic plan only — no client data in a committed test.
 */

import { describe, expect, it } from "vitest";
import type { AppMeal, AppPractice, AppRemedy, AppSupplement, AppTickDay } from "@/lib/fmdb/client-app";
import { mealTickId } from "./day-plan";
import {
  anytimeMoments,
  buildMoments,
  buildRecord,
  dayCount,
  dayLabel,
  dayRows,
  greeting,
  isTicked,
  laterSummary,
  mealTickItems,
  mealsNotTracked,
  nextMoment,
  recordSummary,
  showReturnCard,
  showStartCard,
  thisWeekLine,
  tickedAt,
  upcomingMoments,
  type SqTicks,
} from "./sq-day";

// ── a synthetic day ────────────────────────────────────────────────────────

const meal = (slot: string, titles: string[], extra: Partial<AppMeal> = {}): AppMeal =>
  ({ slot, timeHint: "", glyph: "", pills: titles, components: titles.map((title) => ({ title })), ...extra }) as AppMeal;
const supp = (id: string, chronoRank: number, extra: Partial<AppSupplement> = {}): AppSupplement =>
  ({ id, name: id, dose: "1 capsule", slot: "Morning", timing: "", chronoRank, why: "", ...extra }) as AppSupplement;
const remedy = (slug: string, timing: string): AppRemedy =>
  ({ slug, name: slug, dose: "1 glass", timing, when: "", assigned: true, daily: true, route: "internal" }) as unknown as AppRemedy;
const practice = (id: string, part: AppPractice["part"], kind: AppPractice["kind"] = "daily", name = id): AppPractice => ({
  id,
  name,
  when: "",
  kind,
  part,
  dueToday: true,
});

/** On-waking drink, breakfast with iron (alternate days), a mid-morning
 *  snack with a between-meals supplement, lunch with two capsules, an
 *  afternoon snack, dinner with psyllium, a bedtime wind-down and magnesium,
 *  and a weekly strength session with no set time. */
const PLAN = {
  meals: [
    meal("Breakfast", ["Besan chilla", "Mint chutney"], { timeHint: "8:30 am" }),
    meal("Mid-morning", ["Orange"]),
    meal("Lunch", ["Palak moong dal", "Jowar roti"], { timeHint: "1:00 pm" }),
    meal("Snack", ["Roasted chana"]),
    meal("Dinner", ["Moong khichdi"], { timeHint: "7:30 pm" }),
  ],
  supplements: [
    supp("s-iron", 20, { name: "Iron (bisglycinate)", notDaily: "alternate" }),
    supp("s-probiotic", 30, { timing: "Between meals" }),
    supp("s-d3", 40),
    supp("s-b", 45),
    supp("s-psyllium", 60),
    supp("s-magnesium", 70, { timing: "At bedtime" }),
    supp("s-fasted", 20, { emptyStomach: true }),
    supp("s-rescue", 100, { asNeeded: true }),
  ],
  remedies: [remedy("chia-water", "First thing on waking")],
  practices: [
    practice("p-wind", "bedtime", "daily", "Wind down before bed — lights low, slow breath"),
    practice("p-strength", "anytime", "weekly", "Strength session"),
  ],
};

const NONE: SqTicks = { logged: {}, practicesDone: {}, practiceAt: {} };
const moments = () => buildMoments(PLAN);
const byId = (id: string) => moments().find((m) => m.id === id)!;

// ── moments ────────────────────────────────────────────────────────────────

describe("buildMoments — the day as the Home shows it", () => {
  it("folds a supplement into the main meal it is taken with", () => {
    expect(byId("m-breakfast").with.map((w) => w.id)).toEqual(["s-iron"]);
    expect(byId("m-lunch").with.map((w) => w.id)).toEqual(["s-d3", "s-b"]);
    expect(byId("m-dinner").with.map((w) => w.id)).toEqual(["s-psyllium"]);
  });

  it("never folds a supplement into a snack, and keeps a between-meals one on its own", () => {
    expect(byId("m-mid-morning").with).toEqual([]);
    expect(byId("m-snack").with).toEqual([]);
    expect(moments().some((m) => m.id === "s-probiotic" && m.kind === "supp")).toBe(true);
  });

  it("keeps an empty-stomach supplement on its own, never 'with' breakfast", () => {
    expect(byId("m-breakfast").with.map((w) => w.id)).not.toContain("s-fasted");
    expect(moments().some((m) => m.id === "s-fasted" && m.kind === "supp")).toBe(true);
  });

  it("loses nothing: every prescribed tick is in the day exactly once", () => {
    const ids = dayRows(moments()).map((r) => r.id);
    const expected = [
      "rx-chia-water",
      "s-fasted",
      "m-breakfast",
      "s-iron",
      "m-mid-morning",
      "s-probiotic",
      "m-lunch",
      "s-d3",
      "s-b",
      "m-snack",
      "m-dinner",
      "s-psyllium",
      "s-magnesium",
      "p-wind",
      "p-strength",
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves an as-needed supplement out of the day", () => {
    expect(dayRows(moments()).map((r) => r.id)).not.toContain("s-rescue");
  });

  it("runs in the order the day is lived", () => {
    const order = moments().map((m) => m.id);
    const at = (id: string) => order.indexOf(id);
    expect(at("rx-chia-water")).toBeLessThan(at("m-breakfast"));
    expect(at("m-breakfast")).toBeLessThan(at("m-lunch"));
    expect(at("m-lunch")).toBeLessThan(at("m-dinner"));
    expect(at("m-dinner")).toBeLessThan(at("s-magnesium"));
    expect(at("p-strength")).toBe(order.length - 1);
  });

  it("names a meal by its dish and lists every component on the second line", () => {
    const b = byId("m-breakfast");
    expect(b.title).toBe("Besan chilla");
    expect(b.sub).toBe("Besan chilla · Mint chutney");
    expect(b.part).toBe("Breakfast");
    expect(b.time).toBe("8:30 am");
  });

  it("drops a portion from the meal's name but keeps it on the line below", () => {
    const tea = { ...meal("Snack", ["Tea with milk (1 cup)"]), components: [{ title: "Tea with milk", portion: "1 cup" }, { title: "Walnuts", portion: "4" }] };
    const [m] = buildMoments({ meals: [tea], supplements: [], remedies: [], practices: [] });
    expect(m.title).toBe("Tea with milk");
    expect(m.sub).toBe("Tea with milk (1 cup) · Walnuts (4)");
    // A single dish with a portion still shows the portion.
    const one = { ...meal("Snack", ["Orange (1)"]), components: [{ title: "Orange", portion: "1" }] };
    expect(buildMoments({ meals: [one], supplements: [], remedies: [], practices: [] })[0]).toMatchObject({ title: "Orange", sub: "Orange (1)" });
  });

  it("counts components it cannot fit instead of dropping them", () => {
    const seven = ["A", "B", "C", "D", "E", "F", "G"].map((x) => `Dish ${x}`);
    const [m] = buildMoments({ meals: [meal("Lunch", seven)], supplements: [], remedies: [], practices: [] });
    const shown = seven.filter((t) => m.sub.includes(t)).length;
    const counted = Number(m.sub.match(/\+(\d+) more/)?.[1] ?? 0);
    expect(shown + counted).toBe(seven.length);
  });

  it("puts a practice's headline first and keeps the rest a tap away", () => {
    const w = byId("p-wind");
    expect(w.title).toBe("Wind down before bed");
    expect(w.how).toBe("Lights low, slow breath");
  });

  it("keeps a short practice name whole, with nothing hidden", () => {
    const [m] = buildMoments({ meals: [], supplements: [], remedies: [], practices: [practice("p1", "bedtime", "daily", "Rest — early")] });
    expect(m.title).toBe("Rest — early");
    expect(m.how).toBe("");
  });

  it("gives two meals in the same slot different tick ids", () => {
    const meals = [meal("Snack", ["One"]), meal("Snack", ["Two"])];
    expect(mealTickId(meals[0], 0, meals)).not.toBe(mealTickId(meals[1], 1, meals));
  });
});

// ── next ───────────────────────────────────────────────────────────────────

describe("nextMoment — the one card on Home", () => {
  it("is the first thing of the day when the day begins", () => {
    expect(nextMoment(moments(), NONE, "waking")?.id).toBe("rx-chia-water");
  });

  it("moves on as each thing is ticked", () => {
    const t: SqTicks = { ...NONE, logged: { "rx-chia-water": "7:05 am", "s-fasted": "7:06 am" } };
    expect(nextMoment(moments(), t, "waking")?.id).toBe("m-breakfast");
  });

  it("is never something from an earlier part of the day", () => {
    // Nothing ticked, opened at lunchtime: breakfast is not offered as "next".
    expect(nextMoment(moments(), NONE, "midday")?.id).toBe("m-lunch");
    expect(upcomingMoments(moments(), NONE, "midday").map((m) => m.band)).not.toContain("morning");
    // …but it is still in the whole day, where she can tick it.
    expect(dayRows(moments()).map((r) => r.id)).toContain("m-breakfast");
  });

  it("ticking a meal moves on even when its supplements are not ticked", () => {
    const t: SqTicks = { ...NONE, logged: { "m-lunch": "1:10 pm" } };
    expect(nextMoment(moments(), t, "midday")?.id).not.toBe("m-lunch");
    expect(isTicked("s-d3", "supp", t)).toBe(false); // the meal tick is only the meal
  });

  it("is never an any-time thing", () => {
    const all = moments();
    const t: SqTicks = {
      logged: Object.fromEntries(dayRows(all).filter((r) => r.kind !== "practice").map((r) => [r.id, "9:00 am"])),
      practicesDone: { "p-wind": true },
      practiceAt: {},
    };
    expect(nextMoment(all, t, "waking")).toBeNull();
    expect(anytimeMoments(all, t).map((m) => m.id)).toEqual(["p-strength"]);
  });

  it("is nothing late at night when the evening is done", () => {
    const t: SqTicks = { logged: { "s-magnesium": "10:05 pm" }, practicesDone: { "p-wind": true }, practiceAt: {} };
    expect(nextMoment(moments(), t, "bedtime")).toBeNull();
  });

  it("summarises what is later by part of the day, once each", () => {
    const later = upcomingMoments(moments(), NONE, "midday").slice(1);
    // Two things are due before bed (the wind-down and magnesium): one mention.
    expect(laterSummary(later)).toBe("snack, dinner, before bed");
  });
});

// ── the count ──────────────────────────────────────────────────────────────

describe("dayCount — what is owed today", () => {
  it("does not count a rest-day supplement or an undone weekly practice", () => {
    // 15 ticks exist; iron (alternate days) and the weekly session are not owed.
    expect(dayCount(moments(), NONE)).toEqual({ ticked: 0, total: 13 });
  });

  it("counts them on the day she ticks them", () => {
    const t: SqTicks = { logged: { "s-iron": "8:40 am" }, practicesDone: { "p-strength": true }, practiceAt: {} };
    expect(dayCount(moments(), t)).toEqual({ ticked: 2, total: 15 });
  });

  it("can always be completed", () => {
    const all = moments();
    const owed = dayRows(all).filter((r) => r.counted);
    const t: SqTicks = {
      logged: Object.fromEntries(owed.filter((r) => r.kind !== "practice").map((r) => [r.id, "9:00 am"])),
      practicesDone: Object.fromEntries(owed.filter((r) => r.kind === "practice").map((r) => [r.id, true])),
      practiceAt: {},
    };
    const c = dayCount(all, t);
    expect(c.ticked).toBe(c.total);
  });

  it("reads a tick's time from wherever that kind keeps it", () => {
    const t: SqTicks = { logged: { "m-lunch": "1:10 pm" }, practicesDone: { "p-wind": true }, practiceAt: { "p-wind": "9:40 pm" } };
    expect(tickedAt("m-lunch", "meal", t)).toBe("1:10 pm");
    expect(tickedAt("p-wind", "practice", t)).toBe("9:40 pm");
    expect(tickedAt("m-dinner", "meal", t)).toBeNull();
  });
});

// ── what the coach is sent ─────────────────────────────────────────────────

describe("mealTickItems — meals in the coach's log", () => {
  it("sends every meal, ticked or not, under the name she saw", () => {
    const items = mealTickItems(PLAN.meals, { "m-lunch": "1:10 pm" });
    expect(items.map((i) => i.kind)).toEqual(["meal", "meal", "meal", "meal", "meal"]);
    expect(items.find((i) => i.id === "m-lunch")).toEqual({ kind: "meal", id: "m-lunch", name: "Palak moong dal", done: true, at: "1:10 pm" });
    expect(items.filter((i) => i.done)).toHaveLength(1);
    expect(items.find((i) => i.id === "m-dinner")).toMatchObject({ done: false, at: null });
  });

  it("uses the same ids the Home ticks under", () => {
    const sent = mealTickItems(PLAN.meals, {}).map((i) => i.id);
    const shown = moments().filter((m) => m.kind === "meal").map((m) => m.id);
    expect(sent).toEqual(shown);
  });
});

// ── the record ─────────────────────────────────────────────────────────────

const row = (kind: string, name: string, done: boolean, at: string | null = null) => ({ kind, name, done, at });

describe("recordSummary — one line for a saved day", () => {
  it("names what was not ticked", () => {
    const items = [row("meal", "Besan chilla", true, "8:40 am"), row("supplement", "Psyllium Husk", false), row("practice", "Sleep wind-down", false)];
    expect(recordSummary(items)).toBe("1 of 3 · not ticked: psyllium husk, sleep wind-down");
  });

  it("says nothing more when everything was ticked", () => {
    expect(recordSummary([row("meal", "A", true), row("meal", "B", true)])).toBe("2 of 2");
  });

  it("counts the names it does not list", () => {
    const items = [row("meal", "A", true), ...["B", "C", "D", "E", "F"].map((n) => row("meal", n, false))];
    expect(recordSummary(items)).toBe("1 of 6 · not ticked: b, c, d and 2 more");
  });

  it("is plain about a day with nothing ticked", () => {
    expect(recordSummary([row("meal", "A", false), row("meal", "B", false)])).toBe("Nothing ticked · 2 on the plan");
    expect(recordSummary([])).toBe("Nothing ticked");
  });

  it("knows a day logged before meals could be ticked", () => {
    expect(mealsNotTracked([row("supplement", "Iron", true)])).toBe(true);
    expect(mealsNotTracked([row("supplement", "Iron", true), row("meal", "A", false)])).toBe(false);
    expect(mealsNotTracked([])).toBe(false);
  });
});

describe("buildRecord — the days, newest first", () => {
  const day = (date: string, done: number, of: number): AppTickDay => ({
    date,
    items: Array.from({ length: of }, (_, i) => row("supplement", `Item ${i + 1}`, i < done)),
  });
  // Wednesday 18 November 2026.
  const TODAY = "2026-11-18";

  it("is just today for someone with no saved days", () => {
    const rec = buildRecord([], TODAY, "0 of 9 so far");
    expect(rec).toEqual([
      { title: "This week", days: [{ date: TODAY, label: "Today · Wed 18 Nov", summary: "0 of 9 so far", today: true, items: null }] },
    ]);
  });

  it("groups by week and runs back to the first saved day, no further", () => {
    const rec = buildRecord([day("2026-11-12", 2, 3), day("2026-11-16", 3, 3)], TODAY, "1 of 9 so far");
    expect(rec.map((s) => s.title)).toEqual(["This week", "Last week"]);
    expect(rec[0].days.map((d) => d.date)).toEqual(["2026-11-18", "2026-11-17", "2026-11-16"]);
    expect(rec[1].days.map((d) => d.date)).toEqual(["2026-11-15", "2026-11-14", "2026-11-13", "2026-11-12"]);
    // Nothing before the first saved day: nothing is known about those days.
    expect(rec.flatMap((s) => s.days).some((d) => d.date < "2026-11-12")).toBe(false);
  });

  it("says only 'Nothing ticked' for a day with no saved row", () => {
    const rec = buildRecord([day("2026-11-16", 3, 3)], TODAY, "x");
    const tue = rec[0].days.find((d) => d.date === "2026-11-17")!;
    expect(tue).toMatchObject({ label: "Tue 17 Nov", summary: "Nothing ticked", items: null, today: false });
  });

  it("shows today from the phone, never from a saved row for today", () => {
    const rec = buildRecord([day(TODAY, 3, 3)], TODAY, "1 of 9 so far");
    expect(rec[0].days).toHaveLength(1);
    expect(rec[0].days[0]).toMatchObject({ today: true, summary: "1 of 9 so far", items: null });
  });

  it("stops at a fortnight", () => {
    const old = day("2026-10-01", 1, 1);
    const rec = buildRecord([old, day("2026-11-06", 1, 1)], TODAY, "x");
    const dates = rec.flatMap((s) => s.days).map((d) => d.date);
    expect(dates).not.toContain("2026-10-01");
    expect(dates[dates.length - 1]).toBe("2026-11-06");
    expect(rec.map((s) => s.title)).toEqual(["This week", "Last week", "Earlier"]);
  });

  it("labels a date without drifting a day in any timezone", () => {
    expect(dayLabel("2026-11-18")).toBe("Wed 18 Nov");
    expect(dayLabel("2027-01-01")).toBe("Fri 1 Jan");
  });
});

// ── the small things ───────────────────────────────────────────────────────

describe("what the Home says", () => {
  it("greets by the phone's hour", () => {
    expect(greeting(6)).toBe("Good morning");
    expect(greeting(11)).toBe("Good morning");
    expect(greeting(12)).toBe("Good afternoon");
    expect(greeting(16)).toBe("Good afternoon");
    expect(greeting(17)).toBe("Good evening");
    expect(greeting(23)).toBe("Good evening");
  });

  it("shows the return card only after three or more whole days away", () => {
    expect([0, 1, 2].map(showReturnCard)).toEqual([false, false, false]);
    expect([3, 6, 40].map(showReturnCard)).toEqual([true, true, true]);
    expect(showReturnCard(null)).toBe(false);
    expect(showReturnCard(undefined)).toBe(false);
  });

  it("shows the start card before the plan starts and on its first day only", () => {
    expect(showStartCard(true, 0)).toBe(true);
    expect(showStartCard(false, 1)).toBe(true);
    expect(showStartCard(false, 2)).toBe(false);
    expect(showStartCard(false, 80)).toBe(false);
  });

  it("offers the shopping list until it is shopped, then the check-in until it is sent, then nothing", () => {
    const base = { week: 4, firstDay: false, groceryCount: 14, shopped: false, checkinSent: false };
    expect(thisWeekLine(base)).toEqual({ opens: "grocery", title: "Your shopping list", sub: "14 items" });
    expect(thisWeekLine({ ...base, shopped: true })).toEqual({ opens: "checkin", title: "Your week 4 check-in", sub: "About a minute" });
    expect(thisWeekLine({ ...base, shopped: true, checkinSent: true })).toBeNull();
    // No list at all: straight to the check-in.
    expect(thisWeekLine({ ...base, groceryCount: 0 })?.opens).toBe("checkin");
    // The first day carries its own start card instead.
    expect(thisWeekLine({ ...base, firstDay: true })).toBeNull();
    expect(thisWeekLine({ ...base, groceryCount: 1 })?.sub).toBe("1 item");
  });
});

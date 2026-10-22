import { describe, expect, it } from "vitest";
import type { AppMeal, AppPractice, AppRemedy, AppSupplement } from "@/lib/fmdb/client-app";
import { bandForHour, bandOfRank, buildDay, dayTotals, slotLabel } from "./day-plan";

const meal = (slot: string): AppMeal =>
  ({ slot, timeHint: "", glyph: "", pills: [], components: [{ title: slot + " dish" }] }) as unknown as AppMeal;
const supp = (id: string, chronoRank: number, extra: Partial<AppSupplement> = {}): AppSupplement =>
  ({ id, name: id, dose: "", slot: "Morning", timing: "", chronoRank, why: "", ...extra }) as AppSupplement;
const remedy = (slug: string, timing: string, extra: Partial<AppRemedy> = {}): AppRemedy =>
  ({ slug, name: slug, timing, when: "", assigned: true, daily: true, route: "internal", ...extra }) as unknown as AppRemedy;
const practice = (id: string, part: AppPractice["part"], kind: AppPractice["kind"] = "daily"): AppPractice => ({
  id,
  name: id,
  when: "",
  kind,
  part,
  dueToday: true,
});

// A day shaped like Nazneen's: two on-waking drinks, a breakfast shake +
// capsules, five meals, dinner supplements, bedtime magnesium + breathing.
const nazneen = () =>
  buildDay({
    meals: ["Breakfast", "Mid-morning", "Lunch", "Evening snack", "Dinner"].map(meal),
    supplements: [
      supp("whey", 20),
      supp("b-complex", 20),
      supp("zinc", 60),
      supp("fish-oil", 60),
      supp("magnesium", 70),
      supp("d3-weekly", 60, { notDaily: "weekly" }),
      supp("vit-c", 100, { asNeeded: true }),
    ],
    remedies: [
      remedy("ghee-water", "First thing on waking, on an empty stomach"),
      remedy("methi-water", "First thing in the morning, on an empty stomach"),
      remedy("ccf-tea", "Best between meals (mid-morning, mid-afternoon, evening)"),
    ],
    practices: [practice("p1", "anytime"), practice("p7", "bedtime"), practice("p9", "anytime", "weekly")],
  });

describe("buildDay", () => {
  it("puts the whole morning in one place, in the order it is lived", () => {
    const bands = nazneen();
    const waking = bands.find((b) => b.key === "waking")!;
    expect(waking.items.map((i) => (i.type === "meal" ? i.meal.slot : "id" in i ? i.id : ""))).toEqual([
      "rx-ghee-water",
      "rx-methi-water",
    ]);
    const morning = bands.find((b) => b.key === "morning")!;
    // breakfast row first, then what is taken WITH it, then mid-morning
    expect(morning.items.map((i) => (i.type === "meal" ? i.meal.slot : i.id))).toEqual([
      "Breakfast",
      "whey",
      "b-complex",
      "Mid-morning",
      "rx-ccf-tea",
    ]);
  });

  it("drops nothing: every daily item appears exactly once", () => {
    const ids = nazneen().flatMap((b) => b.tickIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      ["whey", "b-complex", "zinc", "fish-oil", "magnesium", "d3-weekly", "rx-ghee-water", "rx-methi-water", "rx-ccf-tea", "p1", "p7", "p9"].sort(),
    );
  });

  it("as-needed supplements never reach the day", () => {
    expect(nazneen().flatMap((b) => b.tickIds)).not.toContain("vit-c");
  });

  it("counts only what is due every day — weekly items are offered, not owed", () => {
    const bands = nazneen();
    const counted = bands.flatMap((b) => b.countedIds);
    expect(counted).not.toContain("d3-weekly");
    expect(counted).not.toContain("p9");
    expect(counted).toHaveLength(10);
    // ticking a weekly item never pushes the ring past what the day asked for
    const { total, done } = dayTotals(bands, { "d3-weekly": "8:00 am" }, { p9: true });
    expect(total).toBe(10);
    expect(done).toBe(0);
  });

  it("a day is completable: ticking every counted item fills the ring", () => {
    const bands = nazneen();
    const logged: Record<string, string> = {};
    const practicesDone: Record<string, boolean> = {};
    for (const id of bands.flatMap((b) => b.countedIds)) {
      if (id.startsWith("p")) practicesDone[id] = true;
      else logged[id] = "9:00 am";
    }
    const { total, done } = dayTotals(bands, logged, practicesDone);
    expect(done).toBe(total);
  });

  it("outside-only remedies get a tick in their moment (they used to count but had none)", () => {
    const bands = buildDay({
      meals: [],
      supplements: [],
      remedies: [remedy("gum-massage", "After brushing, morning and/or night", { route: "external" } as Partial<AppRemedy>)],
      practices: [],
    });
    expect(bands.flatMap((b) => b.countedIds)).toEqual(["rx-gum-massage"]);
  });

  it("a weekly practice whose days are not today stays off the day", () => {
    const bands = buildDay({ meals: [], supplements: [], remedies: [], practices: [{ ...practice("yoga", "morning", "weekly"), dueToday: false }] });
    expect(bands).toHaveLength(0);
  });

  it("empty parts of the day are left out", () => {
    const bands = buildDay({ meals: [], supplements: [supp("mag", 70)], remedies: [], practices: [] });
    expect(bands.map((b) => b.key)).toEqual(["bedtime"]);
  });

  it("unassigned or non-daily remedies stay off the day", () => {
    const bands = buildDay({
      meals: [],
      supplements: [],
      remedies: [remedy("a", "bedtime", { assigned: false }), remedy("b", "bedtime", { daily: false })],
      practices: [],
    });
    expect(bands).toHaveLength(0);
  });
});

describe("clock", () => {
  it("rank cut points match the supplement grouping", () => {
    expect(bandOfRank(10)).toBe("waking");
    expect(bandOfRank(25)).toBe("morning"); // unknown timing defaults here
    expect(bandOfRank(45)).toBe("midday");
    expect(bandOfRank(60)).toBe("evening");
    expect(bandOfRank(70)).toBe("bedtime");
  });
  it("hour → the band to open", () => {
    expect(bandForHour(6)).toBe("waking");
    expect(bandForHour(9)).toBe("morning");
    expect(bandForHour(13)).toBe("midday");
    expect(bandForHour(19)).toBe("evening");
    expect(bandForHour(23)).toBe("bedtime");
  });
});

describe("menu slots", () => {
  it("raw slot keys read as words", () => {
    expect(slotLabel("on_waking")).toBe("On waking");
    expect(slotLabel("lunch")).toBe("Lunch");
    expect(slotLabel("Evening snack")).toBe("Evening snack");
  });
  it("an on-waking menu slot belongs to waking, not the morning", () => {
    const bands = buildDay({ meals: [meal("on_waking"), meal("breakfast")], supplements: [], remedies: [], practices: [] });
    expect(bands.map((b) => [b.key, b.items.length])).toEqual([["waking", 1], ["morning", 1]]);
  });
});

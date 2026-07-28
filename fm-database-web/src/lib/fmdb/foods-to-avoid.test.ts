/**
 * The `foods_to_avoid` gate, with preparation awareness.
 *
 * The bug these pin: the gate was a bare word-boundary match, so a client who
 * only reacts to RAW onion could not be recorded at all — "raw onion" fired
 * the onion category and dropped every cooked-onion recipe too (149 of 467 on
 * the live library). The workaround was to record the sensitivity in
 * `reported_triggers`, which filters nothing.
 *
 * Two halves: pure-unit rules, then a run over the REAL recipe library so a
 * future regex tweak that quietly re-drops the whole library fails here.
 */
import { describe, it, expect } from "vitest";
import {
  buildAvoidFilter,
  usesIngredientRaw,
  ingredientIsRawIn,
  type AvoidableRecipe,
} from "./foods-to-avoid";
import { loadLibraryRecipes } from "./client-app";

const r = (over: Partial<AvoidableRecipe> & { title: string }): AvoidableRecipe => ({
  ingredients: [],
  method: [],
  ...over,
});

const KACHUMBER = r({
  title: "Kachumber",
  mains: ["tomato", "onion", "cucumber"],
  ingredients: ["1 cup tomato, finely diced", "0.5 cup onion, finely diced"],
  method: ["Dice the tomato, onion and cucumber", "Toss them with the green chilli"],
  cookTimeMin: 0,
});

const ALOO_GOBI = r({
  title: "Aloo gobi sabzi",
  mains: ["potato", "cauliflower", "onion"],
  ingredients: ["1 onion, sliced", "2 cup cauliflower"],
  method: [
    "Heat the oil in a pan and crackle the cumin.",
    "Add the onion and saute until soft and golden, about 5 minutes.",
  ],
  cookTimeMin: 25,
});

describe("blanket (unqualified) entries — unchanged behaviour", () => {
  it("drops every recipe naming the food, cooked or not", () => {
    const f = buildAvoidFilter("onion, garlic");
    expect(f.safe(KACHUMBER)).toBe(false);
    expect(f.safe(ALOO_GOBI)).toBe(false);
  });

  it("expands a category trigger to its members", () => {
    const f = buildAvoidFilter("Gluten (wheat/atta, maida)");
    expect(f.blanket).toContain("suji");
    expect(f.safe(r({ title: "Rava upma", ingredients: ["1 cup suji"] }))).toBe(false);
  });

  it("skips narrative fragments so a rambling note can't nuke the library", () => {
    const f = buildAvoidFilter("she says heavy fried food in the evening upsets her stomach");
    expect(f.safe(ALOO_GOBI)).toBe(true);
  });

  it("passes everything through when the field is empty", () => {
    for (const v of ["", "   "]) expect(buildAvoidFilter(v).safe(KACHUMBER)).toBe(true);
  });

  it("keeps the food and drops the reason the coach wrote after it", () => {
    // "Bread - causes constipation" read as a 3-word narrative and filtered
    // NOTHING for cl-010 until the reason tail was split off.
    for (const v of [
      "Bread - causes constipation",
      "Bread – causes constipation",
      "Bread: causes constipation",
      "Brinjal — itchy tongue as a kid",
    ]) {
      const f = buildAvoidFilter(v);
      expect(f.blanket.length, v).toBeGreaterThan(0);
      expect(f.blanket.some((t) => /bread|brinjal/.test(t)), v).toBe(true);
    }
  });

  it("treats a full stop as a separator — the field is prose as often as a list", () => {
    const f = buildAvoidFilter("sea food. Tinda and karela");
    expect(f.blanket).toContain("karela");
    expect(f.blanket).toContain("tinda");
  });

  it("expands 'red meat', which no recipe spells out", () => {
    const f = buildAvoidFilter("No red meat.");
    expect(f.blanket).toContain("mutton");
    expect(f.safe(r({ title: "Mutton curry", ingredients: ["500 g mutton"] }))).toBe(false);
    expect(f.safe(r({ title: "Chicken curry", ingredients: ["500 g chicken"] }))).toBe(true);
  });

  it("expands 'milk products' via the dairy category", () => {
    // dropped 0 of 457 recipes on the coach picker before the two surfaces
    // shared this parser
    const f = buildAvoidFilter("Milk products and Sugar and refined flour");
    expect(f.blanket).toContain("paneer");
    expect(f.safe(r({ title: "Palak paneer", ingredients: ["200 g paneer"] }))).toBe(false);
  });

  it("counts croutons as gluten", () => {
    const f = buildAvoidFilter("gluten");
    expect(f.safe(r({ title: "Beetroot soup", ingredients: ["8-10 croutons, optional"] }))).toBe(false);
  });

  it("a reason tail never eats a raw qualifier", () => {
    // "raw:onion" must not be split on its own colon down to "raw"
    const f = buildAvoidFilter("raw:onion");
    expect(f.rawOnly).toContain("onion");
    expect(f.blanket).toEqual([]);
  });
});

describe("preparation-qualified entries", () => {
  it("'raw onion' drops the raw dish and KEEPS the cooked one", () => {
    const f = buildAvoidFilter("raw onion");
    expect(f.rawOnly).toContain("onion");
    expect(f.blanket).toEqual([]); // must NOT fire the onion category
    expect(f.safe(KACHUMBER)).toBe(false);
    expect(f.safe(ALOO_GOBI)).toBe(true);
  });

  it("accepts the colon form and 'uncooked'", () => {
    for (const v of ["raw:onion", "raw: onion", "uncooked onion"]) {
      const f = buildAvoidFilter(v);
      expect(f.safe(KACHUMBER), v).toBe(false);
      expect(f.safe(ALOO_GOBI), v).toBe(true);
    }
  });

  it("expands the category, so 'raw onion' also covers a raw shallot", () => {
    const f = buildAvoidFilter("raw onion");
    const slaw = r({ title: "Slaw", ingredients: ["2 shallots, thinly sliced"], cookTimeMin: 0 });
    expect(f.safe(slaw)).toBe(false);
  });

  it("catches a raw garnish inside an otherwise cooked recipe", () => {
    const f = buildAvoidFilter("raw onion");
    const soup = r({
      title: "Beetroot soup",
      ingredients: ["1 sprig spring onion, to garnish"],
      method: ["Simmer the beetroot until tender."],
      cookTimeMin: 30,
    });
    expect(f.safe(soup)).toBe(false);
  });

  it("does not read 'cook off the raw smell' as a raw ingredient", () => {
    const f = buildAvoidFilter("raw onion");
    const eggs = r({
      title: "Masala eggs",
      ingredients: ["1 onion, chopped"],
      method: ["Heat the ghee, brown the onion, then cook off the raw smell."],
      cookTimeMin: 10,
    });
    expect(f.safe(eggs)).toBe(true);
  });

  it("attributes a raw marker only to its OWN clause", () => {
    // the garnish here is the FRIED onion, not a raw one
    const f = buildAvoidFilter("raw onion");
    const biryani = r({
      title: "Veg biryani",
      ingredients: ["2 onion, sliced"],
      method: ["Fry the sliced onion until golden, setting aside half for garnish."],
      cookTimeMin: 40,
    });
    expect(f.safe(biryani)).toBe(true);
  });

  it("folds the plural: 'raw onions' still matches an 'onion' ingredient", () => {
    expect(buildAvoidFilter("raw onions").safe(KACHUMBER)).toBe(false);
  });

  it("a blanket entry wins over a raw one for the same food", () => {
    const f = buildAvoidFilter("onion, raw onion");
    expect(f.safe(ALOO_GOBI)).toBe(false);
  });

  it("mixes qualified and unqualified entries independently", () => {
    const f = buildAvoidFilter("raw onion, paneer");
    expect(f.safe(ALOO_GOBI)).toBe(true); // cooked onion — fine
    expect(f.safe(r({ title: "Palak paneer", ingredients: ["200 g paneer"] }))).toBe(false);
  });
});

describe("usesIngredientRaw — the three signals", () => {
  const rx = /\bonion\b/i;
  const probe = (method: string[], ingredients = ["onion"], cookTimeMin?: number) =>
    usesIngredientRaw(r({ title: "x", ingredients, method, cookTimeMin }), rx, "onion");

  it("(1) a recipe that cooks nothing is raw throughout", () => {
    expect(probe(["Toss everything together."], ["onion"], 0)).toBe(true);
  });
  it("(2) a raw garnish inside a cooked dish — the forward scan cannot see this", () => {
    // "onion" appears in a cooking step FIRST, so signal 3 says cooked; only
    // the marked ingredient line reveals the separate raw garnish
    expect(
      probe(["Soften the onion in oil for 5 minutes until translucent."], [
        "1 onion, chopped",
        "1 sprig spring onion, to garnish",
      ]),
    ).toBe(true);
  });
  it("(3) no heat after the food enters → raw", () => {
    expect(probe(["Cook the eggs in a hot pan.", "Mix in the onion and serve."])).toBe(true);
  });
  it("(3) heat after the food enters → cooked", () => {
    expect(probe(["Heat oil in a pan and saute the onion until golden."])).toBe(false);
  });
  it("(3) mixed into a cold batter that is griddled later → cooked", () => {
    expect(probe(["Stir the onion into the besan batter.", "Griddle on a hot tawa until crisp."])).toBe(false);
  });
  it("no method at all is not treated as raw", () => {
    expect(probe([])).toBe(false);
  });
});

describe("against the real recipe library", () => {
  it("'raw onion' recovers the cooked-onion recipes a bare 'onion' drops", async () => {
    const lib = (await loadLibraryRecipes()).map((l) => l.recipe);
    expect(lib.length).toBeGreaterThan(400); // sanity: the library actually loaded

    const blanket = buildAvoidFilter("onion");
    const rawOnly = buildAvoidFilter("raw onion");
    const droppedBlanket = lib.filter((x) => !blanket.safe(x));
    const droppedRaw = lib.filter((x) => !rawOnly.safe(x));

    // measured 2026-07-28: 142 blanket vs 20 raw-only
    expect(droppedBlanket.length).toBeGreaterThan(100);
    expect(droppedRaw.length).toBeLessThan(40);
    // every raw-onion drop is also a blanket drop — the rule only ever relaxes
    for (const d of droppedRaw) expect(droppedBlanket).toContain(d);

    // the raw-onion dishes go …
    const titles = droppedRaw.map((x) => x.title.toLowerCase());
    for (const dish of ["salad", "sandwich", "chaat"])
      expect(titles.some((t) => t.includes(dish)), dish).toBe(true);
    // … and the cooked staples survive
    const kept = lib.filter((x) => rawOnly.safe(x)).map((x) => x.title.toLowerCase());
    for (const dish of ["aloo gobi", "rajma", "dal"])
      expect(kept.some((t) => t.includes(dish)), dish).toBe(true);
  });

  it("every raw-only drop really is an uncooked use", async () => {
    const lib = (await loadLibraryRecipes()).map((l) => l.recipe);
    const f = buildAvoidFilter("raw onion");
    for (const x of lib.filter((y) => !f.safe(y))) {
      const uncooked = x.cookTimeMin === 0;
      const marked = [...x.ingredients, ...(x.method ?? [])].some((s) =>
        /\b(raw|garnish|scatter|sprinkl|top with|topped with|finish with)/i.test(s),
      );
      // or the forward scan found no heat once the onion went in
      const noHeatAfter = ingredientIsRawIn(x, "onion");
      expect(uncooked || marked || noHeatAfter, x.title).toBe(true);
    }
  });
});

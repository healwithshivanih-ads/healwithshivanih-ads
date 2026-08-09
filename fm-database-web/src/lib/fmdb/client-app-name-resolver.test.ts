/**
 * Tests for buildNameResolver — the dish → recipe/remedy matcher.
 *
 * It has plenty of INDIRECT coverage (recipe-match, recipe-aliases,
 * home-remedy-fallback, kachumber-merge, recipe-generation-skip all exercise
 * resolvers built on it), but its ranking rules had never been asserted
 * directly. Each rule below is written in the source next to the live bug that
 * produced it, and the governing principle is stated there too:
 * **"no match > wrong match"** — someone else's method sitting under the
 * client's dish name is worse than an honest blank.
 */
import { describe, it, expect } from "vitest";
import { buildNameResolver } from "./client-app";

/** The loose containment the library resolver uses. */
const loose = (key: string, token: string) => key.includes(token);

/** Build a resolver over plain string values, so assertions read as names. */
const resolver = (
  entries: { names: string[]; value: string }[],
  distinctiveOneWordNames = false,
) => buildNameResolver(entries, loose, distinctiveOneWordNames);

describe("buildNameResolver — exact and near matches", () => {
  const r = resolver([
    { names: ["Vegetable Poha"], value: "veg-poha" },
    { names: ["Chicken and Vegetable Poha"], value: "chicken-poha" },
    { names: ["Besan Chilla"], value: "besan-chilla" },
  ]);

  it("matches an exact title", () => {
    expect(r("Vegetable Poha")).toBe("veg-poha");
  });

  it("prefers the CLOSEST title, not merely a matching one", () => {
    // "Vegetable poha" must not open the chicken recipe just because that
    // title also contains both words.
    expect(r("Vegetable poha")).toBe("veg-poha");
  });

  it("matches '<recipe> with <sides>' — the dish IS that recipe plus additions", () => {
    expect(r("Besan chilla with onion + capsicum")).toBe("besan-chilla");
  });
});

describe("buildNameResolver — the miss-AND-extra rejection", () => {
  it("refuses a dish that names a DIFFERENT headline ingredient", () => {
    // "Tofu and spinach curry" vs "Tofu Vegetable Curry": misses "vegetable"
    // AND adds "spinach" → a different dish, not a portion variation.
    const r = resolver([{ names: ["Tofu Vegetable Curry"], value: "tofu-veg" }]);
    expect(r("Tofu and spinach curry")).toBeUndefined();
  });

  it("still matches when the dish only DROPS a lead descriptor", () => {
    // miss, no extra → "Cilantro Mint Chutney" is what "mint chutney" means.
    const r = resolver([{ names: ["Cilantro Mint Chutney"], value: "chutney" }]);
    expect(r("Mint chutney")).toBe("chutney");
  });

  it("still matches when the dish only ADDS a side", () => {
    const r = resolver([{ names: ["Moong Dal Chilla"], value: "chilla" }]);
    expect(r("Moong dal chilla with curd")).toBe("chilla");
  });
});

describe("buildNameResolver — the earliest-title tie-break", () => {
  it("resolves to the HEAD dish, not a trailing medium", () => {
    // "Ragi-oats porridge in almond milk" → Ragi porridge, not Almond Milk.
    const r = resolver([
      { names: ["Almond Milk"], value: "almond-milk" },
      { names: ["Ragi Porridge"], value: "ragi-porridge" },
    ]);
    expect(r("Ragi-oats porridge in almond milk")).toBe("ragi-porridge");
  });
});

describe("buildNameResolver — only the PRIMARY component may claim the slot", () => {
  it("does not let a trailing side hijack the slot", () => {
    // Nazneen's evening snack: "Sabja seeds drink … + Masala Roasted Chana"
    // opened the CHANA method because no sabja recipe existed. With no recipe
    // for the primary component, the honest answer is none.
    const r = resolver([{ names: ["Masala Roasted Chana"], value: "chana" }]);
    expect(r("Sabja seeds drink (1 glass) + Masala Roasted Chana (2 tbsp)")).toBeUndefined();
  });

  it("resolves from the primary component when that one DOES have a recipe", () => {
    const r = resolver([{ names: ["Masala Roasted Chana"], value: "chana" }]);
    expect(r("Masala Roasted Chana (2 tbsp) + a cup of tea")).toBe("chana");
  });
});

describe("buildNameResolver — one-word names", () => {
  it("refuses a weak one-word name by default", () => {
    // "Fresh Ginger Tea" reduces to ["ginger"]; letting that claim a slot
    // would hand "Ginger garlic paste" a cup of tea.
    const r = resolver([{ names: ["Ginger"], value: "ginger-tea" }]);
    expect(r("Ginger garlic paste")).toBeUndefined();
  });

  it("matches a one-word title against a one-word dish", () => {
    const r = resolver([{ names: ["Kachumber"], value: "kachumber" }]);
    expect(r("Kachumber")).toBe("kachumber");
  });
});

describe("buildNameResolver — the distinctive-one-word last resort", () => {
  // `chaas` names exactly one entry (df === 1), so reading it identifies.
  //
  // NOTE the alias list: recipeLibKey strips "(Buttermilk)" as a portion
  // annotation, so the display name alone does NOT answer to "buttermilk" —
  // the real catalogue entry carries it as an alias, and corroboration depends
  // on that. A fixture without it fails for the wrong reason.
  const entries = [
    { names: ["Spiced Lassi (Buttermilk)", "buttermilk", "chaas"], value: "spiced-lassi" },
    { names: ["Ginger Tea", "ginger"], value: "ginger-tea" },
  ];

  it("is OFF unless the caller opts in", () => {
    expect(resolver(entries, false)("Spiced buttermilk / chaas")).toBeUndefined();
  });

  it("accepts a distinctive word when the REST of the dish corroborates", () => {
    expect(resolver(entries, true)("Spiced buttermilk / chaas")).toBe("spiced-lassi");
  });

  it("refuses a distinctive word inside a dish that is plainly something else", () => {
    // "Oats porridge with figs" is not the soaked-figs remedy — `oats` and
    // `porridge` are not words that entry answers to, and they sink it.
    const withFigs = [...entries, { names: ["Soaked Figs", "figs"], value: "figs" }];
    expect(resolver(withFigs, true)("Oats porridge with figs")).toBeUndefined();
  });

  it("refuses a word shared by more than one entry, however suggestive", () => {
    // Isolates df from corroboration: the dish corroborates FULLY against
    // either entry, so the only thing that can reject it is "zest" naming two
    // entries rather than one.
    const shared = [
      { names: ["Alpha Brew", "zest"], value: "alpha" },
      { names: ["Beta Brew", "zest"], value: "beta" },
    ];
    expect(resolver(shared, true)("zest brew")).toBeUndefined();
    // …and the SAME dish resolves once the word belongs to one entry only.
    expect(resolver([shared[0]], true)("zest brew")).toBe("alpha");
  });

  it("never re-decides a slot that already resolved", () => {
    // The last resort runs only when nothing above matched — an exact alias
    // still wins outright.
    expect(resolver(entries, true)("Ginger Tea")).toBe("ginger-tea");
    expect(resolver(entries, true)("chaas")).toBe("spiced-lassi");
  });
});

describe("buildNameResolver — degenerate input", () => {
  it("returns undefined rather than throwing", () => {
    const r = resolver([{ names: ["Poha"], value: "poha" }]);
    for (const dish of ["", "   ", "+++", "(1 bowl)"]) {
      expect(r(dish), JSON.stringify(dish)).toBeUndefined();
    }
  });

  it("copes with an empty candidate list", () => {
    expect(resolver([])("Poha")).toBeUndefined();
  });

  it("ignores a candidate with no usable names", () => {
    const r = resolver([{ names: ["", "  "], value: "junk" }, { names: ["Poha"], value: "poha" }]);
    expect(r("Poha")).toBe("poha");
  });
});

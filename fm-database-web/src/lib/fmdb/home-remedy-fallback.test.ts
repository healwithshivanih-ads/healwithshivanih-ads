/**
 * The home-remedy fallback: a menu slot that names a REMEDY used to open to
 * nothing, because the dish→method resolver only ever read `_recipes/`.
 *
 * Measured 2026-07-26 across the 13 published plans carrying a menu: 326 of
 * 854 slots resolved to no method, and the biggest single cluster was the
 * CCF tea — 20 slots across three different casings — whose full preparation
 * has been sitting in `home_remedies/cumin-coriander-fennel-tea.yaml` all
 * along. These tests pin the four rules that fallback has to obey:
 * remedies fill a gap and never take a recipe's slot, casing never matters,
 * matching is word-boundary (not substring), and a remedy's CAUTIONS travel
 * with its method or the method does not ship.
 */
import { describe, it, expect } from "vitest";
import {
  buildDishRecipeResolver,
  buildHomeRemedyResolver,
  buildLibraryRecipeResolver,
  loadRemedyFallbackLibrary,
  homeRemedyAsRecipe,
  isMealMethodRemedy,
  type AppRemedy,
  type LetterRecipe,
} from "./client-app";

/** The three casings of the same tea, exactly as they appear on live menus. */
const CCF_DISHES = [
  "Cumin-coriander-fennel tea (1 cup)",
  "Cumin-Coriander-Fennel Tea (1 cup)",
  "Cumin-Coriander-Fennel tea (1 cup)",
];
const CCF_REMEDY = "CCF Tea (Cumin-Coriander-Fennel Infusion)";

const remedy = (over: Partial<AppRemedy> & { slug: string; name: string }): AppRemedy => ({
  also: "",
  aliases: [],
  category: "kitchen_remedy",
  route: "internal",
  icon: "bowl",
  summary: "",
  prepSteps: ["Steep it.", "Sip it warm."],
  dose: "1 cup",
  duration: "",
  timing: "",
  cautions: [],
  indications: [],
  bal: [],
  agg: [],
  virya: null,
  stub: false,
  suitableSex: "any",
  suitableStages: [],
  avoidIn: [],
  ...over,
});

describe("a menu slot that names a home remedy gets that remedy's method", () => {
  it("resolves the CCF tea in all three casings the coach has typed", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    for (const dish of CCF_DISHES) {
      expect(resolve(dish)?.title, dish).toBe(CCF_REMEDY);
      expect(resolve(dish)!.method.length, dish).toBeGreaterThan(1);
    }
  });

  it("carries the remedy's dose, timing and CAUTIONS into the method", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    const method = resolve(CCF_DISHES[0])!.method.join(" \n ");
    expect(method).toMatch(/simmer/i);           // the preparation itself
    expect(method).toMatch(/How much:/);         // typical_dose, folded in
    expect(method).toMatch(/When:/);             // timing_notes, folded in
    // The catalogue's contraindications — the one thing a recipe does not
    // carry, and the reason showing nothing would beat showing a bare method.
    expect(method).toMatch(/Take care/);
    expect(method).toMatch(/biliary colic/i);
    expect(method).toMatch(/reflux/i);
  });

  it("never drops a caution: a remedy with cautions always ends on one", () => {
    const r = remedy({
      slug: "test-tonic",
      name: "Test Tonic",
      cautions: ["pregnancy", "on blood thinners"],
      avoidIn: ["pregnancy"],
    });
    const steps = homeRemedyAsRecipe(r).method;
    expect(steps[steps.length - 1]).toMatch(/Take care/);
    expect(steps[steps.length - 1]).toContain("on blood thinners");
    // "pregnancy" is in BOTH contraindications and avoid_in — said once.
    expect(steps[steps.length - 1].match(/pregnancy/g)).toHaveLength(1);
  });
});

describe("remedies only ever fill a gap", () => {
  /** The real chain the client app runs, over a chosen library + pack. */
  const chain = async (
    library: { slug: string; recipe: LetterRecipe }[],
    packRecipes: LetterRecipe[] = [],
  ) =>
    buildDishRecipeResolver({
      fromLibrary: buildLibraryRecipeResolver(library),
      packRecipes,
      fromRemedy: buildHomeRemedyResolver(await loadRemedyFallbackLibrary()),
    });

  const CCF_LIBRARY_RECIPE: LetterRecipe = {
    title: "Cumin-Coriander-Fennel Tea",
    ingredients: ["1/2 tsp cumin seeds", "1/2 tsp coriander seeds", "1/2 tsp fennel seeds"],
    method: ["Simmer the seeds in 4 cups water.", "Strain and sip."],
  };

  it("a real recipe of the same name wins — the remedy never gets asked", async () => {
    const resolve = await chain([{ slug: "ccf-tea", recipe: CCF_LIBRARY_RECIPE }]);
    for (const dish of CCF_DISHES)
      expect(resolve(dish)?.title, dish).toBe("Cumin-Coriander-Fennel Tea");
  });

  it("a pack recipe also wins — the remedy is the LAST source, not the second", async () => {
    const resolve = await chain([], [CCF_LIBRARY_RECIPE]);
    for (const dish of CCF_DISHES)
      expect(resolve(dish)?.title, dish).toBe("Cumin-Coriander-Fennel Tea");
  });

  it("with no recipe anywhere, the chain reaches the remedy", async () => {
    const resolve = await chain([], []);
    for (const dish of CCF_DISHES) expect(resolve(dish)?.title, dish).toBe(CCF_REMEDY);
  });

  it("a plain food resolves to nothing — no remedy is stretched to cover it", async () => {
    const resolve = await chain([], []);
    for (const dish of ["Kiwi (1)", "Boiled eggs (2)", "Tea with milk (1 cup)"])
      expect(resolve(dish), dish).toBeUndefined();
  });
});

/**
 * The one-word-name rule. A remedy's words are spread across its display name,
 * its slug and its aliases, so a dish can name it unmistakably and still not
 * line up with any ONE of those names — "Spiced buttermilk / chaas" is the
 * Spiced Lassi (Buttermilk) remedy, whose alias is literally `chaas`, yet
 * `spiced` lives only in the display name and `chaas` only in the aliases.
 *
 * The word count is not what makes a match safe; how far the word narrows the
 * catalogue is. These pin both halves of that: the anchor word must belong to
 * exactly ONE entry, and the rest of the dish must corroborate rather than
 * contradict. Break either and a client gets someone else's drink.
 */
describe("a one-word name counts only when it identifies exactly one remedy", () => {
  const CHAAS = "Spiced Lassi (Buttermilk) for Digestion";

  it("resolves the buttermilk/chaas dish that no single name matched", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    // The live menu strings — 6 published slots across Shruti's plan.
    expect(resolve("Spiced buttermilk / chaas (1 glass)")?.title).toBe(CHAAS);
    expect(resolve("Spiced buttermilk / chaas (1 glass) + roasted makhana (1 small bowl)")?.title)
      .toBe(CHAAS);
    // and it carries a real method, not an empty shell
    expect(resolve("Spiced buttermilk / chaas (1 glass)")!.method.length).toBeGreaterThan(1);
  });

  it("does NOT hand a ginger dish a ginger remedy — 'ginger' names 18 entries", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    // "Fresh Ginger Tea (Adrak Chai)" reduces to the single word ["ginger"].
    // Accepting a one-word name on word-count alone would serve tea here.
    const paste = resolve("Ginger garlic paste (1 tsp)");
    expect(paste).toBeUndefined();
    expect(resolve("Ginger garlic paste (1 tsp) + jowar roti (2)")).toBeUndefined();
  });

  it("refuses the plain foods a distinctive word could otherwise drag in", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    // Each of these shares one word with a real remedy whose name is LONGER —
    // a fragment, never a whole name. Serving them would tell a client to
    // juice her papaya with sugar, or drink bone broth for her BBQ chicken.
    for (const dish of [
      "Kiwi (1)",
      "Fresh papaya (1 cup)",
      "Orange (1 medium) + almonds (10)",
      "Fruit (1 medium) + roasted makhana (1/2 cup)",
      "Pumpkin seeds (1 tbsp) + walnuts (5 halves)",
      "Tender coconut water (1 glass)",
      "BBQ chicken (small portion, ~80g) + brown rice (1 small bowl)",
      "Moong dal (1 cup) + Everyday Basmati Rice (1/2 cup)",
    ])
      expect(resolve(dish), dish).toBeUndefined();
  });

  it("needs the REST of the dish to corroborate, not just the one word", () => {
    const lib = [
      remedy({ slug: "soaked-figs", name: "Soaked figs", aliases: ["anjeer"] }),
      remedy({ slug: "jeera-water", name: "Jeera water" }),
    ];
    const resolve = buildHomeRemedyResolver(lib);
    // "figs" identifies exactly one remedy here — but the dish is a porridge.
    // Its other words are evidence AGAINST, and must sink the match.
    expect(resolve("Oats porridge with figs (1 bowl)")).toBeUndefined();
    expect(resolve("Anjeer walnut smoothie (1 glass)")).toBeUndefined();
    // the same word with nothing contradicting it does resolve
    expect(resolve("Soaked figs (2)")?.title).toBe("Soaked figs");
    expect(resolve("Anjeer (2)")?.title).toBe("Soaked figs");
  });

  it("drops the one-word name as soon as a second remedy answers to it", () => {
    const shared = { aliases: ["chaas"] };
    const alone = [remedy({ slug: "spiced-lassi", name: "Spiced Lassi for Digestion", ...shared })];
    // one owner → "chaas" identifies it, and the dish resolves
    expect(buildHomeRemedyResolver(alone)("Spiced chaas (1 glass)")?.title).toBe(
      "Spiced Lassi for Digestion",
    );
    // a second owner → the word no longer names anything in particular, so
    // there is no honest way to choose and the slot stays blank.
    const contested = [
      ...alone,
      remedy({ slug: "cooling-yogurt-tonic", name: "Cooling Yogurt Tonic", ...shared }),
    ];
    expect(buildHomeRemedyResolver(contested)("Spiced chaas (1 glass)")).toBeUndefined();
  });

  it("never overrides a match the ordinary rules already made", async () => {
    const resolve = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());
    // CCF tea resolves on its names alone; the one-word rule runs only after
    // everything above it has missed, so it cannot re-point an answered slot.
    for (const dish of CCF_DISHES) expect(resolve(dish)?.title, dish).toBe(CCF_REMEDY);

    // Head-to-head, because that is what makes the rule safe to add at all:
    // "Golden latte" wins the dish on its name, even though the cooler's
    // one-word `chaas` would otherwise cover it. A last-resort rule that
    // outranked a real name match could re-point slots that already work.
    const both = [
      remedy({ slug: "golden-latte", name: "Golden latte" }),
      remedy({ slug: "buttermilk-cooler", name: "Buttermilk Cooler", aliases: ["chaas", "golden", "latte"] }),
    ];
    expect(buildHomeRemedyResolver(both)("Golden chaas latte (1 glass)")?.title).toBe("Golden latte");
  });
});

describe("matching is word-boundary, not substring", () => {
  const lib = [
    remedy({ slug: "methi-ajwain-water", name: "Methi ajwain water" }),
    remedy({ slug: "dates-in-ghee", name: "Dates in ghee" }),
  ];

  it("finds the remedy the dish actually names", () => {
    const resolve = buildHomeRemedyResolver(lib);
    expect(resolve("Methi ajwain water (1 glass)")?.title).toBe("Methi ajwain water");
    expect(resolve("Dates in ghee (2)")?.title).toBe("Dates in ghee");
  });

  it("does NOT find 'methi' inside 'methionine'", () => {
    const resolve = buildHomeRemedyResolver(lib);
    // Adversarial on purpose. The two OTHER words match exactly, so the
    // consistency gate is satisfied and containment is the only thing left
    // deciding — under a raw-substring rule this resolves, wrongly, to the
    // methi water. (A dish sharing no other word is refused twice over.)
    expect(resolve("Methionine ajwain water (1 glass)")).toBeUndefined();
    expect(resolve("Methionine water (1 cup)")).toBeUndefined();
  });
});

describe("only remedies you can eat", () => {
  it("excludes external routes — a massage is not a breakfast method", async () => {
    expect(
      isMealMethodRemedy(remedy({ slug: "abhyanga", name: "Abhyanga", route: "external" })),
    ).toBe(false);
    const fallback = await loadRemedyFallbackLibrary();
    expect(fallback.length).toBeGreaterThan(100);
    expect(fallback.some((r) => r.route === "external")).toBe(false);
    // and nothing in the catalogue's external half can be reached by a dish
    expect(buildHomeRemedyResolver(fallback)("Abhyanga (warm oil massage)")).toBeUndefined();
  });

  it("excludes stubs — a remedy with no preparation has no method to give", () => {
    expect(isMealMethodRemedy(remedy({ slug: "s", name: "S", stub: true }))).toBe(false);
    expect(isMealMethodRemedy(remedy({ slug: "s", name: "S", prepSteps: [] }))).toBe(false);
  });
});

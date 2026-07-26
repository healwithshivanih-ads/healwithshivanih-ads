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

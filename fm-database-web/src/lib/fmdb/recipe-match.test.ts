/**
 * The dish → recipe resolver, at the seam where a wrong answer reaches a
 * client's phone.
 *
 * Reported 2026-07-24 (Nazneen, evening snack): the slot read "Sabja seeds
 * drink (…) + Masala Roasted Chana (2 tbsp)" and tapping it opened the ROASTED
 * CHANA method. No sabja recipe existed in the library at the time, so the
 * resolver walked past the primary component and let the trailing snack supply
 * the slot's recipe. These tests pin the rule that replaced that walk: the
 * recipe comes from the dish's primary component or from nowhere.
 */
import { describe, it, expect } from "vitest";
import {
  buildLibraryRecipeResolver,
  loadLibraryRecipes,
  matchPackRecipe,
  recipeConsistentWithDish,
} from "./client-app";
import { primaryDishPart } from "./dish-components";

const NAZNEEN =
  "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked) + Masala Roasted Chana (2 tbsp)";

const r = (title: string, ingredients: string[], mains: string[] = []) => ({
  slug: title.toLowerCase().replace(/\s+/g, "-"),
  recipe: { title, ingredients, mains, method: ["Mix.", "Serve."] },
});

// A library shaped like the real one on the day of the report: the trailing
// snack has a recipe, the drink that leads the slot does not.
const LIB_NO_SABJA = [
  r("Masala Roasted Chana", ["1 cup roasted chana", "1 tsp chaat masala"], ["chana"]),
  r("Jowar roti", ["1 cup jowar flour", "water"], ["jowar"]),
  r("Vegetable poha", ["1 cup poha", "onion", "peas"], ["poha"]),
];
const LIB_WITH_SABJA = [...LIB_NO_SABJA, r("Sabja Seed Water", ["1 tsp sabja seeds", "1 glass water"], ["sabja"])];

describe("a trailing side never supplies the slot's recipe", () => {
  it("does NOT serve the roasted chana for a sabja-led slot", () => {
    const resolve = buildLibraryRecipeResolver(LIB_NO_SABJA);
    expect(resolve(NAZNEEN)?.title).toBeUndefined();
  });

  it("the AI-pack fallback does not serve it either", () => {
    // matchPackRecipe does no splitting of its own, so it must be handed the
    // primary component — otherwise it re-introduces the same hijack.
    const pack = LIB_NO_SABJA.map((l) => l.recipe);
    expect(matchPackRecipe(primaryDishPart(NAZNEEN), pack)?.title).toBeUndefined();
    // …whereas the whole cell is exactly what used to leak the chana through.
    expect(matchPackRecipe(NAZNEEN, pack)?.title).toBe("Masala Roasted Chana");
  });

  it("serves the drink once its recipe exists under the name the coach used", () => {
    const resolve = buildLibraryRecipeResolver(LIB_WITH_SABJA);
    expect(
      resolve("Sabja Seed Water (1 glass, 1 tsp seeds soaked) + Masala Roasted Chana (2 tbsp)")
        ?.title,
    ).toBe("Sabja Seed Water");
  });

  it("still matches a primary written as '<recipe> with <additions>'", () => {
    const resolve = buildLibraryRecipeResolver(LIB_NO_SABJA);
    expect(resolve("Vegetable poha with peanuts (1 bowl) + curd (½ cup)")?.title).toBe(
      "Vegetable poha",
    );
  });

  it("gates the recipe against the PRIMARY component, not the whole cell", () => {
    // Against the whole cell any component's food satisfies the gate, so a
    // wrong recipe sails through; against the primary it is caught.
    const chana = LIB_NO_SABJA[0].recipe;
    expect(recipeConsistentWithDish(NAZNEEN, chana)).toBe(true);
    expect(recipeConsistentWithDish(primaryDishPart(NAZNEEN), chana)).toBe(false);
  });
});

describe("against the real recipe library", () => {
  it("never resolves the reported dish to the roasted chana", async () => {
    const lib = await loadLibraryRecipes();
    expect(lib.length).toBeGreaterThan(100); // guard: a mis-set path must fail, not pass vacuously
    const resolve = buildLibraryRecipeResolver(lib);
    const got = resolve(NAZNEEN);
    expect(got?.title ?? "(none)").not.toMatch(/chana/i);
    // The library entry is titled "Sabja Seed Water"; the plan text said
    // "Sabja seeds drink". drink ≠ water is a real difference the token
    // matcher must not paper over — so no recipe is the correct answer, and
    // strictly better than the chana it used to serve.
    const sabja = lib.find((l) => /sabja/i.test(l.recipe.title));
    if (sabja) {
      expect(
        resolve(`${sabja.recipe.title} (1 glass) + Masala Roasted Chana (2 tbsp)`)?.title,
      ).toBe(sabja.recipe.title);
    }
  });
});

/**
 * Short food words are load-bearing. "dal" and "egg" are 3 letters, and the
 * token filter's old >3 cutoff deleted them — collapsing 22 catalogue titles
 * ("Toor dal", "Egg bhurji", "Moong dal", …) to a single token, below the
 * 2-token floor every fuzzy rule needs. Reported 2026-07-30 (cl-005): every
 * drafter-embellished dal/egg cell ("Toor dal with turmeric and black
 * pepper") fell through to a paid AI recipe the catalogue already answered.
 * The fix widens to 3-letter words ONLY when a name would otherwise fall
 * below two tokens, so names with two strong tokens keep their old
 * tokenisation bit-for-bit (corpus diff over all live menus: 9 heads gained
 * a recipe, none moved).
 */
describe("short-word titles (dal, egg) stay matchable", () => {
  it("serves '<recipe> with <spices>' for a two-word title with a 3-letter word", async () => {
    const lib = await loadLibraryRecipes();
    const resolve = buildLibraryRecipeResolver(lib);
    // The reported cells, verbatim from cl-005's published menu.
    expect(resolve("Toor dal with turmeric and black pepper (1 bowl)")?.title).toBe("Toor dal");
    expect(
      resolve(
        "Egg bhurji with onion, cauliflower and beans (2 eggs, vegetables 1 small bowl)",
      )?.title,
    ).toMatch(/egg bhurji/i);
  });

  it("a different dal is still a different dish", () => {
    const resolve = buildLibraryRecipeResolver([
      r("Toor dal", ["1 cup toor dal", "turmeric"], ["toor dal"]),
      r("Palak dal", ["1 cup toor dal", "palak"], ["palak"]),
    ]);
    // "Moong dal khichdi" names neither recipe — matching either would serve
    // the wrong method. The 2-token floor must not loosen the identity rules.
    expect(resolve("Moong dal khichdi (1 bowl)")?.title).toBeUndefined();
  });
});

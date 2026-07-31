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
  buildDishRecipeResolver,
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
    // The whole cell used to leak the chana through here too (its title-token
    // score alone picked "Masala Roasted Chana", and the old any-one-food gate
    // didn't stop it because "chana" is a real food in the cell — just not the
    // PRIMARY one). The now-stricter every-headline-food gate closes that leak
    // as a second line of defense — the chana recipe has no "sabja"/"seeds"/
    // "drink" either — but the primary component is still what production code
    // must always pass; this call only stays safe by accident of what the two
    // dishes happen to share.
    expect(matchPackRecipe(NAZNEEN, pack)?.title).toBeUndefined();
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
    // The gate requires every headline food it is asked about, so scanning the
    // untouched whole cell no longer even coincidentally passes here — "chana"
    // is covered but "sabja"/"seeds"/"drink" are not, so both calls are caught.
    // Production code still must pass the PRIMARY component, never the whole
    // cell: the gate answers "does this recipe cover what it's asked about",
    // not "which component is the dish's own identity" — that half of the
    // Nazneen fix lives in primaryDishPart/buildNameResolver, pinned end to end
    // by the resolver tests above (a sabja-led slot never opens the chana
    // method, with or without a recipe on file for sabja).
    const chana = LIB_NO_SABJA[0].recipe;
    expect(recipeConsistentWithDish(NAZNEEN, chana)).toBe(false);
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

/**
 * A recipe that is missing one of the dish's named ingredients is not a match,
 * even when the "<recipe> with <extras>" rule (buildNameResolver) happily
 * names it. Reported 2026-07-31 (cl-005, breakfast): the menu read "Soft
 * scrambled eggs with spinach and ghee" and the app opened the catalogue's
 * plain "Scrambled eggs" — no spinach anywhere — because the old gate only
 * required ONE of the dish's headline foods to be present, and "eggs" alone
 * was enough; "spinach" was never checked. The client's own AI-authored recipe
 * for this exact dish, which does have spinach, never got a look-in.
 */
describe("a recipe missing a named ingredient is not a match", () => {
  const dish = "Soft scrambled eggs with spinach and ghee (2 eggs)";
  const plainEggs = r("Scrambled eggs", ["3 eggs, beaten", "1 tsp ghee", "salt", "pepper"]);
  const withSpinach = r("Scrambled Eggs with Spinach and Ghee", [
    "2 eggs",
    "Spinach (palak), chopped: 75g",
    "Ghee: 1 tsp",
    "Salt to taste",
  ]).recipe;

  it("the library resolver still finds the plain recipe by name", () => {
    const resolve = buildLibraryRecipeResolver([plainEggs]);
    expect(resolve(dish)?.title).toBe("Scrambled eggs");
  });

  it("but the consistency gate refuses it — it has no spinach", () => {
    expect(recipeConsistentWithDish(primaryDishPart(dish), plainEggs.recipe)).toBe(false);
  });

  it("the pack recipe that actually has spinach passes the gate", () => {
    expect(recipeConsistentWithDish(primaryDishPart(dish), withSpinach)).toBe(true);
  });

  it("end to end: the resolver falls through to the client's own recipe", () => {
    const resolve = buildDishRecipeResolver({
      fromLibrary: buildLibraryRecipeResolver([plainEggs]),
      packRecipes: [withSpinach],
      fromRemedy: () => undefined,
    });
    expect(resolve(dish)?.title).toBe("Scrambled Eggs with Spinach and Ghee");
  });
});

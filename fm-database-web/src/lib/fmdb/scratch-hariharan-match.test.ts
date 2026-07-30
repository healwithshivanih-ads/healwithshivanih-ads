// TEMP diagnostic — delete after run.
import { describe, it } from "vitest";
import {
  buildLibraryRecipeResolver,
  loadLibraryRecipes,
  recipeConsistentWithDish,
  loadPackRecipes,
  matchPackRecipe,
} from "./client-app";
import { primaryDishPart } from "./dish-components";

const DISHES = [
  "Cooked apple with nutmeg and ghee (1 medium apple) + sesame seeds (1 tbsp)",
  "Egg bhurji with onion, cauliflower and beans (2 eggs, vegetables 1 small bowl) + soaked peeled almonds (8)",
  "3-Egg Bhurji (Onion, Cauliflower, Beans) (2 eggs + vegetables 1 small bowl) + soft jowar roti with ghee (1)",
  "Kodo millet cooked soft (1 cup) + Toor dal with hing and turmeric (1 bowl)",
  "Kodo millet cooked soft with ghee (1 cup) + Toor dal with turmeric and ginger (1 bowl)",
  "Toor dal with turmeric and black pepper (1 bowl) + palak sabzi with ghee (1 cup)",
];

describe("diagnose Hariharan AI-recipe flags", () => {
  it("shows resolver outcomes", async () => {
    const library = await loadLibraryRecipes();
    const resolver = buildLibraryRecipeResolver(library);
    let pack: Awaited<ReturnType<typeof loadPackRecipes>> = [];
    try {
      pack = await loadPackRecipes("cl-005", "hariharan-plan-5-2026-06-10-cl-005");
    } catch { /* ignore */ }
    for (const dish of DISHES) {
      const head = primaryDishPart(dish);
      const lib = resolver(head);
      const consistent = lib ? recipeConsistentWithDish(head, lib) : null;
      const ai = pack.length ? matchPackRecipe(head, pack) : null;
      console.log(JSON.stringify({
        head,
        libTitle: lib?.title ?? null,
        consistent,
        packTitle: ai?.title ?? null,
      }));
    }
    console.log("pack size:", pack.length);
  });
});

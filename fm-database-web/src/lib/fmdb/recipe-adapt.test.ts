/**
 * Cooking a catalogue recipe WITHOUT the food a client avoids.
 *
 * The rule this suite exists to defend: adaptation may only ever turn a HIDDEN
 * recipe into a correctly adapted one. It must never emit a method that still
 * names the avoided food, and it must never quietly mangle a sentence. When the
 * scrubber is unsure it returns null and the recipe stays hidden — which is the
 * behaviour we already had, so failing closed costs nothing.
 *
 * The last block is the one that matters most: it sweeps the WHOLE library for
 * a Jain client who avoids onion and garlic and asserts every adaptation is
 * clean. A unit test proves the shapes I thought of; the sweep proves the ones
 * I did not.
 */
import { describe, it, expect } from "vitest";
import { adaptRecipeForAvoids, omittedPhrase, type AdaptableRecipe } from "./recipe-adapt";
import { loadLibraryRecipes } from "./client-app";

const ALLIUM = ["onion", "garlic"];

const r = (over: Partial<AdaptableRecipe> = {}): AdaptableRecipe => ({
  title: "Foxtail millet pulao",
  mains: ["foxtail millet", "mixed vegetables"],
  ingredients: ["1 cup foxtail millet", "1 piece onion, sliced", "1 tsp ginger-garlic paste", "1 tsp salt"],
  method: [
    "Rinse the millet and drain it well.",
    "Add the onion and brown lightly, then the ginger-garlic paste.",
    "Pour in the water with the salt, cover, and cook on low 15 minutes.",
  ],
  ...over,
});

describe("adaptRecipeForAvoids", () => {
  it("takes the ingredient out of every surface", () => {
    const out = adaptRecipeForAvoids(r(), ALLIUM);
    expect(out).not.toBeNull();
    expect(out!.omitted.sort()).toEqual(["garlic", "onion"]);
    expect(out!.recipe.ingredients).toEqual(["1 cup foxtail millet", "1 tsp salt"]);
    for (const line of [...out!.recipe.ingredients, ...out!.recipe.method])
      expect(line.toLowerCase(), line).not.toMatch(/onion|garlic/);
  });

  it("drops a clause that exists only to cook the omitted food", () => {
    const out = adaptRecipeForAvoids(r(), ALLIUM)!;
    // "Add the onion and brown lightly, then the ginger-garlic paste." had
    // nothing else in it — the whole step goes rather than leaving a stub.
    expect(out.recipe.method).toEqual([
      "Rinse the millet and drain it well.",
      "Pour in the water with the salt, cover, and cook on low 15 minutes.",
    ]);
  });

  it("removes the term from an enumeration and keeps the rest of the step", () => {
    const out = adaptRecipeForAvoids(
      r({
        ingredients: ["1 cup millet", "1 piece onion, chopped", "1 tsp ginger"],
        method: ["Add the onion, ginger and green chilli, then the vegetables, and cook 3 minutes."],
      }),
      ALLIUM,
    )!;
    expect(out.recipe.method[0]).toBe(
      "Add the ginger and green chilli, then the vegetables, and cook 3 minutes.",
    );
  });

  it("handles an 'and' pair without leaving a dangling connective", () => {
    const out = adaptRecipeForAvoids(
      r({
        ingredients: ["1 cup dal", "2 clove garlic", "1 tsp jeera"],
        method: ["Crackle the jeera, add the garlic and green chilli."],
      }),
      ALLIUM,
    )!;
    expect(out.recipe.method[0]).toBe("Crackle the jeera, add the green chilli.");
  });

  it("refuses when the dish IS the avoided food", () => {
    expect(
      adaptRecipeForAvoids(
        r({ title: "3-Egg Omelette (Onion & Cabbage)", ingredients: ["3 eggs", "1 onion"] }),
        ALLIUM,
      ),
    ).toBeNull();
  });

  it("notices a food the METHOD names even when the ingredient list does not", () => {
    // A garnish written only into the steps. Terms are collected from every
    // surface, so the client is still TOLD about it — but "…lime wedges and
    // sliced onion rings" is not a clean list deletion (removing it strands
    // "wedges rings"), so the step itself is left as the recipe wrote it.
    const out = adaptRecipeForAvoids(
      r({
        ingredients: ["1 cup millet", "1 tsp salt"],
        method: ["Cook the millet.", "Serve with lime wedges and sliced onion rings."],
      }),
      ALLIUM,
    )!;
    expect(out.omitted).toContain("onion");
    expect(out.stepsStillMention).toBe(true);
    expect(out.recipe.method[1]).toBe("Serve with lime wedges and sliced onion rings.");
  });

  it("refuses when the recipe names the food nowhere at all", () => {
    expect(
      adaptRecipeForAvoids(
        r({ ingredients: ["1 cup millet", "1 tsp salt"], method: ["Cook the millet."] }),
        ALLIUM,
      ),
    ).toBeNull();
  });

  it("refuses when removing it would leave no ingredients or no method", () => {
    expect(adaptRecipeForAvoids(r({ ingredients: ["2 onions"] }), ALLIUM)).toBeNull();
    expect(
      adaptRecipeForAvoids(
        r({ ingredients: ["1 cup millet", "1 onion"], method: ["Fry the onion until golden."] }),
        ALLIUM,
      ),
    ).toBeNull();
  });

  it("is a no-op when the client avoids nothing", () => {
    expect(adaptRecipeForAvoids(r(), [])).toBeNull();
  });

  it("never touches a recipe that does not name the food", () => {
    const clean = r({ ingredients: ["1 cup millet", "1 tsp salt"], method: ["Cook the millet."] });
    expect(adaptRecipeForAvoids(clean, ALLIUM)).toBeNull();
  });

  it("reads plurals", () => {
    const out = adaptRecipeForAvoids(
      r({ ingredients: ["1 cup rice", "2 onions, sliced", "1 tsp salt"], method: ["Soak the rice."] }),
      ALLIUM,
    )!;
    expect(out.recipe.ingredients).toEqual(["1 cup rice", "1 tsp salt"]);
  });

  it("leaves a step VERBATIM when the removal is not a clean list deletion", () => {
    // "Fry the onions, then add the rice" is not an enumeration — deleting the
    // word out of it produced nonsense in three earlier drafts. The step stays
    // as written and the client is told to leave the onion out.
    const out = adaptRecipeForAvoids(
      r({
        ingredients: ["1 cup rice", "2 onions, sliced", "1 tsp salt"],
        method: ["Soak the rice.", "Fry the onions, then add the rice."],
      }),
      ALLIUM,
    )!;
    expect(out.recipe.method).toEqual(["Soak the rice.", "Fry the onions, then add the rice."]);
    expect(out.stepsStillMention).toBe(true);
    // …but the ingredient list — the surface the gate reads — is clean.
    for (const i of out.recipe.ingredients) expect(i).not.toMatch(/onion/i);
  });

  it("says so when nothing was left mentioning the food", () => {
    const out = adaptRecipeForAvoids(r(), ALLIUM)!;
    expect(out.stepsStillMention).toBe(false);
  });
});

describe("omittedPhrase", () => {
  it("reads as a sentence", () => {
    expect(omittedPhrase(["onion"])).toBe("onion");
    expect(omittedPhrase(["onion", "garlic"])).toBe("onion and garlic");
    expect(omittedPhrase(["onion", "garlic", "potato"])).toBe("onion, garlic and potato");
  });
});

describe("the whole library, adapted for a Jain client", () => {
  it("emits clean prose or nothing at all", async () => {
    const lib = await loadLibraryRecipes();
    expect(lib.length).toBeGreaterThan(400); // sanity: catalogue actually read
    const JAIN = ["onion", "garlic", "potato", "beetroot", "radish", "shallot", "leek"];

    let adapted = 0;
    const bad: string[] = [];
    for (const { slug, recipe } of lib) {
      const out = adaptRecipeForAvoids(recipe, JAIN);
      if (!out) continue;
      adapted++;
      // 1. the INGREDIENT LIST — the surface the gate reads — is always clean
      for (const line of out.recipe.ingredients)
        for (const t of JAIN)
          if (new RegExp(`\\b${t}(?:e?s)?\\b`, "i").test(line))
            bad.push(`${slug}: "${t}" survives in ingredients → ${line}`);
      // 2. every REWRITTEN step is clean prose (steps kept verbatim are the
      //    recipe's own words and are not this module's to judge)
      for (const line of out.recipe.method.filter((m) => !recipe.method.includes(m))) {
        if (/\s,|,\s*,|\s{2,}/.test(line)) bad.push(`${slug}: punctuation → ${line}`);
        if (/^(and|then|with|,|\.)/i.test(line.trim())) bad.push(`${slug}: dangling start → ${line}`);
        if (/\b(and|with|the|a|an|of)[\s.,;]*$/i.test(line.trim())) bad.push(`${slug}: dangling end → ${line}`);
        if (!line.trim()) bad.push(`${slug}: empty line`);
      }
      // 3. it is still a recipe
      if (!out.recipe.ingredients.length) bad.push(`${slug}: no ingredients left`);
      if (!out.recipe.method.length) bad.push(`${slug}: no method left`);
    }

    expect(adapted, "the sweep must actually adapt recipes, or it proves nothing").toBeGreaterThan(60);
    expect(bad.slice(0, 25).join("\n") || "clean").toBe("clean");
  });
});

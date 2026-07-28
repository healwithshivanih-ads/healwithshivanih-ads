/**
 * Preparation-qualified avoids — the seam where "she reacts to raw onion"
 * either protects a client or silently deletes half her menu.
 *
 * Reported 2026-07-28 (cl-022 Nazneen): raw onion gave her a dry mouth, which
 * was one of her primary tracked symptoms. Recording it the obvious way —
 * "raw onion" in foods_to_avoid — tripped a bare /\bonion\b/ category trigger
 * that expands to onion/shallot/leek and dropped 149 of 467 library recipes,
 * every cooked-onion sabzi, dal and curry included. Nothing in the filter knew
 * what preparation meant.
 *
 * These tests pin both halves of the fix: "raw X" spares the cooked dishes,
 * and an UNQUALIFIED entry still nukes the food outright (a Jain client's
 * "Onion, Garlic" must keep behaving exactly as it did).
 */
import { describe, it, expect } from "vitest";
import { loadLibraryRecipes } from "./client-app";
import { ingredientIsRawIn } from "./foods-to-avoid";

const KACHUMBER = {
  method: [
    "Dice the tomato, onion and cucumber to roughly the same small size.",
    "Toss them with the green chilli and coriander.",
    "Add the lemon juice, roasted cumin, black salt and pepper and mix.",
  ],
};
const BUTTER_CHICKEN = {
  method: [
    "Marinate the chicken in yoghurt and spices.",
    "Sear the chicken in a hot pan and set aside.",
    "In the same pan, add diced onion and sauté until golden, about 3 minutes.",
    "Add tomato puree and simmer.",
  ],
};
// the trap: onion enters a raw batter at step 1, heat arrives at step 3
const AJWAIN_CHEELA = {
  method: [
    "Mix besan, ajwain seeds, turmeric, salt, green chilli, and onion in a bowl.",
    "Add water gradually to form a thin, smooth batter.",
    "Heat 1 tsp ghee on a non-stick tawa over medium-high heat.",
    "Pour half the batter and spread thin.",
    "Cook for 1-2 minutes until the edges brown, then flip.",
  ],
};
// the other trap: the pan runs BEFORE the onion goes on, uncooked
const SHAWARMA = {
  method: [
    "Mix yoghurt, ginger-garlic paste and spices in a bowl.",
    "Add chicken slices and coat well.",
    "Heat oil in a pan and cook chicken 2-3 minutes per side until charred.",
    "Warm the wrap briefly.",
    "Layer tomato, cucumber, and onion slices on the wrap, then top with chicken.",
    "Roll tightly and serve.",
  ],
};
const RAITA = { method: ["Place yoghurt in a bowl.", "Stir in grated cucumber and mint.", "Chill until ready."] };

describe("ingredientIsRawIn", () => {
  it("raw in an uncooked salad", () => {
    expect(ingredientIsRawIn(KACHUMBER, "onion")).toBe(true);
  });
  it("cooked when sautéed", () => {
    expect(ingredientIsRawIn(BUTTER_CHICKEN, "onion")).toBe(false);
  });
  it("cooked when mixed into a batter that is later griddled", () => {
    expect(ingredientIsRawIn(AJWAIN_CHEELA, "onion")).toBe(false);
  });
  it("raw when the cooking happened BEFORE it was added", () => {
    // chicken is pan-cooked at step 3; onion is laid on raw at step 5
    expect(ingredientIsRawIn(SHAWARMA, "onion")).toBe(true);
  });
  it("absent from a no-cook dish counts as raw", () => {
    expect(ingredientIsRawIn(RAITA, "onion")).toBe(true);
  });
  it("absent from a cooked dish assumes cooked", () => {
    expect(ingredientIsRawIn(BUTTER_CHICKEN, "leek")).toBe(false);
  });
  it("no method at all is not treated as raw", () => {
    expect(ingredientIsRawIn({ method: [] }, "onion")).toBe(false);
  });
  it("token with regex characters does not throw", () => {
    expect(() => ingredientIsRawIn(KACHUMBER, "a+b(c")).not.toThrow();
  });
});

describe("against the real recipe library", () => {
  it("'raw onion' spares the cooked-onion dishes that 'onion' would delete", async () => {
    const lib = await loadLibraryRecipes();
    const namesOnion = lib.filter((l) =>
      /\bonion\b/.test(
        `${l.recipe.title} ${(l.recipe.mains ?? []).join(" ")} ${(l.recipe.ingredients ?? []).join(" ")}`.toLowerCase(),
      ),
    );
    const rawOnion = namesOnion.filter((l) => ingredientIsRawIn(l.recipe, "onion"));

    // unqualified "onion" still nukes the lot — Jain clients must not regress
    expect(namesOnion.length).toBeGreaterThan(100);
    // "raw onion" must be a small minority, or the feature bought nothing
    expect(rawOnion.length).toBeLessThan(namesOnion.length / 4);
    expect(namesOnion.length - rawOnion.length).toBeGreaterThan(80);
  });

  it("classifies known dishes correctly in the real library", async () => {
    const lib = await loadLibraryRecipes();
    const find = (slug: string) => lib.find((l) => l.slug === slug)?.recipe;

    // raw: onion goes into a bowl and never meets heat
    const eggSandwich = find("egg-sandwich");
    if (eggSandwich) expect(ingredientIsRawIn(eggSandwich, "onion")).toBe(true);

    // cooked: sautéed into the gravy
    const butter = find("butter-chicken");
    if (butter) expect(ingredientIsRawIn(butter, "onion")).toBe(false);

    // the batter trap — onion mixed in cold, griddled after
    const cheela = find("ajwain-besan-cheela");
    if (cheela) expect(ingredientIsRawIn(cheela, "onion")).toBe(false);
  });
});

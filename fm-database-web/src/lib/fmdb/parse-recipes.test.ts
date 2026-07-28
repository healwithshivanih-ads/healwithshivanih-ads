/**
 * The recipe-pack parser, at the seam where a method reaches a client's phone.
 *
 * Reported 2026-07-28 (cl-004, breakfast): "Foxtail millet upma" showed its
 * ingredients and then nothing — no method. Her pack DOES carry the recipe. The
 * ⭐-era letters write a labelled ingredient block (`**Ingredients (1 serving):**`
 * + bullets) followed by the method as an UNLABELLED prose paragraph — no
 * `**Method:**` header, no numbering. The structured pass found the ingredients,
 * so the loose-shape fallback (guarded on BOTH being empty) never ran, and the
 * method was silently dropped. Three recipes in her wk3-4 sidecar were affected.
 *
 * The fix reads prose as method whenever the method is empty — but only from
 * AFTER the last ingredient, so a recipe's opening blurb can never be mistaken
 * for a cooking step.
 */
import { describe, it, expect } from "vitest";
import { parseRecipes, matchPackRecipe, type LetterRecipe } from "./client-app";

/** Verbatim shape from cl-004's meal_plan-wk3-4-recipes.md. */
const STARRED_PACK = `## Recipes

### ⭐ Foxtail Millet Upma

**Ingredients (1 serving):**
- ½ cup foxtail millet (dry-roasted, then soaked 15 min and drained)
- ½ cup capsicum, diced small
- 1 tsp mustard seeds
- Rock salt to taste

Heat ghee. Add mustard seeds; when they pop, add curry leaves, ginger, and chilli. Add capsicum and peas, sauté 2–3 min. Add drained millet + 1 cup water + salt. Cover and cook on low-medium 10–12 min until water is absorbed.

---

### ⭐ Kokum Sherbet (Unsweetened)

**Ingredients (1 glass):**
- 6 kokum petals soaked in 1 cup warm water
- Pinch of roasted cumin powder

Soak the kokum 20 minutes. Strain, add cumin and rock salt, and drink at room temperature.
`;

/** The structured shape — must keep parsing exactly as before. */
const STRUCTURED_PACK = `### ✦ Moong Dal Chilla

**Serves:** 2 | **Time:** 20 min

**Ingredients:**
- 1 cup moong dal, soaked
- 1 tsp cumin

**Method:**
1. Blend the soaked dal to a smooth batter.
2. Spread thin on a hot tawa and cook both sides.

**Tip:** Rest the batter 10 minutes for a softer chilla.
`;

describe("parseRecipes", () => {
  it("reads an unlabelled prose method when the ingredients were labelled", () => {
    const rs = parseRecipes(STARRED_PACK);
    expect(rs.map((r) => r.title)).toEqual([
      "Foxtail Millet Upma",
      "Kokum Sherbet (Unsweetened)",
    ]);
    for (const r of rs) {
      expect(r.ingredients.length, `${r.title} ingredients`).toBeGreaterThan(0);
      expect(r.method.length, `${r.title} method`).toBeGreaterThan(0);
    }
    expect(rs[0].method[0]).toMatch(/^Heat ghee/);
    // the ingredient bullets must NOT leak into the method
    expect(rs[0].method.join(" ")).not.toMatch(/foxtail millet \(dry-roasted/);
  });

  it("leaves the structured shape byte-identical", () => {
    const [r] = parseRecipes(STRUCTURED_PACK);
    expect(r.serves).toBe("2");
    expect(r.time).toBe("20 min");
    expect(r.ingredients).toEqual(["1 cup moong dal, soaked", "1 tsp cumin"]);
    expect(r.method).toEqual([
      "Blend the soaked dal to a smooth batter.",
      "Spread thin on a hot tawa and cook both sides.",
    ]);
    expect(r.tip).toBe("Rest the batter 10 minutes for a softer chilla.");
  });

  it("never reads a recipe's opening blurb as a cooking step", () => {
    const withBlurb = `### ⭐ Sprouted Moong Salad

A cooling, no-cook assembly that takes two minutes and travels well in a dabba.

**Ingredients (1 bowl):**
- 1 cup sprouted moong, steamed 3 min
- Lemon and rock salt

Toss everything together and finish with a squeeze of lemon just before eating.
`;
    const [r] = parseRecipes(withBlurb);
    expect(r.method).toEqual([
      "Toss everything together and finish with a squeeze of lemon just before eating.",
    ]);
  });

  it("still handles a recipe with neither marker (the original loose fallback)", () => {
    const loose = `### ⭐ Golden Milk

**For the milk:**
- 1 cup milk
- ¼ tsp turmeric

Warm the milk gently with the turmeric and a crack of black pepper. Do not boil. Drink warm, ideally an hour before bed.
`;
    const [r] = parseRecipes(loose);
    expect(r.ingredients).toContain("1 cup milk");
    expect(r.method.length).toBeGreaterThan(0);
  });

  it("does not serve one dish's method under another dish's name", () => {
    // Surfaced by the fix above: cl-004's lunch is "Foxtail millet pulao
    // (1 bowl) + …" and her pack carries "Foxtail Millet Upma". The pack matcher
    // tolerated the missing HEAD noun (2 of 3 title tokens hit), so the pulao
    // slot matched the upma. While the parser dropped prose methods the match
    // rendered nothing and the fault stayed invisible; the moment methods
    // parsed, it would have served upma steps under a pulao heading.
    //
    // The library resolver already refuses a match that BOTH misses a title
    // token AND carries an extra dish token — a different dish, not a portion
    // variation. matchPackRecipe's docstring says "keep in lockstep with
    // recipeFor"; this is the clause it was missing.
    const pack: LetterRecipe[] = [
      { title: "Foxtail Millet Upma", ingredients: ["foxtail millet", "mustard seeds"], method: ["Temper.", "Cook."] },
    ];
    expect(matchPackRecipe("Foxtail millet pulao (1 bowl)", pack)).toBeUndefined();
    expect(matchPackRecipe("Foxtail millet upma (1 bowl)", pack)?.title).toBe("Foxtail Millet Upma");
  });

  it("still matches when the dish drops a leading descriptor from the title", () => {
    // miss with no extra = a portion/descriptor variation, which must still match.
    const pack: LetterRecipe[] = [
      { title: "Cilantro Mint Chutney", ingredients: ["mint", "coriander"], method: ["Blend."] },
    ];
    expect(matchPackRecipe("Mint chutney (2 tbsp)", pack)?.title).toBe("Cilantro Mint Chutney");
  });

  it("still matches '<recipe> + <sides>' where nothing in the title is missing", () => {
    const pack: LetterRecipe[] = [
      { title: "Masala Roasted Chana", ingredients: ["chana"], method: ["Roast."] },
    ];
    expect(
      matchPackRecipe("Sabja seeds drink (1 glass) + Masala Roasted Chana (2 tbsp)", pack)?.title,
    ).toBe("Masala Roasted Chana");
  });

  it("returns an empty method rather than inventing one when there is no prose", () => {
    const noMethod = `### ⭐ Soaked Almonds

**Ingredients:**
- 8 almonds, soaked overnight and peeled
`;
    const [r] = parseRecipes(noMethod);
    expect(r.ingredients.length).toBe(1);
    expect(r.method).toEqual([]);
  });
});

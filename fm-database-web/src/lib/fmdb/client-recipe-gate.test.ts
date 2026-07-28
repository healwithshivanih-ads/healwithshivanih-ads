/**
 * The per-client recipe gate — the seam that decides whether a client is ever
 * SHOWN a curated recipe.
 *
 * Reported 2026-07-28 (cl-009, dinner): "Paneer bhurji (1 cup) + jowar roti (2)
 * + cucumber raita" opened with no method. The recipe exists, is tagged
 * `vegetarian`, and resolves fine — but the diet classifier read the word
 * `bhurji` as an egg word (anda bhurji is the famous one) and rated the recipe
 * eggetarian, so it was filtered out of every vegetarian and vegan client's
 * library before matching ever ran. Four recipes were affected: paneer bhurji,
 * tofu bhurji (VEGAN), paneer scramble, paneer vegetable stir-fry.
 *
 * These pin both directions: bhurji alone is a scramble, not an egg; the actual
 * egg dishes stay gated.
 */
import { describe, it, expect } from "vitest";
import { buildClientRecipeGate, loadLibraryRecipes, type LetterRecipe } from "./client-app";

const r = (
  title: string,
  ingredients: string[],
  diet: string[] = [],
  mains: string[] = [],
): LetterRecipe => ({ title, ingredients, mains, diet, method: ["Cook.", "Serve."] });

const VEGAN = { dietary_preference: "Vegan" };
const VEG = { dietary_preference: "Vegetarian" };
const JAIN = { dietary_preference: "Vegetarian Jain", foods_to_avoid: "Onion, Garlic" };
const EGGETARIAN = { dietary_preference: "Eggetarian" };
const OMNI = { dietary_preference: "Non-vegetarian" };

describe("diet level", () => {
  it("does not read 'bhurji' as an egg word", () => {
    const paneerBhurji = r(
      "Paneer bhurji",
      ["200 g paneer, crumbled", "1 piece tomato", "2 tsp ghee"],
      ["vegetarian", "gluten_free"],
    );
    expect(buildClientRecipeGate(VEG)(paneerBhurji)).toBe(true);
  });

  it("keeps a vegan bhurji visible to a vegan client", () => {
    const tofuBhurji = r(
      "Tofu bhurji with capsicum and tomato",
      ["200 g tofu, crumbled", "1 capsicum"],
      ["vegetarian", "vegan", "gluten_free"],
    );
    expect(buildClientRecipeGate(VEGAN)(tofuBhurji)).toBe(true);
    expect(buildClientRecipeGate(VEG)(tofuBhurji)).toBe(true);
  });

  it("still gates the actual egg dishes away from a vegetarian", () => {
    for (const eggDish of [
      r("Egg bhurji", ["3 eggs", "1 onion"], ["eggetarian"]),
      r("Masala scrambled eggs", ["3 eggs", "1 tsp ghee"], ["eggetarian"]),
      r("Anda bhurji", ["3 anda"], []), // untagged: caught by the text scan alone
      r("Shakshuka", ["2 eggs poached in tomato"], []),
    ]) {
      expect(buildClientRecipeGate(VEG)(eggDish), eggDish.title).toBe(false);
      expect(buildClientRecipeGate(EGGETARIAN)(eggDish), eggDish.title).toBe(true);
    }
  });

  it("never lets meat through to a vegetarian or eggetarian", () => {
    const chicken = r("Chicken curry", ["500 g chicken"], ["non_vegetarian"]);
    expect(buildClientRecipeGate(VEG)(chicken)).toBe(false);
    expect(buildClientRecipeGate(EGGETARIAN)(chicken)).toBe(false);
    expect(buildClientRecipeGate(OMNI)(chicken)).toBe(true);
  });
});

describe("Jain + avoid list", () => {
  const pulao = r("Foxtail millet pulao", ["1 cup foxtail millet", "1 piece onion, sliced"]);

  it("drops a recipe whose tempering names an avoided allium", () => {
    expect(buildClientRecipeGate(JAIN)(pulao)).toBe(false);
  });

  it("keeps the onion-free version", () => {
    const clean = r("Foxtail millet pulao", ["1 cup foxtail millet", "1 tsp cumin seeds"]);
    expect(buildClientRecipeGate(JAIN)(clean)).toBe(true);
  });

  it("does not read a compliance mention as contamination", () => {
    // The recipe authored FOR her restriction must survive (fix 23ede1fe).
    const compliant = r("Paneer Tikka (No-Onion-Garlic Marinade)", ["200 g paneer", "hung curd"]);
    expect(buildClientRecipeGate(JAIN)(compliant)).toBe(true);
  });

  it("is inert for a client with no preference and no avoid list", () => {
    const gate = buildClientRecipeGate({});
    expect(gate(pulao)).toBe(true);
    expect(gate(r("Chicken curry", ["chicken"], ["non_vegetarian"]))).toBe(true);
  });
});

describe("against the real catalogue", () => {
  it("shows every paneer/tofu scramble to a vegetarian", async () => {
    const lib = await loadLibraryRecipes();
    const gate = buildClientRecipeGate(VEG);
    const scrambles = lib.filter((l) =>
      ["paneer-bhurji", "tofu-bhurji", "paneer-scramble", "paneer-vegetable-stir-fry"].includes(
        l.slug,
      ),
    );
    expect(scrambles.length).toBeGreaterThan(0);
    for (const s of scrambles) expect(gate(s.recipe), s.slug).toBe(true);
  });

  it("hides every egg-titled recipe from a vegetarian", async () => {
    const lib = await loadLibraryRecipes();
    const gate = buildClientRecipeGate(VEG);
    const eggs = lib.filter((l) => /\begg/i.test(l.recipe.title));
    expect(eggs.length).toBeGreaterThan(0);
    for (const e of eggs) expect(gate(e.recipe), e.slug).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { recipeMatches, recipeWeeks, searchRecipes, significantWords } from "./recipe-search";

const omelette = {
  title: "3-Egg Omelette with Onion and Cabbage",
  ingredients: ["3 eggs", "½ cup cabbage, finely chopped", "¼ cup onion", "1 tbsp ghee or oil"],
};
const cheela = { title: "Ajwain Besan Cheela", ingredients: ["½ cup besan (chickpea flour)", "½ tsp ajwain seeds"] };
const pulao = { title: "Kodo millet pulao with peas and jeera", ingredients: ["kodo millet", "green peas", "jeera"] };
const moongDal = { title: "Moong dal", ingredients: ["moong dal", "turmeric"] };

const week = (n: number, dishes: string[]) => ({
  week: n,
  days: dishes.map((dish) => ({ slots: [{ dish }] })),
});
const weeks = [
  week(2, [
    "3-Egg Omelette (Onion & Cabbage) (1 serving) + curd (3 tbsp)",
    "Grilled Chicken Breast (~100g) + Kodo millet pulao with peas and jeera (1 small bowl)",
  ]),
  week(3, ["3-Egg Bhurji (Onion, Cauliflower, Beans) (1 serving)", "Sprouted moong dal chilla (2 pieces)"]),
  week(4, ["Moong dal (1 bowl) + Whole-wheat roti (1)"]),
];

describe("recipeMatches", () => {
  it("matches on the title, case- and accent-insensitively", () => {
    expect(recipeMatches(cheela, "CHEELA")).toBe(true);
    expect(recipeMatches({ title: "Poriyal à la maison", ingredients: [] }, "a la")).toBe(true);
  });
  it("matches on an ingredient — cabbage finds the omelette", () => {
    expect(recipeMatches(omelette, "cabbage")).toBe(true);
    expect(recipeMatches(cheela, "cabbage")).toBe(false);
  });
  it("needs every word of the query", () => {
    expect(recipeMatches(omelette, "egg cabbage")).toBe(true);
    expect(recipeMatches(omelette, "egg paneer")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(recipeMatches(cheela, "  ")).toBe(true);
  });
});

describe("recipeWeeks", () => {
  it("tags a recipe with the weeks whose menu names it, by exact containment", () => {
    expect(recipeWeeks(pulao, weeks)).toEqual([2]);
  });
  it("survives the menu's reworded form of the title (every significant word present)", () => {
    // "3-Egg Omelette with Onion and Cabbage" vs "3-Egg Omelette (Onion & Cabbage)"
    expect(recipeWeeks(omelette, weeks)).toEqual([2]);
  });
  it("does not tag a one-word title onto every dish that happens to contain the word", () => {
    // "Moong dal" is on week 4; week 3's "Sprouted moong dal chilla" ALSO
    // contains it verbatim, and that is a genuine containment — both tagged.
    expect(recipeWeeks(moongDal, weeks)).toEqual([3, 4]);
    // But a single significant word never matches by the word rule alone.
    expect(recipeWeeks({ title: "Chilla" }, [week(9, ["Something with chilli"])])).toEqual([]);
  });
  it("returns nothing for a recipe the menu never names", () => {
    expect(recipeWeeks(cheela, weeks)).toEqual([]);
  });
  it("strips filler words before matching", () => {
    expect(significantWords("Kodo millet pulao with peas and jeera")).toEqual(["kodo", "millet", "pulao", "peas", "jeera"]);
  });
});

describe("searchRecipes", () => {
  const pack = [omelette, cheela, pulao, moongDal];
  it("keeps pack order and attaches weeks", () => {
    const hits = searchRecipes(pack, weeks, "");
    expect(hits.map((h) => h.recipe.title)).toEqual(pack.map((r) => r.title));
    expect(hits[0].weeks).toEqual([2]);
    expect(hits[1].weeks).toEqual([]);
  });
  it("narrows to a week", () => {
    expect(searchRecipes(pack, weeks, "", 2).map((h) => h.recipe.title)).toEqual([omelette.title, pulao.title]);
  });
  it("combines a query with a week", () => {
    expect(searchRecipes(pack, weeks, "moong", 4).map((h) => h.recipe.title)).toEqual([moongDal.title]);
    expect(searchRecipes(pack, weeks, "moong", 2)).toEqual([]);
  });
});

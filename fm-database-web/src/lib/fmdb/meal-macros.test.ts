import { describe, expect, it } from "vitest";
import { buildMacroLookup, dayMacros, isNothing, macroLine, macrosFromServing, mealMacros, nutrientsShown } from "./meal-macros";

const dal = { protein_g: 9.4, carbs_g: 20.2, fat_g: 4.1, fibre_g: 5.3 };
const roti = { protein_g: 3, carbs_g: 18, fat_g: 1, fibre_g: 3 };
const lookup = buildMacroLookup([
  { title: "Moong dal", macros: dal },
  { title: "Jowar bhakri", aliases: ["Jowar roti"], macros: roti },
  { title: "Thin recipe" },
]);

describe("which figures may be shown", () => {
  it("only a recipe whose own computation covered at least 90%", () => {
    expect(macrosFromServing({ ...dal, kcal: 150 }, 100)).toEqual(dal);
    expect(macrosFromServing(dal, 80)).toBeNull();
    expect(macrosFromServing({ protein_g: 9 }, 100)).toBeNull();
    expect(macrosFromServing(dal, undefined)).toBeNull();
  });
});

describe("a meal", () => {
  it("adds up the recipes it names, by name or alias", () => {
    expect(mealMacros("Moong dal (1 bowl) + Jowar roti (2)", lookup)).toEqual({ protein_g: 12, carbs_g: 38, fat_g: 5, fibre_g: 8, complete: true });
  });
  it("garnish and tempering count as nothing, not as missing", () => {
    expect(mealMacros("Moong dal + lemon squeeze + coriander leaves", lookup)?.complete).toBe(true);
    expect(isNothing("Fresh coriander leaves")).toBe(true);
    expect(isNothing("Moong dal with ginger")).toBe(false);
  });
  it("a part with no recipe makes it 'about'; nothing known gives no numbers", () => {
    const m = mealMacros("Moong dal + Curd (1 cup)", lookup);
    expect(m?.complete).toBe(false);
    expect(macroLine(m!)).toMatch(/^About: Protein 9 g/);
    expect(mealMacros("Kiwi + Curd", lookup)).toBeNull();
  });
  it("never shows calories", () => {
    expect(macroLine({ ...dal, complete: true })).not.toMatch(/kcal|calorie/i);
  });
});

describe("the day", () => {
  it("is complete only when every meal is", () => {
    const full = { ...roti, complete: true };
    expect(dayMacros([{ macros: full }, { macros: full }])).toMatchObject({ protein_g: 6, complete: true });
    expect(dayMacros([{ macros: full }, { macros: null }])?.complete).toBe(false);
    expect(dayMacros([{ macros: null }])).toBeNull();
  });
});

describe("the coach's switch", () => {
  it("on by default, off by default for a gentle client, her setting wins", () => {
    expect(nutrientsShown({}, false)).toBe(true);
    expect(nutrientsShown({}, true)).toBe(false);
    expect(nutrientsShown({ app_nutrients: true }, true)).toBe(true);
    expect(nutrientsShown({ app_nutrients: false }, false)).toBe(false);
  });
});

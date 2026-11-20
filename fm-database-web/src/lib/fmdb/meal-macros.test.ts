import { describe, expect, it } from "vitest";
import { buildMacroLookup, dayMacros, isNothing, macroLine, macrosFromServing, mealMacros, nutrientsShown } from "./meal-macros";

const dal = { protein_g: 9.4, carbs_g: 20.2, fat_g: 4.1, fibre_g: 5.3 };
const roti = { protein_g: 3, carbs_g: 18, fat_g: 1, fibre_g: 3 };
const lookup = buildMacroLookup([
  { title: "Moong dal", macros: dal, portion: { qty: 1, unit: "bowl" } },
  { title: "Jowar bhakri", aliases: ["Jowar roti"], macros: roti, portion: { qty: 1, unit: "piece" } },
  { title: "Toor dal", macros: { protein_g: 16.6, carbs_g: 46.7, fat_g: 8.3, fibre_g: 7 }, portion: { qty: 2.5, unit: "bowl" } },
  { title: "Thin recipe" },
]);
const C = (s: string) => s.split(" + ").map((x) => {
  const m = x.match(/^(.*?)\s*\(([^)]*)\)$/);
  return m ? { title: m[1], portion: m[2] } : { title: x };
});

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
    expect(mealMacros(C("Moong dal (1 bowl) + Jowar roti (2)"), lookup)).toEqual({ protein_g: 15, carbs_g: 56, fat_g: 6, fibre_g: 11, complete: true });
  });
  it("garnish and tempering count as nothing, not as missing", () => {
    expect(mealMacros(C("Moong dal (1 bowl) + lemon squeeze + coriander leaves"), lookup)?.complete).toBe(true);
    expect(isNothing("Fresh coriander leaves")).toBe(true);
    expect(isNothing("Moong dal with ginger")).toBe(false);
  });
  it("a part with no recipe makes it 'about'; nothing known gives no numbers", () => {
    const m = mealMacros(C("Moong dal (1 bowl) + Curd (1 cup)"), lookup);
    expect(m?.complete).toBe(false);
    expect(macroLine(m!)).toMatch(/^About: Protein 9 g/);
    expect(mealMacros(C("Kiwi + Curd"), lookup)).toBeNull();
  });
  it("never shows calories", () => {
    expect(macroLine({ ...dal, complete: true })).not.toMatch(/kcal|calorie/i);
  });
});

describe("portions", () => {
  it("scales a recipe's serving to the menu's portion", () => {
    // toor dal: one serving is 2.5 katoris, the menu says 1 bowl
    expect(mealMacros(C("Toor dal (1 bowl)"), lookup)).toMatchObject({ protein_g: 7, carbs_g: 19, complete: true });
  });
  it("a portion it can't compare keeps one serving and says about", () => {
    expect(mealMacros(C("Toor dal"), lookup)).toMatchObject({ protein_g: 17, complete: false });
    expect(mealMacros(C("Toor dal (2 pieces)"), lookup)?.complete).toBe(false);
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

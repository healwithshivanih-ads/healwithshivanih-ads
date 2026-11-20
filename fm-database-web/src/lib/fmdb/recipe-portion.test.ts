import { describe, expect, it } from "vitest";
import { menuPortion, portionFactor, recipePortion, type FoodInfo } from "./recipe-portion";

const food: FoodInfo = (k) =>
  ({
    "jowar-flour": { category: "flour", basis: "dry" },
    "toor-dal": { category: "dal_legume", basis: "dry" },
    "moong-dal-thin": { category: "dal_legume", basis: "as_consumed" },
    spinach: { category: "leafy", basis: "raw" },
    ghee: { category: "oil_fat" },
  })[k] ?? null;
const L = (key: string, g: number, i = 0) => ({ i, key, g });

describe("one serving, from the recipe's own grams", () => {
  it("breads by dry flour per piece", () => {
    expect(recipePortion("Jowar bhakri", [L("jowar-flour", 240)], 2, food)).toEqual({ qty: 3, unit: "piece" });
  });
  it("dal by dry dal per katori", () => {
    expect(recipePortion("Toor dal", [L("toor-dal", 150), L("ghee", 14, 1)], 2, food)).toEqual({ qty: 2.5, unit: "bowl" });
  });
  it("an already-cooked dal is never divided as dry weight", () => {
    expect(recipePortion("Palak moong dal", [L("moong-dal-thin", 160)], 1, food)).toEqual({ qty: 1, unit: "bowl" });
  });
  it("sabzi by vegetable weight, fat left out", () => {
    expect(recipePortion("Palak sabzi", [L("spinach", 300), L("ghee", 20, 1)], 2, food)).toEqual({ qty: 1, unit: "bowl" });
  });
  it("soups, salads, sandwiches and unknown dishes get none", () => {
    expect(recipePortion("Moong dal soup", [L("toor-dal", 100)], 2, food)).toBeNull();
    expect(recipePortion("Kachumber salad", [L("spinach", 100)], 2, food)).toBeNull();
    expect(recipePortion("Green chutney sandwich", [L("spinach", 100)], 2, food)).toBeNull();
  });
  it("a hand-set portion wins", () => {
    expect(recipePortion("Toor dal", [L("toor-dal", 150)], 2, food, { qty: 2, unit: "bowl" })).toEqual({ qty: 2, unit: "bowl" });
  });
});

describe("the menu's portion", () => {
  it("reads the usual ways a menu writes it", () => {
    expect(menuPortion("2")).toEqual({ qty: 2, unit: "piece" });
    expect(menuPortion("1 bowl")).toEqual({ qty: 1, unit: "bowl" });
    expect(menuPortion("½ cup")).toMatchObject({ qty: 0.5, unit: "bowl" });
    expect(menuPortion("small bowl")?.qty).toBeCloseTo(0.7);
    expect(menuPortion("1 glass")).toEqual({ qty: 1, unit: "glass" });
    expect(menuPortion("2 tbsp")).toEqual({ qty: 2, unit: "tbsp" });
    expect(menuPortion("to taste")).toBeNull();
  });
  it("compares only like with like", () => {
    expect(portionFactor({ qty: 3, unit: "piece" }, { qty: 2, unit: "piece" })).toBeCloseTo(2 / 3);
    expect(portionFactor({ qty: 3, unit: "piece" }, { qty: 1, unit: "bowl" })).toBeNull();
    // a cup of almond milk is a drink
    expect(portionFactor({ qty: 1, unit: "glass" }, menuPortion("1 cup"))).toBeCloseTo(0.8);
  });
});

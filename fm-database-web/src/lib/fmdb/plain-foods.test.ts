import { describe, expect, it } from "vitest";
import { buildPlainFoodLookup } from "./plain-foods";

const table = {
  yogurt: { category: "dairy", aliases: ["curd", "dahi"], per_100g: { protein_g: 3.5, carbs_g: 4.7, fat_g: 3.3, fibre_g: 0 } },
  almonds: { category: "nut_seed", aliases: ["almond", "almonds"], per_100g: { protein_g: 21, carbs_g: 22, fat_g: 50, fibre_g: 12 } },
  "pumpkin-seeds": { category: "nut_seed", aliases: ["pumpkin seeds"], per_100g: { protein_g: 30, carbs_g: 11, fat_g: 49, fibre_g: 6 } },
  milk: { category: "dairy", aliases: ["milk"], per_100g: { protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3, fibre_g: 0 } },
  turmeric: { category: "spice", aliases: ["turmeric"], per_100g: { protein_g: 8 } },
};
const plain = buildPlainFoodLookup(table);

describe("plain foods on a menu", () => {
  it("counts curd, almonds and seeds by the portion the menu names", () => {
    expect(plain("homemade plain dahi at room temperature", "1/2 cup")?.protein_g).toBeCloseTo(2.6, 1);
    expect(plain("soaked peeled almonds", "8")?.protein_g).toBeCloseTo(2.0, 1);
    expect(plain("pumpkin seeds", "1 tbsp")?.protein_g).toBeCloseTo(2.7, 1);
    expect(plain("milk", "1 glass")?.protein_g).toBeCloseTo(6.4, 1);
  });
  it("never counts what it cannot weigh, spices, or a splash of milk in tea", () => {
    expect(plain("curd", undefined)).toBeNull();
    expect(plain("turmeric", "1 tsp")).toBeNull();
    expect(plain("Tea with milk", "1 cup")).toBeNull();
    expect(plain("brazil nut", "1")).toBeNull();
  });
});

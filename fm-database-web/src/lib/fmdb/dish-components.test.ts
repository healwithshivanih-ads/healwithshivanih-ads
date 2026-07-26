/**
 * Locks the anatomy of a menu dish string.
 *
 * Both behaviours here shipped bugs to a client's phone:
 *   - " + " inside a portion annotation was treated as a component boundary,
 *     so "Prawn and egg stir-fry (75g prawns + 2 eggs) + …" showed the client
 *     a dish called "Prawn and egg stir-fry (75g prawns";
 *   - every component was an equal candidate for the slot's recipe, so a
 *     trailing snack supplied the method for a drink-led slot.
 */
import { describe, it, expect } from "vitest";
import {
  splitDishComponents,
  splitDishParts,
  splitDishPills,
  primaryDishPart,
} from "./dish-components";

const NAZNEEN =
  "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked) + Masala Roasted Chana (2 tbsp)";

describe("component splitting is bracket-aware", () => {
  it("does not split on a ' + ' inside a portion annotation", () => {
    expect(splitDishComponents(NAZNEEN).map((c) => c.title)).toEqual([
      "Sabja seeds drink",
      "Masala Roasted Chana",
    ]);
  });

  it("lifts the whole annotation as the portion, not a phantom component", () => {
    const [first] = splitDishComponents(NAZNEEN);
    expect(first.portion).toBe("1 glass water + 1 tsp sabja seeds soaked");
  });

  it("never emits a component with unbalanced brackets", () => {
    const dishes = [
      NAZNEEN,
      "Prawn and egg stir-fry (75g prawns + 2 eggs) + sautéed spinach (½ cup)",
      "Vegetable egg omelette (3 eggs, peppers + onion + tomato) + Whole-wheat roti (1)",
      "Paneer & spinach sabzi (~80 g paneer + 1 cup spinach) + Dahi (1/2 cup)",
    ];
    for (const d of dishes)
      for (const c of splitDishComponents(d)) {
        const open = (c.title.match(/\(/g) ?? []).length;
        const close = (c.title.match(/\)/g) ?? []).length;
        expect(open, `unbalanced in "${c.title}"`).toBe(close);
      }
  });

  it("keeps ordinary ' + ' separated components apart", () => {
    expect(splitDishComponents("Ragi dosa (2) + chutney (2 tbsp)")).toEqual([
      { title: "Ragi dosa", portion: "2" },
      { title: "chutney", portion: "2 tbsp" },
    ]);
  });

  it("splitDishPills keeps portions attached — the overlay lists them verbatim", () => {
    expect(splitDishPills(NAZNEEN)).toEqual([
      "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked)",
      "Masala Roasted Chana (2 tbsp)",
    ]);
  });

  it("splits the arrow/colon separators real dinner menus use", () => {
    expect(splitDishParts("Green moong sabzi ⇒ masoor dal ⇒ sama millet")).toEqual([
      "Green moong sabzi",
      "masoor dal",
      "sama millet",
    ]);
  });

  it("protects a colon inside an annotation from the ':' separator", () => {
    expect(
      splitDishParts("ACV drink (1 cup: 1 tsp ACV + 1 tsp honey) + jowar roti (1)"),
    ).toEqual(["ACV drink (1 cup: 1 tsp ACV + 1 tsp honey)", "jowar roti (1)"]);
  });

  it("survives a stray closing bracket without swallowing the rest", () => {
    expect(splitDishParts("Rice 1 cup) + dal (1 bowl)")).toEqual([
      "Rice 1 cup)",
      "dal (1 bowl)",
    ]);
  });
});

describe("primaryDishPart — which component the dish IS", () => {
  it("is the FIRST component, not a later one", () => {
    expect(primaryDishPart(NAZNEEN)).toBe(
      "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked)",
    );
  });

  it("skips a tempering aromatic a drafter listed ahead of the meal", () => {
    expect(
      primaryDishPart("Garlic (1 clove crushed) + ginger (½ inch) + Pointed gourd sabzi (1 cup)"),
    ).toBe("Pointed gourd sabzi (1 cup)");
    expect(primaryDishPart("ghee (1 tsp) + Moong dal khichdi (1 bowl)")).toBe(
      "Moong dal khichdi (1 bowl)",
    );
  });

  it("treats a dish-type name as a real dish, not a garnish", () => {
    // These read as "generic" to the consistency gate's vocabulary. Reusing
    // that list here would hand the slot to the sambar / dal behind them.
    expect(primaryDishPart("Dosa (2) + sambar (3/4 cup) + chutney (2 tbsp)")).toBe("Dosa (2)");
    expect(
      primaryDishPart("Kachumber salad (1 small bowl) + Masoor dal (¾ cup) + Jowar roti (1)"),
    ).toBe("Kachumber salad (1 small bowl)");
  });

  it("falls back to the first component when nothing names a dish", () => {
    expect(primaryDishPart("ghee (1 tsp) + jeera water (1 cup)")).toBe("ghee (1 tsp)");
  });

  it("returns a single-component dish unchanged", () => {
    expect(primaryDishPart("Vegetable poha (1 bowl)")).toBe("Vegetable poha (1 bowl)");
  });
});

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
  splitDishStages,
  primaryDishPart,
} from "./dish-components";

const NAZNEEN =
  "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked) + Masala Roasted Chana (2 tbsp)";

/** Verbatim from nidhi-plan-2-2026-05-15, week 10 day 1 Lunch (and 13 more). */
const SEQUENCED_LUNCH =
  "Garlic (1 clove crushed) + ginger (1/2 tsp grated) + lime juice (1 tsp) pre-meal shot " +
  "(small cup) — then: Ridge gourd sabzi (3/4 cup) + Masoor dal (1/2 cup) + Jowar roti (1) " +
  "+ turmeric (1/4 tsp) + black pepper (pinch) + small Kachumber salad (small bowl)";

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

/**
 * The separator list used to carry a bare ":", which cut "… — then: <meal>" at
 * the colon and left "— then" welded to the drink in front of it. That
 * fragment names a food, so it won the slot: 14 of Nidhi's lunches titled
 * themselves "lime juice (1 tsp) pre-meal shot (small cup) — then".
 */
describe("a sequence connective is one separator, consumed whole", () => {
  it("never leaves a dangling connective on a component", () => {
    for (const part of splitDishParts(SEQUENCED_LUNCH))
      expect(part, `dangling connective in "${part}"`).not.toMatch(/[—–-]?\s*then$/i);
    for (const pill of splitDishPills(SEQUENCED_LUNCH))
      expect(pill, `dangling connective in "${pill}"`).not.toMatch(/[—–-]?\s*then$/i);
  });

  it("keeps the preamble and the meal apart, connective in neither", () => {
    expect(splitDishStages(SEQUENCED_LUNCH)).toHaveLength(2);
    expect(splitDishParts(SEQUENCED_LUNCH)).toContain(
      "lime juice (1 tsp) pre-meal shot (small cup)",
    );
    expect(splitDishParts(SEQUENCED_LUNCH)).toContain("Ridge gourd sabzi (3/4 cup)");
  });

  it("titles the slot with the MEAL, not the ritual that precedes it", () => {
    expect(primaryDishPart(SEQUENCED_LUNCH)).toBe("Ridge gourd sabzi (3/4 cup)");
    expect(
      primaryDishPart(
        "Bottle Gourd (Lauki) Juice (1 small glass) — then: Tofu stir-fry with mixed " +
          "vegetables (3/4 cup) + Moong dal (1/2 cup)",
      ),
    ).toBe("Tofu stir-fry with mixed vegetables (3/4 cup)");
  });

  it("reads a descriptive dash as part of the label, not as a boundary", () => {
    // Only a dash that introduces the connective sequences; "— well cooked" and
    // "— served warm" describe the component they follow.
    expect(splitDishParts("Paneer & spinach sabzi — well cooked (1 bowl) + jowar roti (1)")).toEqual(
      ["Paneer & spinach sabzi — well cooked (1 bowl)", "jowar roti (1)"],
    );
    expect(
      primaryDishPart(
        "Banana (1 small, ripe) + ghee (1/2 tsp) + cardamom (1 pinch) — served warm, mashed " +
          "— then: Palak moong dal (1 cup) + Ragi roti (1)",
      ),
    ).toBe("Palak moong dal (1 cup)");
  });

  it("leaves an unsequenced dish with exactly one stage", () => {
    expect(splitDishStages(NAZNEEN)).toEqual([NAZNEEN]);
    expect(splitDishStages("Ragi dosa (2) + chutney (2 tbsp)")).toEqual([
      "Ragi dosa (2) + chutney (2 tbsp)",
    ]);
  });
});

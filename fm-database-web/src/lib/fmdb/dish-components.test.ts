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

/**
 * An em-dash introduces either a dish's OWN INGREDIENTS or a descriptor
 * followed by genuinely separate dishes, and punctuation cannot tell them
 * apart. Both readings are load-bearing: read as a descriptor, "ABC juice —
 * apple (½ medium) + …" titles a client's slot after one of the juice's
 * ingredients (9 published slots across 3 clients did exactly this); read as a
 * gloss, a three-dish dinner collapses to one and two dishes vanish off the
 * plate. The second failure is far worse, so every ambiguous case must keep
 * today's split.
 */
describe("a dash introducing a dish's own ingredients is not a boundary", () => {
  const ABC = "ABC juice — apple (½ medium) + beetroot (¼ small) + carrot (1 small)";

  it("reads the whole cell as ONE dish, titled by the pre-dash head", () => {
    expect(splitDishComponents(ABC)).toEqual([{ title: "ABC juice", portion: undefined }]);
    expect(primaryDishPart(ABC)).toBe("ABC juice");
  });

  it("keeps the ingredient list in the pill — it is the only method the client has", () => {
    // Collapsing the false boundaries must not also delete the recipe: no
    // library or pack entry is named "ABC juice" on most plans.
    expect(splitDishPills(ABC)).toEqual([ABC]);
  });

  it("still splits a descriptor dash followed by real dishes", () => {
    const dinner =
      "Paneer & spinach sabzi — well cooked (1 bowl) + rajgira roti (1) + moong dal soup (1 bowl)";
    expect(splitDishComponents(dinner).map((c) => c.title)).toEqual([
      "Paneer & spinach sabzi — well cooked",
      "rajgira roti",
      "moong dal soup",
    ]);
    expect(primaryDishPart(dinner)).toBe("Paneer & spinach sabzi — well cooked (1 bowl)");
  });

  it("handles the gloss variants live plans actually carry", () => {
    for (const dish of [
      "ABC juice — apple (half) + beetroot (small piece 30 g) + carrot (half medium) blended with water (1 glass) + lemon juice (1 tsp)",
      "ABC Juice — apple (1 small) + beetroot (½ medium) + ginger (½ inch) — freshly pressed, served immediately",
      "ABC juice — apple (½ medium) + beetroot (¼ small) + carrot (1 small), freshly pressed (1 glass)",
      "Honey and apple cider vinegar drink — raw honey (1 tsp) + apple cider vinegar (1 tsp) + warm water (1 glass)",
    ])
      expect(splitDishComponents(dish), dish).toHaveLength(1);
  });

  it("refuses when any post-dash item names a prepared dish", () => {
    // "moong dal", "brown rice" and "foxtail millet" are all literal entries in
    // the ingredient table, so the pantry test alone would read these sides as
    // gloss items and swallow the client's dal into the drink in front of it.
    // The dish-type noun is the only thing keeping them apart.
    for (const side of ["moong dal (½ cup)", "brown rice (½ cup)", "foxtail millet (¾ cup)"])
      expect(
        splitDishComponents(`Amla shot — amla powder (1 tsp) + ${side}`),
        side,
      ).toHaveLength(2);
    expect(
      splitDishComponents("Amla shot — amla powder (1 tsp) + Beetroot salad (1 small bowl)"),
    ).toHaveLength(2);
    expect(
      splitDishComponents(
        "Grilled fish — mackerel/sardine (100 g) + Broccoli-cauliflower coconut sabzi (1 bowl) + Foxtail millet roti (1 small)",
      ),
    ).toHaveLength(3);
  });

  it("refuses when a post-dash item carries a word the pantry doesn't know", () => {
    // "French", "Brazil" and "soft" are not ingredients, so these fragments
    // cannot be claimed as part of the dish in front of them — the refusal is
    // what stops an unfamiliar side being swallowed.
    expect(
      splitDishComponents(
        "Fish stew (1 bowl) — basa/catla (100 g) in coconut milk + steamed French beans (1 small bowl)",
      ),
    ).toHaveLength(2);
    expect(
      splitDishComponents(
        "Dates-in-ghee vitality tonic — soft Medjool dates (2) warmed with ghee (½ tsp) + cardamom (pinch) + Brazil nuts (2)",
      ),
    ).toHaveLength(3);
  });

  it("refuses when a post-dash item names no food at all", () => {
    // "plain" is a preparation word, so on the every-word-accounted-for test
    // alone the fragment would pass and take the banana down with it. A gloss
    // lists FOODS; a fragment that names none is a descriptor.
    expect(splitDishComponents("Curd — plain (1 bowl) + banana (1)")).toHaveLength(2);
  });

  it("refuses when the head is itself several components", () => {
    // The dash qualifies the medley, but the eggs in front of it are their own
    // dish — merging would delete them from the plate.
    expect(
      splitDishComponents(
        "Boiled eggs (2) + roasted vegetable medley — zucchini (½ cup) + capsicum (¼ cup)",
      ),
    ).toHaveLength(3);
    expect(
      splitDishComponents(
        "Banana (1 small, ripe) + raw honey (½ tsp) + black pepper (1 pinch) — mashed together",
      ),
    ).toHaveLength(3);
  });

  it("leaves a sequenced dish to the sequence connective", () => {
    // "— then:" already means eat X then Y. Reading its dash as a gloss would
    // swallow the food that follows into the drink that precedes it.
    const d = "Jeera water (1 cup) — then: banana (1) + soaked almonds (6)";
    expect(splitDishComponents(d).map((c) => c.title)).toEqual([
      "Jeera water",
      "banana",
      "soaked almonds",
    ]);
    expect(primaryDishPart(d)).toBe("banana (1)");
  });

  it("needs the dash to be spaced — an unspaced one is inside a word", () => {
    // Without the spacing rule the first "dash" here is the hyphen in
    // "Ghee-roasted", and the slot titles itself "Ghee".
    expect(splitDishComponents("Ghee-roasted almonds — almonds (6) + ghee (½ tsp)")).toEqual([
      { title: "Ghee-roasted almonds", portion: undefined },
    ]);
  });

  it("ignores a dash inside an annotation", () => {
    expect(
      splitDishComponents("Seasonal fruit (1 medium — papaya or guava) + Brazil nuts (2 whole)"),
    ).toHaveLength(2);
    expect(splitDishComponents("Brazil nuts, soaked (3–4 nuts)")).toHaveLength(1);
  });

  it("leaves the reading alone when no boundary is at stake", () => {
    // One post-dash item cannot be shredded, so re-reading it as a gloss could
    // only move which recipe the slot opens — for a slightly tidier title. The
    // rule intervenes ONLY where a false component boundary actually exists.
    const d =
      "Almond-saffron-cardamom warm milk (½ cup) — 4 soaked almonds blended, saffron (2 strands), cardamom (pinch)";
    expect(primaryDishPart(d)).toBe(d);
  });
});

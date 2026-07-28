/**
 * The pre-meal shot must not claim the meal's slot.
 *
 * Reported 2026-07-28 (nidhi-jain, lunch + 6 more cells). The cell reads:
 *
 *   "Garlic (1 clove crushed) + ginger (1/2 tsp grated) + lime juice (1 tsp)
 *    + Ridge gourd sabzi (3/4 cup) + Chana dal (1/2 cup) + Kodo millet (3/4 cup)…"
 *
 * primaryDishPart skipped the garlic and the ginger — both are seasonings — and
 * then stopped at "lime juice". "lime" is already a non-dish word, so the
 * component qualified as a dish on the strength of "juice" alone. The slot got
 * no method (nothing in the library is a teaspoon of lime juice) and titled
 * itself after pills[0], so the client's lunch read "Garlic (1 clove crushed)".
 *
 * Her OTHER lunches write the same ritual with a "— then:" connective, which the
 * stage splitter already handles. These are the cells where the coach used a
 * plain "+", and there is no punctuation to lean on — so the fix has to come
 * from what the component IS.
 *
 * Measured over all 650 dish-cells on the live plans: 7 cells change, all of
 * them this shape. A broader rule (skip any leading run of bare foods) was
 * measured too and rejected — it moved 45 cells and got them wrong, retitling
 * "Chana masala + steamed rice + …" as steamed rice and "Butter chicken + brown
 * rice + …" as brown rice.
 */
import { describe, it, expect } from "vitest";
import { primaryDishPart } from "./dish-components";

const NIDHI_LUNCH =
  "Garlic (1 clove crushed) + ginger (1/2 tsp grated) + lime juice (1 tsp) + Ridge gourd sabzi (3/4 cup) + Chana dal (1/2 cup) + Kodo millet (3/4 cup) + turmeric (1/4 tsp) + black pepper (pinch) + roasted sesame seeds (1 tbsp) + small Kachumber salad (small bowl)";

describe("a vehicle word alone does not name a dish", () => {
  it("gives the slot to the meal, not the pre-meal shot", () => {
    expect(primaryDishPart(NIDHI_LUNCH)).toBe("Ridge gourd sabzi (3/4 cup)");
  });

  it("handles the same ritual ahead of every one of her sabzis", () => {
    const lead = "Garlic (1 clove crushed) + ginger (1/2 tsp grated) + lime juice (1 tsp) + ";
    for (const meal of [
      "Pointed gourd sabzi (3/4 cup)",
      "Karela sabzi (3/4 cup)",
      "Green moong sabzi (3/4 cup)",
      "Bhindi sabzi (3/4 cup)",
      "Turai sabzi (3/4 cup)",
      "Baingan bharta (3/4 cup)",
    ])
      expect(primaryDishPart(`${lead}${meal} + Masoor dal (1/2 cup)`), meal).toBe(meal);
  });

  it("still titles a slot after the vehicle when that is all there is", () => {
    // The lenient second pass. No meal follows, so the shot IS the slot.
    expect(primaryDishPart("lime juice (1 tsp) + warm water (1 cup)")).toBe("lime juice (1 tsp)");
  });

  it("leaves a real drink alone — it carries its own noun", () => {
    expect(primaryDishPart("ABC juice (1 glass) + soaked almonds (5)")).toBe("ABC juice (1 glass)");
    expect(primaryDishPart("Bottle Gourd (Lauki) Juice (1 small glass)")).toBe(
      "Bottle Gourd (Lauki) Juice (1 small glass)",
    );
    expect(primaryDishPart("Amla juice (30 ml) + walnuts (4)")).toBe("Amla juice (30 ml)");
  });

  it("does not retitle a tea-led snack after its side", () => {
    // "tea" is deliberately NOT a vehicle word: this cell would otherwise
    // headline itself "pumpkin seeds", which is worse than what it says today.
    expect(primaryDishPart("Tea with milk (1 cup) + pumpkin seeds (2 tbsp) + dates (1)")).toBe(
      "Tea with milk (1 cup)",
    );
  });

  it("keeps honouring the sequence connective, which is the stronger signal", () => {
    expect(
      primaryDishPart(
        "Garlic (1 clove crushed) + ginger (1/2 tsp grated) + lime juice (1 tsp) pre-meal shot (small cup) — then: Turai sabzi (3/4 cup) + Masoor dal (1/2 cup)",
      ),
    ).toBe("Turai sabzi (3/4 cup)");
  });

  it("still skips a plain tempering ahead of the meal", () => {
    expect(
      primaryDishPart("Garlic (1 clove crushed) + ginger (½ inch) + Pointed gourd sabzi (1 cup)"),
    ).toBe("Pointed gourd sabzi (1 cup)");
  });
});

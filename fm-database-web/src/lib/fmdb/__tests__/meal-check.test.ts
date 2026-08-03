/**
 * The automated meal check (docs/MEAL_PHOTO_CHECK_SPEC.md).
 *
 * Two things are load-bearing and both are pure, so both are pinned here.
 *
 * DIET NORMALISATION NEVER USES SUBSTRINGS. "vegetarian" is contained in
 * "Non-vegetarian", and this codebase has shipped that exact bug before. The
 * roster spells the same diet six different ways and leaves two clients
 * blank, so a wrong answer here means affirming a plate against the wrong
 * rules — or against none.
 *
 * AND UNKNOWN IS A REAL ANSWER, not a default to vegetarian. Two clients
 * have nothing recorded; the checker must refuse to affirm rather than guess
 * which way they eat.
 */
import { describe, it, expect } from "vitest";
import { normaliseDiet, slotForHour, NEUTRAL_LINE } from "../meal-check";

describe("diet normalisation", () => {
  it("never lets non-vegetarian collapse into vegetarian", () => {
    for (const s of ["Non-vegetarian", "Non vegetarian", "non-veg", "NONVEG"]) {
      expect(normaliseDiet(s)).toBe("non-vegetarian");
    }
  });

  it("reads every spelling on the live roster", () => {
    expect(normaliseDiet("Vegetarian")).toBe("vegetarian");
    expect(normaliseDiet("vegetarian")).toBe("vegetarian");
    expect(normaliseDiet("Eggetarian")).toBe("eggetarian");
    expect(normaliseDiet("Vegan")).toBe("vegan");
  });

  it("treats Jain as its own thing, not a kind of vegetarian", () => {
    // Roots and alliums are excluded; affirming a potato dish as "vegetarian"
    // would be wrong in exactly the way that matters.
    expect(normaliseDiet("Vegetarian Jain")).toBe("jain");
  });

  it("returns unknown for an unrecorded diet rather than guessing", () => {
    for (const s of ["", "   ", null, undefined, "Other", "flexitarian"]) {
      expect(normaliseDiet(s)).toBe("unknown");
    }
  });
});

describe("meal slot", () => {
  it("maps the hour to the meal a photo most likely belongs to", () => {
    expect(slotForHour(8)).toBe("breakfast");
    expect(slotForHour(13)).toBe("lunch");
    expect(slotForHour(17)).toBe("snack");
    expect(slotForHour(21)).toBe("dinner");
  });
});

describe("the neutral line", () => {
  it("says nothing about the food itself", () => {
    // It is sent for "can't tell" AND for a safety flag. Any hint about the
    // meal would make those two distinguishable, and the client would learn
    // to read the silence.
    for (const word of ["plan", "avoid", "wrong", "sure", "but", "however"]) {
      expect(NEUTRAL_LINE.toLowerCase()).not.toContain(word);
    }
  });
});

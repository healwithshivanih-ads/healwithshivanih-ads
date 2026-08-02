/**
 * How an ingredient reads on a client's meal card.
 *
 * Found in a library-wide sweep (2026-08-02) prompted by the coach opening a
 * client's meal card: of 4,087 ingredient lines, ~800 rendered as machine
 * output because `qty`/`unit`/`item` were being concatenated blind —
 * "10 leaves curry leaves", "1 piece onion, chopped", "to taste salt",
 * "2 clove garlic".
 *
 * The three fields cannot be flattened in the DATA: the recipe overlay scales
 * servings by multiplying `qty`. So the wording is fixed at render time, and
 * both render paths (the flat list in client-app.ts and the scaled list in
 * ochre-overlays.tsx) go through this one helper so they can never drift.
 */
import { describe, it, expect } from "vitest";
import { formatIngredientChip } from "./ingredient-chip";

const chip = formatIngredientChip;

describe("formatIngredientChip", () => {
  it("leaves an ordinary measured line alone", () => {
    expect(chip("1", "tsp", "ajwain (carom seeds)")).toBe("1 tsp ajwain (carom seeds)");
    expect(chip("400", "g", "mixed winter greens")).toBe("400 g mixed winter greens");
    expect(chip("", "", "3 eggs")).toBe("3 eggs");
  });

  it("drops a unit the item already says", () => {
    expect(chip("8-10", "leaves", "curry leaves")).toBe("8-10 curry leaves");
    expect(chip("2", "whole", "whole cloves (optional)")).toBe("2 whole cloves (optional)");
    expect(chip("2-3", "cubes", "ice cubes to thicken")).toBe("2-3 ice cubes to thicken");
    expect(chip("1", "lime", "lime juice (from 1 lime)")).toBe("1 lime juice (from 1 lime)");
  });

  it("drops units that count nothing once the item names the food", () => {
    expect(chip("1", "piece", "onion, finely chopped")).toBe("1 onion, finely chopped");
    expect(chip("2", "piece", "potato, cubed small")).toBe("2 potato, cubed small");
  });

  it("makes a counting unit agree with its number", () => {
    expect(chip("2", "clove", "garlic")).toBe("2 cloves garlic");
    expect(chip("4", "slice", "whole-wheat bread")).toBe("4 slices whole-wheat bread");
    expect(chip("1", "clove", "garlic")).toBe("1 clove garlic");
  });

  it("puts a written-out quantity after the food, where a person would say it", () => {
    expect(chip("to taste", "", "salt")).toBe("salt, to taste");
    expect(chip("as needed", "", "warm water")).toBe("warm water, as needed");
  });

  it("rescues an instruction that was stored in the unit field", () => {
    // "1 to taste salt and pepper" — the qty was invented to fill the slot
    expect(chip("1", "to taste", "salt and pepper")).toBe("salt and pepper, to taste");
    expect(chip("1", "tsp, or to taste", "salt")).toBe("1 tsp salt, to taste");
  });

  it("never drops a real measure just because the item repeats the word", () => {
    // caught by the library sweep: dropping the unit here lost the amount the
    // client actually has to measure out
    expect(chip("1.5", "tbsp", "red miso dissolved in 1 tbsp hot water"))
      .toBe("1.5 tbsp red miso dissolved in 1 tbsp hot water");
    expect(chip("1", "tsp", "licorice root powder (or 2 tsp chopped licorice root)"))
      .toBe("1 tsp licorice root powder (or 2 tsp chopped licorice root)");
    // the measure is buried inside a compound unit
    expect(chip("1.5", "tbsp (or 3 tbsp loose)", "Indian-style fine tea dust or loose leaf black tea"))
      .toBe("1.5 tbsp (or 3 tbsp loose) Indian-style fine tea dust or loose leaf black tea");
    expect(chip("1", "cup packed", "chopped kale")).toBe("1 cup packed chopped kale");
  });

  it("still clears a stutter hidden in a multi-word unit", () => {
    expect(chip("0.5", "small lime", "lime juice")).toBe("0.5 lime juice");
    expect(chip("4", "large leaves", "fresh basil leaves")).toBe("4 fresh basil leaves");
  });

  it("does not say 'to taste' twice", () => {
    expect(chip("1", "to taste", "sea salt and ground black pepper to taste"))
      .toBe("sea salt and ground black pepper to taste");
  });

  it("never emits a chip for an ingredient with no name", () => {
    expect(chip("1", "cup", "")).toBe("");
  });

  it("keeps a scaled quantity intact (the overlay's serving scaler)", () => {
    expect(chip("1½", "cup", "besan (chickpea flour)")).toBe("1½ cup besan (chickpea flour)");
  });
});

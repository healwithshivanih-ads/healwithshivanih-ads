/**
 * Negated mentions must not read as the food being present.
 *
 * Found 2026-07-28 while checking the read-time pack gate against real client
 * data: cl-004 is Jain with `foods_to_avoid: "Onion, Garlic"`, and the gate
 * deleted her pack's "Paneer Tikka (No-Onion-Garlic Marinade)" — the one
 * recipe authored specifically to satisfy her restriction — because the title
 * contains the word "onion". A personalised recipe names a food precisely
 * when it is promising to leave it out, so a blob scan reads compliance as
 * contamination and throws away the safest dish on the shelf.
 */
import { describe, it, expect } from "vitest";
import { buildAvoidFilter, onlyNegatedMentions } from "./foods-to-avoid";

const rec = (title: string, ingredients: string[] = [], method: string[] = []) => ({
  title,
  ingredients,
  method,
});

describe("onlyNegatedMentions", () => {
  it("negated by a preceding no/without/omit", () => {
    for (const s of [
      "paneer tikka (no-onion-garlic marinade)",
      "sambar — no onion-garlic",
      "omit onion and garlic entirely for jain compliance",
      "cooked without onion",
      "skip onion if you prefer",
    ])
      expect(onlyNegatedMentions(s, "onion"), s).toBe(true);
  });

  it("negated by a trailing -free", () => {
    expect(onlyNegatedMentions("onion-free chutney", "onion")).toBe(true);
    expect(onlyNegatedMentions("garlic free base", "garlic")).toBe(true);
  });

  it("a real use is NOT negated", () => {
    for (const s of ["onion 30 g, diced", "add the onion and sauté", "¼ cup onion, finely chopped"])
      expect(onlyNegatedMentions(s, "onion"), s).toBe(false);
  });

  it("one real use anywhere outvotes a negated one", () => {
    // the strictness that keeps this safe
    expect(onlyNegatedMentions("no garlic, onion 30 g", "onion")).toBe(false);
  });

  it("intervening words disqualify the negator", () => {
    // "no oil, onion" is NOT a promise to omit onion — oil is not an avoided food
    expect(onlyNegatedMentions("no oil, onion 30 g", "onion", ["onion", "garlic"])).toBe(false);
  });

  it("the negator reaches across OTHER avoided foods", () => {
    // "no-onion-garlic": the `no` must carry through onion to reach garlic
    expect(onlyNegatedMentions("paneer tikka (no-onion-garlic marinade)", "garlic", ["onion", "garlic"])).toBe(true);
    expect(onlyNegatedMentions("omit onion and garlic entirely", "garlic", ["onion", "garlic"])).toBe(true);
  });

  it("absent token is not 'only negated'", () => {
    expect(onlyNegatedMentions("paneer and capsicum", "onion")).toBe(false);
  });
});

describe("buildAvoidFilter respects negation", () => {
  const jain = buildAvoidFilter("Onion, Garlic");

  it("keeps the recipe written to comply", () => {
    expect(jain.safe(rec("Paneer Tikka (No-Onion-Garlic Marinade)", ["paneer 100 g", "yoghurt 2 tbsp"]))).toBe(true);
    expect(jain.safe(rec("Sambar — no onion-garlic", ["toor dal 1/2 cup"]))).toBe(true);
  });

  it("still drops a recipe that really uses it", () => {
    expect(jain.safe(rec("Chana masala", ["onion 30 g, chopped", "chana 1 cup"]))).toBe(false);
    expect(jain.safe(rec("Garlic rasam", ["garlic 6 cloves"]))).toBe(false);
  });

  it("a compliant title with a non-compliant ingredient is still dropped", () => {
    // the honesty check — the title claims no onion, the ingredients disagree
    expect(jain.safe(rec("Paneer tikka (no-onion marinade)", ["onion 20 g, sliced"]))).toBe(false);
  });
});

describe("category proxies vs a recipe's own diet tag", () => {
  const noWheat = buildAvoidFilter("Brinjal, Rice, Wheat");
  const gf = buildAvoidFilter("Gluten (wheat/atta/maida, barley, rye)");

  const jowarRoti = {
    title: "Jowar roti",
    ingredients: ["jowar (sorghum) flour", "hot water", "salt"],
    method: ["Knead with hot water.", "Roll and cook on a tawa."],
    diet: ["vegetarian", "vegan", "gluten_free"],
  };

  it("a gluten_free roti survives a wheat/gluten avoid", () => {
    // "roti" is only in the token list as a gluten PROXY
    expect(noWheat.safe(jowarRoti)).toBe(true);
    expect(gf.safe(jowarRoti)).toBe(true);
  });

  it("a wheat roti is still dropped", () => {
    expect(
      gf.safe({ title: "Roti", ingredients: ["whole wheat atta 1 cup", "water"], diet: ["vegetarian"] }),
    ).toBe(false);
  });

  it("an untagged roti is still dropped (no claim, no gluten-free grain)", () => {
    expect(gf.safe({ title: "Roti", ingredients: ["flour", "water"] })).toBe(false);
  });

  it("naming a gluten-free grain clears a form word even with no diet tag", () => {
    // the client's markdown pack has no diet tags at all — cl-009's "Jowar
    // Roti" lives there, and she is strictly gluten-free
    expect(gf.safe({ title: "Soft Jowar Roti", ingredients: ["jowar flour 1 cup", "hot water"] })).toBe(true);
    expect(gf.safe({ title: "Ragi dosa", ingredients: ["ragi flour", "water"] })).toBe(true);
  });

  it("a gluten grain still convicts regardless of form", () => {
    // "wheat"/"atta" are GRAIN members, not form proxies — never exonerated
    expect(gf.safe({ title: "Jowar-atta mix roti", ingredients: ["jowar flour", "wheat atta 1/2 cup"] })).toBe(false);
  });

  it("a literally-typed word is NOT exonerated by a diet tag", () => {
    // coach wrote "roti" herself — take her at her word
    expect(buildAvoidFilter("Roti").safe(jowarRoti)).toBe(false);
  });
});

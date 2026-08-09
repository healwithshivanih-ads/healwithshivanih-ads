/**
 * Tests for parseRecipes — the recipe sidecar (markdown) → the cards the client
 * opens from a menu slot.
 *
 * Three shapes have to parse, and two of them exist because a real client's
 * recipes silently vanished:
 *
 *   structured   — **Ingredients:** bullets + **Method:** numbered steps
 *   loose (⭐)    — bold group headers, bare bullets, method as PROSE
 *   prose-rescue — labelled ingredients BUT an unnumbered prose method
 *
 * The failure mode is always silent: the card renders with an empty "How to
 * make it" and nobody finds out until a client says so.
 */
import { describe, it, expect } from "vitest";
import { parseRecipes } from "./client-app";

describe("parseRecipes — the recipe marker", () => {
  it("accepts all three markers letter generations have drifted across", () => {
    // ⭐-era sidecars parsed to ZERO recipes, so a client's dishes had no
    // methods and the recipe pack vanished entirely (2026-06-11).
    for (const mark of ["✦", "✨", "⭐"]) {
      const md = `### ${mark} Poha\n**Ingredients:**\n- Poha 1 cup\n**Method:**\n1. Rinse it.`;
      const r = parseRecipes(md);
      expect(r, mark).toHaveLength(1);
      expect(r[0].title, mark).toBe("Poha");
    }
  });

  it("returns nothing for markdown with no recipe headings", () => {
    expect(parseRecipes("## Week 1\nSome prose.")).toEqual([]);
    expect(parseRecipes("")).toEqual([]);
  });

  it("parses several recipes from one sidecar", () => {
    const md = `### ✦ Poha\n**Ingredients:**\n- Poha\n### ✦ Upma\n**Ingredients:**\n- Rava`;
    expect(parseRecipes(md).map((r) => r.title)).toEqual(["Poha", "Upma"]);
  });
});

describe("parseRecipes — the structured shape", () => {
  const md = [
    "### ✦ Moong Dal Chilla",
    "**Serves:** 2 | **Time:** 20 min",
    "**Ingredients:**",
    "- 1 cup moong dal",
    "- 1 tsp ginger",
    "**Method:**",
    "1. Soak the dal.",
    "2. Grind to a batter.",
    "**Tip:** Don't rest the batter long.",
  ].join("\n");

  it("reads title, serves and time", () => {
    const [r] = parseRecipes(md);
    expect(r.title).toBe("Moong Dal Chilla");
    expect(r.serves).toBe("2");
    expect(r.time).toBe("20 min");
  });

  it("reads the ingredients and strips the bullet", () => {
    expect(parseRecipes(md)[0].ingredients).toEqual(["1 cup moong dal", "1 tsp ginger"]);
  });

  it("reads the method and strips the numbering", () => {
    expect(parseRecipes(md)[0].method).toEqual(["Soak the dal.", "Grind to a batter."]);
  });

  it("reads the tip", () => {
    expect(parseRecipes(md)[0].tip).toBe("Don't rest the batter long.");
  });

  it("labels the steps of a multi-part dish by their group", () => {
    const multi = [
      "### ✦ Eggs with Ragi Roti",
      "**Method (Eggs):**",
      "1. Beat them.",
      "**Method (Ragi Roti):**",
      "1. Knead the dough.",
      "2. Roll it thin.",
    ].join("\n");
    expect(parseRecipes(multi)[0].method).toEqual([
      "Eggs: Beat them.",
      "Ragi Roti: Knead the dough.",
      "Roll it thin.",
    ]);
  });

  it("does NOT prefix groups when the dish has only one method block", () => {
    const single = "### ✦ Poha\n**Method (Poha):**\n1. Rinse it.";
    expect(parseRecipes(single)[0].method).toEqual(["Rinse it."]);
  });

  it("stops at the next heading rather than bleeding into it", () => {
    const md2 = "### ✦ Poha\n**Method:**\n1. Rinse it.\n## Appendix\n1. Not a step.";
    expect(parseRecipes(md2)[0].method).toEqual(["Rinse it."]);
  });
});

describe("parseRecipes — the loose ⭐-era shape", () => {
  const md = [
    "### ⭐ Jowar Bhakri",
    "**For the bhakri:**",
    "- 1 cup jowar flour",
    "• Warm water",
    "Knead the flour with warm water into a soft dough and rest it briefly before rolling.",
  ].join("\n");

  it("renders a bold group header as a labelled divider", () => {
    expect(parseRecipes(md)[0].ingredients[0]).toBe("— For the bhakri —");
  });

  it("accepts both bullet characters", () => {
    const ing = parseRecipes(md)[0].ingredients;
    expect(ing).toContain("1 cup jowar flour");
    expect(ing).toContain("Warm water");
  });

  it("promotes a prose paragraph to a method step", () => {
    expect(parseRecipes(md)[0].method).toHaveLength(1);
    expect(parseRecipes(md)[0].method[0]).toMatch(/^Knead the flour/);
  });
});

describe("parseRecipes — the prose-method rescue", () => {
  // The ⭐-era letters label their ingredients but write the method as a bare
  // paragraph. The structured pass found the ingredients, so the loose
  // fallback (guarded on BOTH being empty) never ran and the method was
  // dropped silently — cl-004's Foxtail Millet Upma rendered as an ingredient
  // list with nothing under "How to make it" (2026-07-28).
  const md = [
    "### ⭐ Foxtail Millet Upma",
    "A cooling, no-cook assembly that keeps well through a warm afternoon.",
    "**Ingredients (1 serving):**",
    "- 1/2 cup foxtail millet",
    "- 1 tsp mustard seeds",
    "Roast the millet lightly, then temper the mustard seeds in ghee and fold everything together.",
  ].join("\n");

  it("recovers the method a labelled-ingredients recipe would otherwise lose", () => {
    const [r] = parseRecipes(md);
    expect(r.ingredients).toHaveLength(2);
    expect(r.method).toHaveLength(1);
    expect(r.method[0]).toMatch(/^Roast the millet/);
  });

  it("NEVER presents the opening blurb as step 1", () => {
    // It reads from after the LAST ingredient only — scanning the whole body
    // would hand the client "A cooling, no-cook assembly…" as an instruction.
    expect(parseRecipes(md)[0].method.join(" ")).not.toMatch(/cooling, no-cook/);
  });

  it("does not fire when a real Method block already exists", () => {
    const withMethod = [
      "### ✦ Upma",
      "**Ingredients:**",
      "- Rava",
      "**Method:**",
      "1. Roast it.",
      "Some trailing prose that is long enough to look like a step.",
    ].join("\n");
    expect(parseRecipes(withMethod)[0].method).toEqual(["Roast it."]);
  });

  it("ignores short lines, which are structure rather than instruction", () => {
    const short = "### ⭐ Poha\n**Ingredients:**\n- Poha\nServe hot.";
    expect(parseRecipes(short)[0].method).toEqual([]);
  });
});

describe("parseRecipes — degenerate input", () => {
  it("survives a recipe with a title and nothing else", () => {
    const [r] = parseRecipes("### ✦ Just A Title");
    expect(r.title).toBe("Just A Title");
    expect(r.ingredients).toEqual([]);
    expect(r.method).toEqual([]);
    expect(r.serves).toBeUndefined();
  });

  it("leaves serves/time undefined when the meta line is absent", () => {
    const [r] = parseRecipes("### ✦ Poha\n**Ingredients:**\n- Poha");
    expect(r.serves).toBeUndefined();
    expect(r.time).toBeUndefined();
  });
});

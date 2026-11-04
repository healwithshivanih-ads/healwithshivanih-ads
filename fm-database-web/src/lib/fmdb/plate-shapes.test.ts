/**
 * Plate shapes — which plate a plan gets, and that the chips respect the record.
 *
 * The two cases that caused this module: cl-004 (low-histamine plan, was told
 * to have curd most days) and cl-906 (milk-protein allergy, got "Curd / dahi ·
 * Buttermilk" fallback chips). Both are pinned here.
 */
import { describe, it, expect } from "vitest";
import { resolveDairy } from "./dairy-reaction";
import {
  PLATE_SHAPES,
  SHAPE_DEFS,
  PROTOCOL_PLATE,
  GUIDED_PLATE,
  buildPlate,
  fractionGlyph,
  resolvePlateShape,
} from "./plate-shapes";

const noDairyIssue = { dairy: null, avoidTerms: [], addShort: [] as string[] };

describe("resolvePlateShape — fallback chain", () => {
  it("the coach's pin wins over everything", () => {
    expect(
      resolvePlateShape({ plateShape: "anti_inflammatory", attachedProtocols: ["5r-gut-protocol"], pattern: "low-glycaemic" }),
    ).toEqual({ shape: "anti_inflammatory", source: "plan", holdFerments: false });
  });
  it("an attached protocol beats the pattern text", () => {
    expect(resolvePlateShape({ attachedProtocols: ["5r-gut-protocol"], pattern: "Gluten-free vegetarian, protein at every meal" })).toEqual({
      shape: "gut_soothing",
      source: "protocol",
      holdFerments: false,
    });
    expect(resolvePlateShape({ attachedProtocols: ["h-pylori-protocol", "blood-sugar-regulation"], pattern: "" }).shape).toBe("gut_soothing");
  });
  it("histamine outranks every other keyword in the pattern", () => {
    expect(resolvePlateShape({ pattern: "Anti-inflammatory, gut-supportive, hormone-balancing, LOW-HISTAMINE — Vegetarian Jain" })).toEqual({
      shape: "low_histamine",
      source: "pattern",
      holdFerments: true,
    });
  });
  it("cl-006: a histamine brief holds the ferments on whatever shape wins", () => {
    const r = resolvePlateShape({
      attachedProtocols: ["blood-sugar-regulation", "mcas-gentle-first-30-days"],
      pattern: "Low-glycaemic AND low-histamine non-veg reset",
    });
    expect(r).toEqual({ shape: "blood_sugar", source: "protocol", holdFerments: true });
    const b = buildPlate(r.shape, { dairy: null, avoidTerms: [], addShort: ["Curd"], holdFerments: r.holdFerments });
    expect(b.accents.map((a) => a.key)).toEqual(["fats"]);
    expect(b.eatOrder.length).toBe(3);
  });
  it("'gut-supportive' / 'gut-healing' as one adjective is not the cooked-only gut plate", () => {
    expect(resolvePlateShape({ pattern: "Gut-supportive anti-inflammatory with thyroid-friendly foods" }).shape).toBe("anti_inflammatory");
    expect(resolvePlateShape({ pattern: "STRICTLY GLUTEN-FREE. Thyroid-supportive, anti-inflammatory, iron-rich vegetarian, gut-healing" }).shape).toBe(
      "anti_inflammatory",
    );
  });
  it("reads the live plans' patterns the way the coach would", () => {
    const cases: [string, string][] = [
      ["Low-glycaemic anti-inflammatory with gut-repair focus", "blood_sugar"],
      ["Blood-sugar-stabilising vegetarian protein-anchored. Three meals, no liquid carbs", "blood_sugar"],
      ["Warm, cooked, easy-to-digest, anti-inflammatory — manda agni protocol with gut-repair emphasis", "gut_soothing"],
      ["Protein-anchored, lower-glycaemic, Mediterranean-leaning — steadying, NOT restrictive.", "blood_sugar"],
      ["Anti-inflammatory vegetarian, protein-forward, iron- and methylation-supportive", "blood_sugar"],
      ["Moderate-protein, low-refined-carb, blood-pressure-aware eating", "blood_sugar"],
      ["Mediterranean-style, whole food", "anti_inflammatory"],
      ["gentle anti-inflammatory", "anti_inflammatory"],
    ];
    for (const [pattern, shape] of cases) expect(resolvePlateShape({ pattern }).shape, pattern).toBe(shape);
  });
  it("a maintenance plan with no other signal gets the maintenance plate; otherwise balanced", () => {
    expect(resolvePlateShape({ isMaintenance: true, pattern: "Indian home cooking, built around the family" })).toEqual({
      shape: "maintenance",
      source: "maintenance",
      holdFerments: false,
    });
    expect(resolvePlateShape({})).toEqual({ shape: "balanced", source: "default", holdFerments: false });
  });
  it("ignores junk in the pin and unknown protocols", () => {
    expect(resolvePlateShape({ plateShape: "keto", attachedProtocols: ["adrenal-recovery-protocol"] }).shape).toBe("balanced");
  });
  it("every mapped protocol / programme resolves to a real shape", () => {
    for (const v of [...Object.values(PROTOCOL_PLATE), ...Object.values(GUIDED_PLATE)]) expect(PLATE_SHAPES).toContain(v);
  });
});

describe("shape definitions", () => {
  it("wedges always sum to a whole plate and every shape has three", () => {
    for (const k of PLATE_SHAPES) {
      const sum = SHAPE_DEFS[k].wedges.reduce((a, w) => a + w.pct, 0);
      expect(sum, k).toBeGreaterThanOrEqual(99);
      expect(sum, k).toBeLessThanOrEqual(101);
      expect(SHAPE_DEFS[k].wedges.map((w) => w.key)).toEqual(["veg", "protein", "carb"]);
      for (const w of SHAPE_DEFS[k].wedges) expect(fractionGlyph(w.pct), `${k}/${w.key}`).not.toBe("");
    }
  });
  it("gut-soothing and low-histamine hold the ferments back; the rest show them", () => {
    expect(SHAPE_DEFS.gut_soothing.ferments).toBe(false);
    expect(SHAPE_DEFS.low_histamine.ferments).toBe(false);
    expect(SHAPE_DEFS.balanced.ferments).toBe(true);
    expect(SHAPE_DEFS.blood_sugar.eatOrder).toEqual(["Vegetables", "Protein", "Carbs"]);
  });
  it("no client-facing line names grams, percentages or a diagnosis", () => {
    const bad = /\d+\s?g\b|%|diabet|hashimoto|pcos|disease/i;
    for (const k of PLATE_SHAPES) {
      const d = SHAPE_DEFS[k];
      expect(d.clientLine, k).not.toMatch(bad);
      for (const w of d.wedges) expect(w.note, `${k}/${w.key}`).not.toMatch(bad);
    }
  });
});

describe("buildPlate — the record filters the chips", () => {
  it("cl-004: a low-histamine plan shows no fermented accent at all", () => {
    const b = buildPlate("low_histamine", { ...noDairyIssue, addShort: ["Curd", "Palak"] });
    expect(b.accents.map((a) => a.key)).toEqual(["fats"]);
    expect(b.plate.flatMap((w) => w.examples).join(" ")).not.toMatch(/ferment/i);
  });
  it("cl-906: milk-protein allergy gets no dairy chip anywhere, and no ghee", () => {
    const dairy = resolveDairy({ known_allergies: ["Milk"], dairy_reaction_type: "milk_protein_allergy" });
    const b = buildPlate("balanced", { addShort: [], dietPref: "vegetarian", dairy, avoidTerms: ["Milk"] });
    const all = [...b.plate, ...b.accents].flatMap((x) => [...x.examples, x.note]).join(" ");
    expect(all).not.toMatch(/curd|dahi|paneer|buttermilk|ghee|\bmilk\b/i);
    const ferments = b.accents.find((a) => a.key === "ferments");
    expect(ferments?.examples).toEqual(["Kanji", "Idli / dosa batter", "Fermented rice"]);
    expect(b.plate[1].examples).toEqual(["Dal & legumes", "Sprouts", "Nuts & seeds"]);
  });
  it("an unrecorded dairy word is treated as an allergy (unsure = allergy until confirmed)", () => {
    const dairy = resolveDairy({ known_allergies: ["Milk"] });
    const b = buildPlate("balanced", { addShort: ["Curd", "Moong dal"], dietPref: "", dairy, avoidTerms: ["Milk"] });
    expect(b.plate[1].examples).toEqual(["Moong dal"]);
  });
  it("lactose intolerance keeps curd, buttermilk and ghee", () => {
    const dairy = resolveDairy({ known_allergies: ["Milk"], dairy_reaction_type: "lactose_intolerance" });
    const b = buildPlate("balanced", { addShort: [], dietPref: "vegetarian", dairy, avoidTerms: [] });
    expect(b.accents.find((a) => a.key === "ferments")?.examples).toEqual(["Curd / dahi", "Buttermilk"]);
    expect(b.accents[0].examples).toContain("Ghee");
  });
  it("foods_to_avoid and allergies drop matching chips, word-level, both directions", () => {
    const b = buildPlate("anti_inflammatory", {
      ...noDairyIssue,
      addShort: ["Walnuts", "Flax seeds", "Ragi", "Brown rice", "Palak"],
      avoidTerms: ["nuts", "Rice"],
    });
    expect(b.accents[0].examples).toEqual(["Flax seeds"]);
    expect(b.plate[2].examples).toEqual(["Ragi"]);
    // fallback lists are filtered too
    const c = buildPlate("balanced", { ...noDairyIssue, avoidTerms: ["Leafy greens", "millet"] });
    expect(c.plate[0].examples).toEqual(["Seasonal sabzi", "Salad vegetables"]);
    expect(c.plate[2].examples).toEqual(["Whole grains"]);
  });
  it("cl-900: 'Pumpkin seeds and almonds' is a fat chip, never a vegetable chip", () => {
    const b = buildPlate("blood_sugar", { ...noDairyIssue, addShort: ["Leafy greens daily", "Pumpkin seeds and almonds, a small handful"] });
    expect(b.plate[0].examples).toEqual(["Leafy greens daily"]);
    expect(b.accents[0].examples).toEqual(["Pumpkin seeds and almonds, a small handful"]);
  });
  it("gut-soothing drops raw salad from the vegetable chips", () => {
    const b = buildPlate("gut_soothing", { ...noDairyIssue, addShort: ["Salad vegetables", "Lauki", "Raw cucumber"] });
    expect(b.plate[0].examples).toEqual(["Lauki"]);
    const c = buildPlate("gut_soothing", noDairyIssue);
    expect(c.plate[0].examples.join(" ")).not.toMatch(/salad|raw/i);
  });
  it("non-veg and egg preferences widen the protein fallback; vegan narrows it", () => {
    expect(buildPlate("balanced", { ...noDairyIssue, dietPref: "non-vegetarian" }).plate[1].examples).toContain("Fish / chicken");
    expect(buildPlate("balanced", { ...noDairyIssue, dietPref: "eggetarian" }).plate[1].examples).toContain("Eggs");
    const vegan = buildPlate("balanced", { ...noDairyIssue, dietPref: "vegan" });
    expect(vegan.plate[1].examples.join(" ")).not.toMatch(/curd|paneer|egg|fish/i);
    expect(vegan.accents.find((a) => a.key === "ferments")?.examples).toEqual(["Kanji", "Idli / dosa batter", "Fermented rice"]);
  });
  it("the blood-sugar plate carries the eat order; others carry none", () => {
    expect(buildPlate("blood_sugar", noDairyIssue).eatOrder).toEqual(["Vegetables", "Protein", "Carbs"]);
    expect(buildPlate("balanced", noDairyIssue).eatOrder).toEqual([]);
  });
});

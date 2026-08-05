import { describe, it, expect } from "vitest";
import { detectPlanConflicts } from "./plan-conflicts";

/**
 * Rule 7 — the sicca screen. Sjogren's runs at ~17% in Hashimoto's and 37% of
 * autoimmune-thyroid clients meet xerostomia criteria, so dry mouth in that
 * group is a screening trigger rather than a comfort complaint.
 *
 * These fixtures are shaped from the real roster; the cl-022 case is the one
 * that motivated the rule and the one a naive implementation misses.
 */
const sicca = (c: Parameters<typeof detectPlanConflicts>[0]) =>
  detectPlanConflicts(c, null, []).filter((x) => x.kind === "sicca_screen");

describe("rule 7 — sicca screen", () => {
  it("fires as a warning on dry mouth + dry eyes with autoimmune thyroid disease", () => {
    // Shaped from cl-022: anti-TPO 128.1, dry mouth and dry eyes both recorded.
    const hits = sicca({
      active_conditions: [
        "Hashimoto's thyroiditis (euthyroid) — Anti-TPO 128.1, confirmed 23/7/2026",
        "Dry mouth",
        "Dry eyes",
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].summary).toContain("Dry mouth AND dry eyes");
    expect(hits[0].details).toContain("salivary flow");
    // The negative-panel caveat is load-bearing — seronegative disease is real.
    expect(hits[0].details).toContain("does not exclude");
  });

  it("still fires when intake chips say 'No concerns' but conditions say dry eyes", () => {
    // THE REGRESSION THIS RULE EXISTS FOR. cl-022 ticked eye_signs "No concerns"
    // at intake; "Dry eyes" was added to active_conditions months later when it
    // was confirmed. Reading only the chips misses exactly the target client.
    const hits = sicca({
      active_conditions: ["Hashimoto's thyroiditis", "Dry mouth", "Dry eyes"],
      oral_signs: ["dry mouth"],
      eye_signs: ["No concerns"],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
  });

  it("drops to info for dry mouth alone and prompts asking about the eyes", () => {
    // Shaped from cl-014: Hashimoto's + dry mouth, no dry eyes reported.
    const hits = sicca({
      active_conditions: ["Hashimoto's thyroiditis (autoimmune — anti-TPO 105)"],
      oral_signs: ["mouth breathing at night", "dry mouth"],
      eye_signs: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].details).toContain("gritty or burning eyes");
  });

  it("names a drying medication as the cheaper competing explanation", () => {
    const hits = sicca({
      active_conditions: ["Hashimoto's thyroiditis", "Dry mouth", "Dry eyes"],
      current_medications: ["Sertraline 50 mg", "Levocetirizine"],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].details).toContain("sertraline");
    expect(hits[0].details).toContain("drug-induced dry mouth");
  });

  it("holds at info and withholds the diagnosis when health anxiety is on file", () => {
    // Shaped from cl-021, whose illness phobia is documented. Naming a possible
    // autoimmune diagnosis unprompted would do more harm than the delay.
    const hits = sicca({
      active_conditions: [
        "Hashimoto's thyroiditis",
        "Dry mouth",
        "Dry eyes",
        "Health anxiety / illness phobia (fear of being diagnosed with a disease)",
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].summary).toContain("handle gently");
    expect(hits[0].details).toContain("naming a possible autoimmune");
    // The prevalence pitch must NOT reach a health-anxious client's record.
    expect(hits[0].details).not.toContain("Sjogren's syndrome occurs");
    expect(hits[0].suggested_fix?.action).toMatchObject({ type: "append_client_note" });
    expect(
      (hits[0].suggested_fix?.action as { text: string }).text,
    ).toContain("HEALTH ANXIETY ON FILE");
  });

  it("does not fire without an autoimmune thyroid signal", () => {
    // Dry mouth from medication alone is not a sicca screen.
    expect(sicca({ active_conditions: ["Hypothyroidism"], oral_signs: ["dry mouth"] })).toHaveLength(0);
  });

  it("does not fire on autoimmune thyroid disease without dry mouth", () => {
    // cl-004: Hashimoto's with bleeding gums and ulcers, but no dryness.
    expect(
      sicca({
        active_conditions: ["Hashimoto's thyroiditis (confirmed: elevated anti-TPO)"],
        oral_signs: ["bleeding gums", "recurrent mouth ulcers"],
      }),
    ).toHaveLength(0);
  });

  it("never suggests a plan or food change — only a client note", () => {
    const hits = sicca({
      active_conditions: ["Hashimoto's thyroiditis", "Dry mouth", "Dry eyes"],
    });
    expect(hits[0].suggested_fix?.action.type).toBe("append_client_note");
  });
});

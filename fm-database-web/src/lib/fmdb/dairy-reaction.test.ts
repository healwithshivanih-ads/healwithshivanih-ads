/**
 * Milk-protein allergy vs lactose intolerance — the TS mirror pinned to the
 * same cases as fm-database/tests/test_dairy_reaction.py. If the Python
 * derivation or signal changes, change both files.
 */
import { describe, it, expect } from "vitest";
import {
  dairyPromptLine,
  deriveDairyReactionType as D,
  hasDairySignal,
  resolveDairy,
} from "./dairy-reaction";
import { allergyPromptLine } from "./allergies";
import { detectPlanConflicts } from "./plan-conflicts";

const LACTOSE = { known_allergies: ["Milk"], dairy_reaction_type: "lactose_intolerance" };
const ALLERGY = { known_allergies: ["Milk"], dairy_reaction_type: "milk_protein_allergy" };
const CL906_SHAPE = { known_allergies: ["Milk"], foods_to_avoid: "Milk & mushroom causes allergy" };

describe("hasDairySignal", () => {
  it.each([
    ["Milk", true],
    ["Lactose intolerance", true],
    ["buttermilk", true],
    ["Milk & mushroom causes allergy", true],
    ["coconut milk", false],
    ["almond milk only", false],
    ["milk thistle", false],
    ["Peanuts", false],
    ["none", false],
  ])("%s → %s", (text, expected) => {
    expect(hasDairySignal(text)).toBe(expected);
  });
});

describe("deriveDairyReactionType (mirror of derive_dairy_reaction_type)", () => {
  it("nothing answered is null", () => {
    expect(D({ symptoms: [], timing: "", curd: "", paneer: "", ghee: "" })).toBeNull();
    expect(D({})).toBeNull();
  });
  it("any allergy sign wins even if curd is fine", () => {
    expect(D({ symptoms: ["bloating_gas", "hives_rash"], curd: "yes", paneer: "yes", ghee: "yes" })).toBe(
      "milk_protein_allergy",
    );
    expect(D({ symptoms: ["wheezing_breathless"] })).toBe("milk_protein_allergy");
  });
  it("gut-only with curd or paneer fine is lactose intolerance", () => {
    expect(
      D({ symptoms: ["bloating_gas", "loose_stools"], timing: "within_2_hours", curd: "yes", paneer: "unsure", ghee: "yes" }),
    ).toBe("lactose_intolerance");
    expect(D({ symptoms: ["stomach_cramps"], curd: "no", paneer: "yes" })).toBe("lactose_intolerance");
  });
  it("curd AND paneer, or ghee, reacting is a protein reaction", () => {
    expect(D({ symptoms: ["bloating_gas"], curd: "no", paneer: "no", ghee: "yes" })).toBe("milk_protein_allergy");
    expect(D({ symptoms: ["bloating_gas"], curd: "yes", paneer: "yes", ghee: "no" })).toBe("milk_protein_allergy");
  });
  it("gut-only with no tolerance evidence, or a contradiction, is unsure", () => {
    expect(D({ symptoms: ["bloating_gas"], timing: "within_2_hours", curd: "unsure", paneer: "unsure", ghee: "unsure" })).toBe(
      "unsure",
    );
    expect(D({ symptoms: ["bloating_gas"], curd: "yes", paneer: "no" })).toBe("unsure");
  });
});

describe("resolveDairy", () => {
  it("infers unsure from a dairy word with no type recorded", () => {
    expect(resolveDairy(CL906_SHAPE)).toEqual({ kind: "unsure", source: "inferred", gheeOk: true });
    expect(resolveDairy({ foods_to_avoid: "coconut milk is fine; brinjal" })).toBeNull();
    expect(resolveDairy({ known_allergies: ["Peanuts"] })).toBeNull();
  });
  it("ghee is out for a confirmed allergy unless the client said it's fine", () => {
    expect(resolveDairy(ALLERGY)?.gheeOk).toBe(false);
    expect(resolveDairy({ ...ALLERGY, tolerates_ghee: "yes" })?.gheeOk).toBe(true);
  });
});

describe("prompt lines", () => {
  it("say whey isolate is fine only for lactose intolerance", () => {
    expect(dairyPromptLine(LACTOSE)).toContain("whey ISOLATE are fine");
    expect(dairyPromptLine(ALLERGY)).toContain("ABSOLUTE");
    expect(dairyPromptLine(CL906_SHAPE)).toContain("never asked");
    expect(dairyPromptLine({ known_allergies: ["Peanuts"] })).toBe("");
  });
  it("allergyPromptLine takes lactose-intolerant milk off the absolute list", () => {
    const lac = allergyPromptLine(LACTOSE);
    expect(lac.split("Dairy:")[0]).not.toContain("Milk");
    expect(lac).toContain("LACTOSE INTOLERANCE");
    expect(allergyPromptLine(ALLERGY)).toContain("MILK-PROTEIN ALLERGY");
    expect(allergyPromptLine({ known_allergies: ["Peanuts"] })).not.toContain("Dairy:");
  });
});

describe("plan conflicts", () => {
  const kinds = (c: Parameters<typeof detectPlanConflicts>[0]) =>
    detectPlanConflicts(c, null).map((x) => x.kind);
  it("asks the coach to confirm an un-typed dairy reaction", () => {
    expect(kinds(CL906_SHAPE)).toContain("dairy_type_unconfirmed");
    expect(kinds(LACTOSE)).not.toContain("dairy_type_unconfirmed");
  });
  it("flags curd in the non-negotiables for an allergy, not for lactose intolerance", () => {
    expect(kinds({ ...ALLERGY, non_negotiables: "curd with lunch" })).toContain("dairy_allergy_vs_nonnegotiable");
    const lac = kinds({ ...LACTOSE, non_negotiables: "morning chai with milk, curd" });
    expect(lac).not.toContain("dairy_allergy_vs_nonnegotiable");
    expect(lac).not.toContain("allergy_vs_nonnegotiable");
  });
});

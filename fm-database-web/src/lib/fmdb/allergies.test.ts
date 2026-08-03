/**
 * An empty allergy list must not read as "no allergies known".
 *
 * Measured on the live roster 2026-08-03: `known_allergies` was non-empty on 1
 * record of 21, and that value was `['None']`. Every consumer — the meal-photo
 * check, the assessment gate's HARD allergen block, four letter prompts, the
 * handoff sheet, the SOAP note — read the empty list as a screened negative.
 * Two of those are safety checks, and both were passing everything by
 * construction.
 *
 * These tests pin the three states apart, and pin the one thing that is easy
 * to regress: `items` is empty for BOTH `none` and `unknown`, so any consumer
 * branching on `items.length` reintroduces the bug silently.
 */
import { describe, it, expect } from "vitest";
import {
  NO_KNOWN_ALLERGIES,
  allergyEmptyLabel,
  allergyPromptLine,
  resolveAllergies,
} from "./allergies";

describe("resolveAllergies", () => {
  it("reports unknown when nobody has asked", () => {
    expect(resolveAllergies({}).status).toBe("unknown");
    expect(resolveAllergies({ known_allergies: [] }).status).toBe("unknown");
    expect(resolveAllergies(null).status).toBe("unknown");
    expect(resolveAllergies(undefined).status).toBe("unknown");
  });

  it("reports none when the client answered none", () => {
    // cl-008's real value on the roster. It used to be discarded as junk.
    expect(resolveAllergies({ known_allergies: ["None"] }).status).toBe("none");
    for (const v of ["none", "NIL", "N/A", "no known allergies", "NKDA", "Nothing"]) {
      expect(resolveAllergies({ known_allergies: [v] }).status).toBe("none");
    }
  });

  it("round-trips the sentinel the intake form writes", () => {
    expect(resolveAllergies({ known_allergies: [NO_KNOWN_ALLERGIES] }).status).toBe("none");
  });

  it("reports declared for real allergens", () => {
    const r = resolveAllergies({ known_allergies: ["Peanuts", "shellfish"] });
    expect(r.status).toBe("declared");
    expect(r.items).toEqual(["Peanuts", "shellfish"]);
  });

  it("lets a real allergen win over a stray sentinel", () => {
    // ["none", "penicillin"] is a data-entry artefact, not a tie to break in
    // favour of safety-off.
    const r = resolveAllergies({ known_allergies: ["none", "penicillin"] });
    expect(r.status).toBe("declared");
    expect(r.items).toEqual(["penicillin"]);
  });

  it("never matches a sentinel as a substring", () => {
    // "none of the nuts" is a declaration, not a negative screen.
    expect(resolveAllergies({ known_allergies: ["none of the nuts"] }).status).toBe("declared");
    expect(resolveAllergies({ known_allergies: ["walnut"] }).status).toBe("declared");
  });

  it("reads the second field name", () => {
    // `updateClientProfile` takes `allergies` as its input key and writes
    // whichever key the file already has, so a record can exist down either
    // branch. All 21 live records use known_allergies; a single-name read
    // would still miss a future one.
    expect(resolveAllergies({ allergies: ["latex"] }).items).toEqual(["latex"]);
  });

  it("returns no items for none AND unknown alike", () => {
    // The invariant that stops `if (items.length)` reintroducing the bug.
    expect(resolveAllergies({ known_allergies: ["None"] }).items).toEqual([]);
    expect(resolveAllergies({}).items).toEqual([]);
  });
});

describe("allergyPromptLine", () => {
  it("never claims a screen that did not happen", () => {
    const line = allergyPromptLine({});
    expect(line).toMatch(/NOT RECORDED/);
    // The old fallback was literally "Allergies: none known".
    expect(line).not.toMatch(/none known/i);
  });

  it("distinguishes an answered none from an unasked question", () => {
    expect(allergyPromptLine({ known_allergies: ["None"] })).not.toEqual(allergyPromptLine({}));
    expect(allergyPromptLine({ known_allergies: ["None"] })).toMatch(/asked/);
  });

  it("marks declared allergens as absolute", () => {
    const line = allergyPromptLine({ known_allergies: ["peanut"] });
    expect(line).toMatch(/ABSOLUTE/);
    expect(line).toMatch(/peanut/);
  });

  it("always emits a line, so silence cannot read as clearance", () => {
    for (const c of [{}, { known_allergies: ["None"] }, { known_allergies: ["peanut"] }]) {
      expect(allergyPromptLine(c).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("allergyEmptyLabel", () => {
  it("only says 'None reported' when the client actually reported none", () => {
    expect(allergyEmptyLabel("none")).toMatch(/None reported/);
    expect(allergyEmptyLabel("unknown")).toMatch(/Not recorded/);
    expect(allergyEmptyLabel("unknown")).not.toMatch(/None reported/);
  });
});

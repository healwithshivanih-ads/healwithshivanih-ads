/**
 * Tests for the supplement-row matcher extracted from client-app.ts (#6).
 */
import { describe, it, expect } from "vitest";
import { suppKey, matchSupplementRow, type LetterSupplementRow } from "./client-app-supplements";

const row = (name: string): LetterSupplementRow => ({ name, dose: "", when: "", why: "" });

describe("suppKey", () => {
  it("strips parens, punctuation, case", () => {
    expect(suppKey("Vitamin B6 (P5P)")).toBe("vitamin b6");
    expect(suppKey("Omega-3 (EPA + DHA)")).toBe("omega 3");
  });
});

describe("matchSupplementRow", () => {
  const rows = [row("Magnesium Glycinate"), row("Vitamin D3"), row("Ashwagandha (KSM-66)")];

  it("matches exactly regardless of formatting", () => {
    expect(matchSupplementRow("magnesium glycinate", rows)?.name).toBe("Magnesium Glycinate");
    expect(matchSupplementRow("Ashwagandha KSM-66", rows)?.name).toBe("Ashwagandha (KSM-66)");
  });

  it("matches on partial token overlap", () => {
    expect(matchSupplementRow("Vitamin D3 5000 IU", rows)?.name).toBe("Vitamin D3");
  });

  it("returns undefined when nothing overlaps", () => {
    expect(matchSupplementRow("Zinc Picolinate", rows)).toBeUndefined();
  });
});

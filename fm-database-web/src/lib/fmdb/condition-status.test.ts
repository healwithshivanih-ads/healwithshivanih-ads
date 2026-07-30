/**
 * Retiring a condition must be reversible without mangling the coach's words.
 * The stamp is generated, so stripping it has to restore the original exactly
 * — otherwise "it came back" quietly rewrites her clinical wording.
 */
import { describe, it, expect } from "vitest";
import { isResolvedEntry, resolvedLabel, stripResolvedStamp } from "./condition-status";

const JUL = new Date("2026-07-30T00:00:00Z");

describe("resolvedLabel", () => {
  it("stamps the month it was retired", () => {
    expect(resolvedLabel("Constipation", JUL)).toBe("Constipation — resolved Jul 2026");
  });

  it("trims what the coach typed", () => {
    expect(resolvedLabel("  Constipation  ", JUL)).toBe("Constipation — resolved Jul 2026");
  });
});

describe("stripResolvedStamp — the round trip", () => {
  it("restores the exact original wording", () => {
    for (const c of [
      "Constipation",
      "Knee Injury / weak tendons",
      "Underactive thyroid (subclinical, non-autoimmune)",
      "Hypertension — ON TREATMENT (previously unreported) — Telma 40",
    ]) {
      expect(stripResolvedStamp(resolvedLabel(c, JUL))).toBe(c);
    }
  });

  it("leaves a hand-written history line alone", () => {
    for (const h of [
      "Appendectomy 2011",
      "Hashimoto's diagnosed 2018, antibodies normalised 2023",
      "Glandular fever at 17",
    ]) {
      expect(stripResolvedStamp(h)).toBe(h);
    }
  });

  it("does not eat an em-dash that is part of the condition", () => {
    const c = "Hypertension — ON TREATMENT";
    expect(stripResolvedStamp(c)).toBe(c);
  });
});

describe("isResolvedEntry", () => {
  it("recognises what we stamped, and only that", () => {
    expect(isResolvedEntry(resolvedLabel("Constipation", JUL))).toBe(true);
    expect(isResolvedEntry("Appendectomy 2011")).toBe(false);
    expect(isResolvedEntry("Hashimoto's, in remission since 2023")).toBe(false);
  });
});

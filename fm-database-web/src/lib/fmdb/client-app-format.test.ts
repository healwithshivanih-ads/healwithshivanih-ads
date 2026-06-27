/**
 * Tests for the pure client-app formatting helpers extracted from
 * client-app.ts (Codex audit #6). These lock the bug-prone bits that have
 * regressed before: veg-vs-non-veg classification, twice-daily timing labels,
 * and dose trimming.
 */
import { describe, it, expect } from "vitest";
import {
  isNonVegPref,
  isVegetarianPref,
  humanize,
  firstSentence,
  shortDose,
  timingRank,
  slotFromRank,
  shortTiming,
  displayTiming,
} from "./client-app-format";

describe("diet classification", () => {
  it("does NOT read 'non-vegetarian' as vegetarian (the historical bug)", () => {
    expect(isNonVegPref("non-vegetarian")).toBe(true);
    expect(isVegetarianPref("non-vegetarian")).toBe(false);
  });
  it("classifies plain vegetarian / vegan / jain", () => {
    for (const p of ["vegetarian", "vegan", "jain", "eggetarian"]) {
      expect(isVegetarianPref(p)).toBe(true);
      expect(isNonVegPref(p)).toBe(false);
    }
  });
  it("catches non-veg via specific foods", () => {
    for (const p of ["eats chicken", "pescatarian", "loves fish", "mutton biryani"]) {
      expect(isNonVegPref(p)).toBe(true);
    }
  });
});

describe("text helpers", () => {
  it("humanizes a slug", () => {
    expect(humanize("vitamin-d3")).toBe("Vitamin D3");
  });
  it("takes the first sentence", () => {
    expect(firstSentence("Take with food. Then rest.")).toBe("Take with food.");
  });
});

describe("shortDose", () => {
  it("passes normal ranges through untouched", () => {
    expect(shortDose("300-400mg")).toBe("300-400mg");
    expect(shortDose("1-2 capsules")).toBe("1-2 capsules");
  });
  it("pulls the leading quantity out of a coach titration note", () => {
    const out = shortDose(
      "TONOFERON LIQUID (Glenmark) — 7.5 ml ALTERNATE DAYS for 2 weeks then push to 15 ml daily",
    );
    expect(out).toBe("7.5 ml");
  });
});

describe("timing", () => {
  it("ranks chronologically: empty-stomach morning before bedtime", () => {
    expect(timingRank("on waking, empty stomach", "", true, false)).toBe(10);
    expect(timingRank("with breakfast", "", false, false)).toBe(20);
    expect(timingRank("bedtime", "", false, false)).toBe(70);
    expect(timingRank("as needed", "", false, true)).toBe(100);
  });
  it("collapses ranks into the 3 display slots", () => {
    expect(slotFromRank(10)).toBe("Morning");
    expect(slotFromRank(45)).toBe("With meals");
    expect(slotFromRank(70)).toBe("Bedtime");
  });
  it("shows BOTH times for a twice-daily timing joined by 'and'", () => {
    expect(displayTiming("morning and evening")).toBe("Morning & evening");
    expect(displayTiming("with lunch and dinner")).toBe("With lunch & dinner");
  });
  it("documents the latent quirk: '&'/'+' separators do NOT trigger the split", () => {
    // The guard /\b(and|&|\+)\b/ only ever fires on the WORD 'and' — there is no
    // word boundary around '&' or '+', so a coach who writes "lunch & dinner"
    // gets just the base label. Preserved verbatim in the extraction; worth a
    // separate fix (broaden the separator) but out of scope for the refactor.
    expect(displayTiming("with lunch & dinner")).toBe("With lunch");
  });
  it("leaves a single-phrase range to shortTiming (no false split)", () => {
    expect(displayTiming("between breakfast and lunch")).toBe(shortTiming("between breakfast and lunch"));
  });
});

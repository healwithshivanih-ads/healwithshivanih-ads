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
  it("collapses a whole-day-window sentence to a short pill token", () => {
    // Regression: PHGG timing was a full sentence → badge blew out and crushed
    // the supplement name to one word per line.
    expect(displayTiming("Once daily in plain water at any time of day; tasteless and clear")).toBe("Anytime");
    expect(shortTiming("any time of day")).toBe("Anytime");
  });
  it("keeps only the clock time from a verbose timing", () => {
    expect(displayTiming("Around 3 pm — see rationale for spacing rules")).toBe("3 pm");
    expect(shortTiming("take at 8 am with water")).toBe("8 am");
  });
  it("does not split a descriptive 'and' tail into a fake second time", () => {
    expect(displayTiming("with breakfast, tasteless and clear")).toBe("With breakfast");
  });
});

describe("bedtime phrasings", () => {
  // Magnesium glycinate timed "Before Bed" ranked 25 (the unknown-default) and
  // rendered in the app's MORNING slot, beside breakfast. The cue regex tested
  // /bedtime|before sleep|at night|\bnight\b/ — no bed alternative at all.
  it("ranks every bed phrasing the coach actually writes as Bedtime", () => {
    for (const t of ["Before Bed", "before bed", "1 hour before bed", "take before bed", "30 min before bed", "pre-bed"]) {
      expect(timingRank(t, "", false, false), t).toBe(70);
      expect(slotFromRank(timingRank(t, "", false, false)), t).toBe("Bedtime");
    }
  });
  it("still ranks the phrasings that already worked", () => {
    for (const t of ["bedtime", "at bedtime", "before bedtime", "at night", "before sleep", "each night", "last thing at night"]) {
      expect(timingRank(t, "", false, false), t).toBe(70);
    }
  });
  it("covers the other end-of-day phrasings that hit the same gap", () => {
    for (const t of ["on retiring", "nightly", "before you sleep"]) {
      expect(timingRank(t, "", false, false), t).toBe(70);
    }
  });
  it("does not fire on words that merely contain 'bed'", () => {
    for (const t of ["keep on the bedside table", "store in the bedroom", "embedded in the capsule"]) {
      expect(slotFromRank(timingRank(t, "", false, false)), t).toBe("Morning");
    }
  });
  it("keeps dinner-adjacent phrasings at dinner, not bedtime", () => {
    for (const t of ["post-dinner", "after dinner", "with the evening meal"]) {
      expect(timingRank(t, "", false, false), t).toBe(60);
    }
  });
  it("anchors a two-dose timing at its EARLIEST dose, not the bedtime one", () => {
    expect(timingRank("morning and before bed", "", false, false)).toBe(20);
    expect(timingRank("breakfast and before bed", "", false, false)).toBe(20);
    expect(timingRank("on waking and on retiring", "", false, false)).toBe(10);
    expect(timingRank("with lunch and before bed", "", false, false)).toBe(40);
  });
  it("labels bed phrasings 'Bedtime' rather than echoing the raw text", () => {
    for (const t of ["before bed", "1 hour before bed", "pre-bed", "on retiring", "nightly"]) {
      expect(shortTiming(t), t).toBe("Bedtime");
    }
  });
  it("shows BOTH doses when the second one is a bed phrasing", () => {
    // isTimePhrase() omitted "bed", so the twice-daily split rejected the pair
    // and collapsed to "Morning" — hiding the bedtime dose from the client.
    expect(displayTiming("morning and before bed")).toBe("Morning & bedtime");
    expect(displayTiming("breakfast and before bed")).toBe("With breakfast & bedtime");
  });
});

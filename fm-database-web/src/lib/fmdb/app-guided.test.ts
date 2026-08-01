/**
 * `looksAppGuided` decides two things at once, which is why it earns tests:
 * whether a practice is ranked into the plan's foundation, and — because
 * `classifyPractice` short-circuits on `guided` — whether it counts as a
 * DEDICATED stopped moment in the load check.
 *
 * A false positive therefore does not just reorder a plan, it inflates the
 * number the coach uses to judge whether the plan is survivable.
 *
 * Cases are Hariharan's real practice names, which is where each miss showed up.
 */
import { describe, expect, it } from "vitest";

import { looksAppGuided } from "./app-guided";

describe("what the app actually guides", () => {
  it("counts a slug-linked practice, whatever it is called", () => {
    expect(looksAppGuided("Morning belly rhythm", "", "gastrocolic-rhythm")).toBe(true);
    expect(looksAppGuided("Something obscure", "", "some-slug")).toBe(true);
  });

  it("counts EFT even when only the details name it", () => {
    // deriveEft reads name + details, so this must too.
    expect(looksAppGuided("EFT tapping — a guided 2-minute round in the app")).toBe(true);
    expect(looksAppGuided("Anxiety reset", "two rounds of tapping when it spikes")).toBe(true);
  });

  it("counts a paced breathing practice", () => {
    expect(looksAppGuided("4-7-8 breathing — morning and before bed")).toBe(true);
  });

  it("does NOT count nasal breathing or mouth-taping", () => {
    // An all-day habit, not a paced session — deriveBreathwork skips it, and
    // calling it guided would also promote it to a dedicated stopped moment.
    expect(looksAppGuided("Nasal-only breathing — 10-min blocks + light mouth-tape at night")).toBe(false);
    expect(looksAppGuided("Nose breathing during walks")).toBe(false);
  });

  it("still counts a nasal-breathing entry that prescribes an actual count", () => {
    expect(looksAppGuided("Nasal breathing — 4-7-8 before bed")).toBe(true);
  });

  it("reads the sleep wind-down from the NAME only", () => {
    expect(looksAppGuided("Wind down for sleep")).toBe(true);
    // "wind down" turns up casually in other practices' details — matching
    // there would hand the sleep player to a breathing practice.
    expect(looksAppGuided("4-7-8 breathing", "…to wind down before bed")).toBe(true); // breath, not sleep
    expect(looksAppGuided("Hibiscus tea", "helps you wind down in the evening")).toBe(false);
  });

  it("leaves ordinary practices alone", () => {
    for (const n of [
      "Daily 20-30 minute walk — gentle to moderate pace",
      "Gratitude journaling — 3 things, handwritten",
      "Regular meal timing — breakfast by 8 AM",
      "Nasya — 2 drops warm sesame oil into each nostril each morning",
    ]) {
      expect(looksAppGuided(n), `${n} was treated as guided`).toBe(false);
    }
  });
});

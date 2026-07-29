/**
 * Meal swaps have to be calorie-aware, and most of all for a client eating to a
 * target. The list used to be the first three same-slot dishes in table order,
 * so the headline alternative to a 350 kcal lunch could be a 700 kcal one and
 * taking it spent the whole day's deficit without anything on screen saying so.
 */
import { describe, it, expect } from "vitest";
import { rankSwaps, swapDeltaLabel, type SwapCandidate } from "./swap-ranking";

const c = (name: string, kcal?: number): SwapCandidate => ({ name, note: "on your plan", kcal });

describe("rankSwaps", () => {
  const OPTIONS = [c("Heavy biryani", 700), c("Rajma chawal", 520), c("Moong khichdi", 360)];

  it("puts the like-for-like swap first", () => {
    const out = rankSwaps(OPTIONS, 350, false);
    expect(out.map((s) => s.name)).toEqual(["Moong khichdi", "Rajma chawal", "Heavy biryani"]);
  });

  it("carries each option's difference", () => {
    const out = rankSwaps(OPTIONS, 350, false);
    expect(out[0].kcalDelta).toBe(10);
    expect(out[2].kcalDelta).toBe(350);
  });

  // Against a 500 kcal meal: Rajma +20 (nothing in it), Heavy biryani +200
  // (materially more), Moong -140 (lighter).
  it("never lets a materially heavier option lead for a weight-loss client", () => {
    const out = rankSwaps([c("Heavy biryani", 700), c("Moong khichdi", 360)], 500, true);
    // biryani is +200 and khichdi -140, so on closeness alone the biryani would
    // still lose here — pin the rule with an option that WOULD have won:
    const tempting = rankSwaps([c("Just over", 620), c("Well under", 330)], 500, true);
    expect(tempting[0].name).toBe("Well under"); // -170 beats a flagged +120
    expect(tempting.find((s) => s.name === "Just over")?.heavier).toBe(true);
    expect(out[0].name).toBe("Moong khichdi");
  });

  it("still OFFERS the heavier option — it is on her plan", () => {
    const out = rankSwaps([c("Just over", 620), c("Well under", 330)], 500, true);
    expect(out.map((s) => s.name)).toContain("Just over");
  });

  it("ranks purely on closeness when the client has no calorie target", () => {
    const out = rankSwaps([c("Just over", 620), c("Well under", 330)], 500, false);
    expect(out[0].name).toBe("Just over"); // +120 is closer than -170
    expect(out[0].heavier).toBeUndefined(); // nothing to flag against
  });

  it("does not call a small rise heavy", () => {
    // 60 kcal on a 600 kcal meal is under the proportional bar; a client should
    // not be nudged away from a dish over a rounding error.
    const out = rankSwaps([c("Slightly more", 660)], 600, true);
    expect(out[0].heavier).toBeUndefined();
  });

  it("flags a small dish's big proportional rise", () => {
    const out = rankSwaps([c("Bigger snack", 300)], 150, true);
    expect(out[0].heavier).toBe(true);
  });

  it("keeps unknown-calorie options, ordered last and unlabelled", () => {
    const out = rankSwaps([c("Mystery"), c("Moong khichdi", 360)], 350, true);
    expect(out.map((s) => s.name)).toEqual(["Moong khichdi", "Mystery"]);
    expect(out[1].kcalDelta).toBeUndefined();
    expect(out[1].heavier).toBeUndefined();
  });

  it("says nothing when the meal's own calories are unknown", () => {
    const out = rankSwaps(OPTIONS, undefined, true);
    for (const s of out) {
      expect(s.kcalDelta).toBeUndefined();
      expect(s.heavier).toBeUndefined();
    }
    expect(out.map((s) => s.name)).toEqual(OPTIONS.map((s) => s.name)); // plan order
  });

  it("is stable — equal options keep the plan's own order", () => {
    const tied = [c("A", 400), c("B", 400), c("C", 400)];
    expect(rankSwaps(tied, 400, true).map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("still caps the list", () => {
    expect(rankSwaps([...OPTIONS, c("D", 400), c("E", 410)], 400, false)).toHaveLength(3);
  });
});

describe("swapDeltaLabel", () => {
  it("reads plainly", () => {
    expect(swapDeltaLabel(0)).toBe("about the same");
    expect(swapDeltaLabel(-15)).toBe("about the same");
    expect(swapDeltaLabel(-120)).toBe("120 kcal lighter");
    expect(swapDeltaLabel(200)).toBe("200 kcal more");
    expect(swapDeltaLabel(undefined)).toBeNull();
  });
});

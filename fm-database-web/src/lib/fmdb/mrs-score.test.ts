import { describe, it, expect } from "vitest";
import { computeMrsScore, MRS_ITEMS, MRS_SUBSCALE_MAX } from "./mrs-score";

const ALL_ZERO = Object.fromEntries(MRS_ITEMS.map((i) => [i.key, 0]));
const ALL_MAX = Object.fromEntries(MRS_ITEMS.map((i) => [i.key, 4]));

describe("computeMrsScore", () => {
  it("returns null for missing/empty data", () => {
    expect(computeMrsScore(null)).toBeNull();
    expect(computeMrsScore(undefined)).toBeNull();
    expect(computeMrsScore({})).toBeNull();
  });

  it("returns null when any of the 11 items is unanswered — a partial subset isn't a valid MRS score", () => {
    const almostComplete = { ...ALL_ZERO };
    delete (almostComplete as Record<string, unknown>)[MRS_ITEMS[0].key];
    expect(computeMrsScore(almostComplete)).toBeNull();
  });

  it("scores all-zero as a clean 0/0/0/0", () => {
    expect(computeMrsScore(ALL_ZERO)).toEqual({
      somaticVegetative: 0,
      psychological: 0,
      urogenital: 0,
      total: 0,
    });
  });

  it("scores all-max at the instrument's ceiling (44 = 16+16+12)", () => {
    const score = computeMrsScore(ALL_MAX);
    expect(score).toEqual({
      somaticVegetative: MRS_SUBSCALE_MAX.somaticVegetative,
      psychological: MRS_SUBSCALE_MAX.psychological,
      urogenital: MRS_SUBSCALE_MAX.urogenital,
      total: 44,
    });
  });

  it("sums each item into its correct subscale, not a flat total", () => {
    const data = {
      hot_flashes_sweating: 4,
      heart_discomfort: 0,
      sleep_problems: 0,
      joint_muscular_discomfort: 0,
      depressive_mood: 2,
      irritability: 2,
      anxiety: 0,
      physical_mental_exhaustion: 0,
      sexual_problems: 1,
      bladder_problems: 0,
      vaginal_dryness: 0,
    };
    expect(computeMrsScore(data)).toEqual({
      somaticVegetative: 4,
      psychological: 4,
      urogenital: 1,
      total: 9,
    });
  });

  it("MRS_ITEMS has exactly 4 somatic + 4 psychological + 3 urogenital items", () => {
    const bySubscale = MRS_ITEMS.reduce<Record<string, number>>((acc, i) => {
      acc[i.subscale] = (acc[i.subscale] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySubscale.somaticVegetative).toBe(4);
    expect(bySubscale.psychological).toBe(4);
    expect(bySubscale.urogenital).toBe(3);
    expect(MRS_ITEMS.length).toBe(11);
  });
});

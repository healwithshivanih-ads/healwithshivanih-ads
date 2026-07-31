/**
 * Half of the thyroid reading is about the opposite condition. Shown to a
 * client with an underactive thyroid, the hyperthyroid half is padding — and
 * padding on a card about his own body costs the rest of it credibility.
 */
import { describe, it, expect } from "vitest";
import { rootAppliesTo } from "./somatic-variants";

const HYPO = "Emotional hibernation (hypothyroid pattern)";
const HYPER = "Chronic exclusion and rage (hyperthyroid pattern)";
const PLAIN = "Humiliation and being made small";

describe("rootAppliesTo", () => {
  it("keeps his own variant and drops the other — the real case", () => {
    const his = ["Underactive thyroid (subclinical, non-autoimmune)"];
    expect(rootAppliesTo(HYPO, his)).toBe(true);
    expect(rootAppliesTo(HYPER, his)).toBe(false);
  });

  it("works the other way round", () => {
    const hers = ["Overactive thyroid — Graves"];
    expect(rootAppliesTo(HYPER, hers)).toBe(true);
    expect(rootAppliesTo(HYPO, hers)).toBe(false);
  });

  it("recognises the clinical names as well as the plain ones", () => {
    expect(rootAppliesTo(HYPER, ["Hashimoto's thyroiditis"])).toBe(false);
    expect(rootAppliesTo(HYPO, ["Thyrotoxicosis"])).toBe(false);
  });

  it("keeps BOTH when the condition does not say which way", () => {
    for (const c of ["Thyroid problems", "Thyroid imbalance", "Thyroid dysfunction"]) {
      expect(rootAppliesTo(HYPO, [c]), c).toBe(true);
      expect(rootAppliesTo(HYPER, [c]), c).toBe(true);
    }
  });

  it("never touches an untagged root", () => {
    for (const c of ["Underactive thyroid", "Overactive thyroid", "Anything at all"]) {
      expect(rootAppliesTo(PLAIN, [c])).toBe(true);
    }
  });

  it("shows everything when there are no conditions to judge by", () => {
    expect(rootAppliesTo(HYPO, [])).toBe(true);
    expect(rootAppliesTo(HYPER, [])).toBe(true);
  });

  it("reads the whole condition list, not just the first", () => {
    const list = ["Anxiety", "Knee pain", "Underactive thyroid (subclinical)"];
    expect(rootAppliesTo(HYPER, list)).toBe(false);
    expect(rootAppliesTo(HYPO, list)).toBe(true);
  });
});

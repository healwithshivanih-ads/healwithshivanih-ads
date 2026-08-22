import { describe, it, expect } from "vitest";
import { ageFromDob } from "./age";
import {
  MRS_INTAKE_MIN_AGE,
  showCycleChangesOnIntake,
  showMrsOnIntake,
} from "./mrs-intake-gate";

// Fixed "today" so the age boundaries below are deterministic.
const TODAY = new Date("2026-08-22T00:00:00Z");
const dobAge = (years: number, offsetDays = 0) => {
  const d = new Date(TODAY);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe("ageFromDob", () => {
  it("computes whole years and respects the birthday boundary", () => {
    expect(ageFromDob(dobAge(40), TODAY)).toBe(40);
    expect(ageFromDob(dobAge(40, 1), TODAY)).toBe(39); // birthday is tomorrow
  });
  it("rejects junk", () => {
    expect(ageFromDob("", TODAY)).toBeNull();
    expect(ageFromDob("not a date", TODAY)).toBeNull();
    expect(ageFromDob(null, TODAY)).toBeNull();
    expect(ageFromDob("1800-01-01", TODAY)).toBeNull();
  });
});

describe("showMrsOnIntake", () => {
  it("never shows for men or unknown sex, whatever the other inputs", () => {
    expect(showMrsOnIntake("M", "postmenopausal", dobAge(55), TODAY)).toBe(false);
    expect(showMrsOnIntake("", "perimenopausal", dobAge(48), TODAY)).toBe(false);
    expect(showMrsOnIntake(undefined, "menstruating", dobAge(45), TODAY)).toBe(false);
  });

  it("shows for peri/postmenopausal women at any age", () => {
    expect(showMrsOnIntake("F", "perimenopausal", dobAge(36), TODAY)).toBe(true);
    expect(showMrsOnIntake("F", "postmenopausal", dobAge(38), TODAY)).toBe(true); // e.g. surgical
    expect(showMrsOnIntake("f", "postmenopausal", "", TODAY)).toBe(true); // no DOB needed
  });

  it(`still-menstruating women see it from ${MRS_INTAKE_MIN_AGE}, not before`, () => {
    expect(showMrsOnIntake("F", "menstruating", dobAge(40), TODAY)).toBe(true);
    expect(showMrsOnIntake("F", "menstruating", dobAge(40, 1), TODAY)).toBe(false); // 39 until tomorrow
    expect(showMrsOnIntake("F", "menstruating", dobAge(28), TODAY)).toBe(false);
    expect(showMrsOnIntake("F", "menstruating", "", TODAY)).toBe(false); // no DOB → can't clear the floor
  });

  it("hides for not-applicable or unanswered cycle status", () => {
    expect(showMrsOnIntake("F", "not_applicable", dobAge(50), TODAY)).toBe(false);
    expect(showMrsOnIntake("F", "", dobAge(50), TODAY)).toBe(false);
  });
});

describe("showCycleChangesOnIntake", () => {
  it("only while cycles still exist", () => {
    expect(showCycleChangesOnIntake("F", "menstruating")).toBe(true);
    expect(showCycleChangesOnIntake("F", "perimenopausal")).toBe(true);
    expect(showCycleChangesOnIntake("F", "postmenopausal")).toBe(false);
    expect(showCycleChangesOnIntake("F", "not_applicable")).toBe(false);
    expect(showCycleChangesOnIntake("M", "menstruating")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { ADULT_INTAKE_MIN_AGE, isMinorOnIntake } from "./minor-intake-gate";

const TODAY = new Date("2026-10-22T00:00:00Z");
const dobAge = (years: number, offsetDays = 0) => {
  const d = new Date(TODAY);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe("isMinorOnIntake", () => {
  it("treats a 17-year-old as a minor", () => {
    expect(isMinorOnIntake(dobAge(17), TODAY)).toBe(true);
  });
  it("flips on the 18th birthday, not before", () => {
    expect(isMinorOnIntake(dobAge(ADULT_INTAKE_MIN_AGE, 1), TODAY)).toBe(true); // birthday tomorrow
    expect(isMinorOnIntake(dobAge(ADULT_INTAKE_MIN_AGE), TODAY)).toBe(false);
  });
  it("shows the adult form when the age is unknown", () => {
    expect(isMinorOnIntake("", TODAY)).toBe(false);
    expect(isMinorOnIntake(undefined, TODAY)).toBe(false);
    expect(isMinorOnIntake("not a date", TODAY)).toBe(false);
  });
});

/**
 * The safety list is now shared by the co-pilot and the chat. These pin the
 * cues that must fire — a regression here is not a rendering bug.
 */
import { describe, it, expect } from "vitest";
import { isEmergency } from "./triage";

describe("isEmergency", () => {
  it.each([
    "I have chest pain since morning",
    "CHEST TIGHTNESS and can't breathe",
    "i think i want to die",
    "thinking about ending my life",
    "took an overdose of my tablets",
    "feeling suicidal",
    "I want to harm myself",
    "she collapsed and is unconscious",
    "coughing blood this morning",
    "numb on one side of my face",
  ])("fires on %j", (t) => {
    expect(isEmergency(t)).toBe(true);
  });

  it.each([
    "can I take magnesium at night?",
    "the meal plan is going well",
    "my knee is a bit sore after the walk",
    "when is our next session",
    "",
  ])("does not fire on %j", (t) => {
    expect(isEmergency(t)).toBe(false);
  });

  it("is case- and position-insensitive", () => {
    expect(isEmergency("Suddenly SLURRED speech")).toBe(true);
    expect(isEmergency("no issues at all")).toBe(false);
  });

  it("tolerates null-ish input rather than throwing", () => {
    expect(isEmergency(undefined as unknown as string)).toBe(false);
  });
});

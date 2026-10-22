import { describe, expect, it } from "vitest";
import { crisp } from "./crisp";

describe("crisp", () => {
  it.each([
    [
      "Plan the festival weeks rather than riding them — decide in advance which days are the indulgent ones",
      "Plan the festival weeks rather than riding them",
      "Decide in advance which days are the indulgent ones",
    ],
    [
      "Protein and vegetables FIRST at a festival meal; sweets after, on a fuller stomach",
      "Protein and vegetables FIRST at a festival meal",
      "Sweets after, on a fuller stomach",
    ],
    [
      "Keep your movement going through the festivities — it's what protects the sugars",
      "Keep your movement going through the festivities",
      "It's what protects the sugars",
    ],
    ["A steady wind-down routine and a consistent sleep/wake time", "A steady wind-down routine and a consistent sleep/wake time", ""],
    ["Give it 5–7 days. If it isn't settling, book a re-check", "Give it 5–7 days", "If it isn't settling, book a re-check"],
  ])("%s", (input, head, rest) => {
    expect(crisp(input)).toEqual({ head, rest });
  });

  it("never drops a word — head and rest together carry the whole line", () => {
    const lines = [
      "Grazing on mithai across the whole month rather than on the days that matter",
      "Ease back off refined-flour bases at dinner, white rice portions for a few days",
      "Rest — then start again tomorrow",
      "Dinner: before 7, light",
    ];
    for (const l of lines) {
      const { head, rest } = crisp(l);
      const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      expect([...words(head), ...words(rest)]).toEqual(words(l));
    }
  });

  it("an early colon is a label, not a break", () => {
    expect(crisp("Dinner: before 7, light").rest).toBe("");
  });
});

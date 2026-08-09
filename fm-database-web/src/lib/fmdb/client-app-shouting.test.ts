/**
 * Tests for softenShoutedOpener — the coach's ALL-CAPS emphasis reaching the
 * client's supplement card. Caught live on cl-022's magnesium card.
 */
import { describe, it, expect } from "vitest";
import { softenShoutedOpener } from "./client-app-shouting";

describe("softenShoutedOpener", () => {
  it("softens the real cl-022 opener", () => {
    expect(
      softenShoutedOpener("REPLACES your Wellbeing triple magnesium complex — this is a swap."),
    ).toBe("Replaces your Wellbeing triple magnesium complex — this is a swap.");
  });

  it("softens a multi-word shouted run", () => {
    expect(softenShoutedOpener("TIMING CORRECTED — take it at bedtime")).toBe(
      "Timing corrected — take it at bedtime",
    );
  });

  it("leaves short acronyms alone — this domain is full of them", () => {
    for (const s of [
      "B12 is the one to watch here.",
      "NAC supports glutathione.",
      "IU is the unit on the label.",
      "EPA/DHA from fish oil.",
    ]) {
      expect(softenShoutedOpener(s), s).toBe(s);
    }
  });

  it("never touches caps that are not at the very start", () => {
    const s = "Take this with your PPI, four hours apart.";
    expect(softenShoutedOpener(s)).toBe(s);
  });

  it("is a no-op on ordinary sentence-case copy", () => {
    const s = "Replaces your triple magnesium — same job, gentler on your gut.";
    expect(softenShoutedOpener(s)).toBe(s);
  });

  it("handles empty and undefined safely", () => {
    expect(softenShoutedOpener("")).toBe("");
    expect(softenShoutedOpener(undefined as unknown as string)).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { pretestLines, sanitizePretestFlags } from "./lab-pretest";

const LAB = [
  "Fast for 10–12 hours before the test. Water is fine.",
  "Pause biotin for 3 days before. It hides in hair, skin & nail and B-complex supplements.",
  "No hard workouts for 3 days before, and no alcohol for 2 days.",
];
const FLAG = { match: "biotin", note: "Your supplement contains biotin, so pause it for these 3 days." };

describe("pretestLines", () => {
  it("draws the lab's list unchanged when the order has no flags", () => {
    expect(pretestLines(LAB, undefined)).toEqual(LAB.map((text) => ({ text, note: null, flagged: false })));
  });

  it("flags the matching line, adds the note, and moves it to the top", () => {
    const lines = pretestLines(LAB, [FLAG]);
    expect(lines[0]).toEqual({ text: LAB[1], note: FLAG.note, flagged: true });
    expect(lines.slice(1).map((l) => l.text)).toEqual([LAB[0], LAB[2]]);
    expect(lines.filter((l) => l.flagged)).toHaveLength(1);
  });

  it("matches whatever the case", () => {
    expect(pretestLines(LAB, [{ ...FLAG, match: "BIOTIN" }])[0].flagged).toBe(true);
  });

  it("never drops a flag whose word the lab's list no longer contains", () => {
    const lines = pretestLines(["Fast for 10–12 hours before the test."], [FLAG]);
    expect(lines[0]).toEqual({ text: FLAG.note, note: null, flagged: true });
    expect(lines).toHaveLength(2);
  });

  it("shows a flag even when the lab has no list at all", () => {
    expect(pretestLines(undefined, [FLAG])).toEqual([{ text: FLAG.note, note: null, flagged: true }]);
  });

  it("loses no lab line, whatever the flags", () => {
    const lines = pretestLines(LAB, [FLAG, { match: "alcohol", note: "That includes the weekend." }]);
    for (const text of LAB) expect(lines.some((l) => l.text === text)).toBe(true);
    expect(lines).toHaveLength(LAB.length);
  });
});

describe("sanitizePretestFlags", () => {
  it("ignores anything that is not a {match, note} pair of non-empty strings", () => {
    expect(sanitizePretestFlags(null)).toEqual([]);
    expect(sanitizePretestFlags("biotin")).toEqual([]);
    expect(sanitizePretestFlags([null, 3, {}, { match: "biotin" }, { match: " ", note: "x" }, { match: "a", note: 4 }])).toEqual([]);
    expect(sanitizePretestFlags([{ match: " biotin ", note: " Pause it. " }])).toEqual([{ match: "biotin", note: "Pause it." }]);
  });

  it("caps the count and the note length", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ match: `m${i}`, note: "n".repeat(500) }));
    const out = sanitizePretestFlags(many);
    expect(out).toHaveLength(5);
    expect(out[0].note).toHaveLength(240);
  });
});

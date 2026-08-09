/**
 * Tests for scrubAuthors — source attributions out of client-facing remedy
 * prose. The catalogue keeps them (provenance matters coach-side); the client
 * should read tradition, not citations.
 *
 * The denylist grows every time a new source is ingested, which is the reason
 * this is worth pinning: a new name added carelessly is how "Lad" once became
 * "Ayurvedic traditions" mid-word in an unrelated term.
 */
import { describe, it, expect } from "vitest";
import { scrubAuthors } from "./client-app-authors";

describe("scrubAuthors", () => {
  it("drops a possessive attribution and re-capitalises what's left", () => {
    expect(scrubAuthors("Lad's Agni Tea kindles digestion.")).toBe(
      "Agni Tea kindles digestion.",
    );
  });

  it("turns a bare mention into the tradition, not a person", () => {
    expect(scrubAuthors("Lad recommends this before meals.")).toBe(
      "Ayurvedic tradition recommends this before meals.",
    );
  });

  it("covers every name on the list, in both forms", () => {
    for (const n of ["Frawley", "Svoboda", "Welch", "O'Neill", "Thurlow"]) {
      expect(scrubAuthors(`${n}'s blend helps.`), n).toBe("Blend helps.");
      expect(scrubAuthors(`${n} suggests it.`), n).toBe("Ayurvedic tradition suggests it.");
    }
  });

  it("handles the honorific and the full name", () => {
    expect(scrubAuthors("Dr. Vasant Lad's formula.")).toBe("Formula.");
    expect(scrubAuthors("Dr Lad describes it.")).toBe("Ayurvedic tradition describes it.");
  });

  it("accepts a curly apostrophe, which is what gets pasted in", () => {
    expect(scrubAuthors("Lad’s Agni Tea.")).toBe("Agni Tea.");
    expect(scrubAuthors("O’Neill’s rinse.")).toBe("Rinse.");
  });

  it("never touches ordinary words that merely contain a name", () => {
    for (const s of [
      "Ladle the broth over the rice.",
      "Salad leaves, washed well.",
      "A well-loaded spoon.",
    ]) {
      expect(scrubAuthors(s), s).toBe(s);
    }
  });

  it("is a no-op on prose with no attribution", () => {
    const s = "Simmer for seven minutes and strain.";
    expect(scrubAuthors(s)).toBe(s);
  });

  it("handles empty and undefined safely", () => {
    expect(scrubAuthors("")).toBe("");
    expect(scrubAuthors(undefined as unknown as string)).toBe(undefined as unknown as string);
  });
});

/**
 * Tests for clientNounToPronoun — the guard against the coach's third-person
 * voice reaching the person it is about. Caught live on Hariharan's plan: the
 * tissue-salt card opened "This client's anxiety, chronic sleeplessness…".
 */
import { describe, it, expect } from "vitest";
import { clientNounToPronoun, toSecondPerson } from "./client-app-third-person";

describe("clientNounToPronoun", () => {
  it("rewrites the real leak from Hariharan's tissue-salt card", () => {
    const raw =
      "This client's anxiety, chronic sleeplessness, and 'running on empty' " +
      "feeling map directly to Kali phos's keynote picture of nervous exhaustion.";
    const out = clientNounToPronoun(raw);
    expect(out).not.toMatch(/client/i);
    expect(out.startsWith("her anxiety")).toBe(true);
    // the clinical substance must survive untouched
    expect(out).toContain("Kali phos's keynote picture");
  });

  it("handles the article variants a coach actually writes", () => {
    for (const v of ["This client's", "The client's", "the client's", "Our client's", "My client's"]) {
      expect(clientNounToPronoun(`${v} sleep is poor`), v).toBe("her sleep is poor");
    }
  });

  it("leaves the subject form as a pronoun so verb agreement can be fixed downstream", () => {
    // NOT "you takes" — the pronoun rules in toSecondPerson finish this
    expect(clientNounToPronoun("The client takes magnesium")).toBe("she takes magnesium");
    expect(clientNounToPronoun("this client is anxious")).toBe("she is anxious");
  });

  it("covers the patient phrasing too", () => {
    expect(clientNounToPronoun("The patient's knee is weak")).toBe("her knee is weak");
    expect(clientNounToPronoun("this patient sleeps badly")).toBe("she sleeps badly");
  });

  it("accepts a curly apostrophe, which is what gets pasted in", () => {
    expect(clientNounToPronoun("This client’s anxiety")).toBe("her anxiety");
  });

  it("never touches ordinary words containing the string", () => {
    for (const s of [
      "Clientele in the waiting room",
      "efficient digestion",
      "a resilient nervous system",
    ]) {
      expect(clientNounToPronoun(s), s).toBe(s);
    }
  });

  it("is a no-op on text with no third-person reference", () => {
    const s = "Your anxiety and sleeplessness map to nervous exhaustion.";
    expect(clientNounToPronoun(s)).toBe(s);
  });

  it("handles empty and undefined safely", () => {
    expect(clientNounToPronoun("")).toBe("");
    expect(clientNounToPronoun(undefined as unknown as string)).toBe("");
  });
});

describe("toSecondPerson", () => {
  it("does not mangle an OBJECT 'her' into 'your' — the cl-022 magnesium bug", () => {
    // Rendered live as "…it should be said to your that way."
    expect(toSecondPerson("it should be said to her that way")).toBe(
      "It should be said to you that way",
    );
  });

  it("treats 'her' as an object in front of any closed-class word", () => {
    // note: the first letter is always re-capitalised — these are sentences
    expect(toSecondPerson("gave her the pills")).toBe("Gave you the pills");
    expect(toSecondPerson("explained it to her again")).toBe("Explained it to you again");
    expect(toSecondPerson("we told her that it helps")).toBe("We told you that it helps");
    expect(toSecondPerson("helped her so it lands")).toBe("Helped you so it lands");
  });

  it("still converts genuine possessives, including ones near the stoplist words", () => {
    // "is" is untouched here — agreement only fires on a she/he SUBJECT
    expect(toSecondPerson("Her calcium is low")).toBe("Your calcium is low");
    expect(toSecondPerson("given her age")).toBe("Given your age");
    // words deliberately kept OUT of the stoplist because they modify nouns
    expect(toSecondPerson("her only complaint")).toBe("Your only complaint");
    expect(toSecondPerson("her very low ferritin")).toBe("Your very low ferritin");
    expect(toSecondPerson("her own routine")).toBe("Your own routine");
    expect(toSecondPerson("her back pain")).toBe("Your back pain");
    expect(toSecondPerson("her right knee")).toBe("Your right knee");
  });

  it("fixes verb agreement on the subject form", () => {
    expect(toSecondPerson("she keeps waking at 3am")).toBe("You keep waking at 3am");
    expect(toSecondPerson("she has low ferritin")).toBe("You have low ferritin");
    expect(toSecondPerson("The client takes magnesium")).toBe("You take magnesium");
  });

  it("handles empty and undefined safely", () => {
    expect(toSecondPerson("")).toBe("");
    expect(toSecondPerson(undefined as unknown as string)).toBe("");
  });
});

/**
 * The load check exists because counting practices missed a 14-practice plan:
 * "hibiscus tea" and "abhyanga — 20 minutes of self-massage" are one item each
 * and nothing like each other in cost. What matters is how many DEDICATED
 * STOPPED MOMENTS the day is asked for.
 */
import { describe, it, expect } from "vitest";
import { classifyPractice, practiceLoad } from "./practice-load";

const cost = (n: string, guided = false) => classifyPractice(n, guided).cost;

describe("classifyPractice — real practice names from real plans", () => {
  it("counts the things you must stop and do", () => {
    for (const n of [
      "Abhyanga — warm sesame oil self-massage",
      "4-7-8 breathing — morning and before bed",
      "Daily 20-30 minute walk — gentle to moderate pace",
      "Gratitude journaling — 3 things, handwritten",
      "EFT tapping for the wired, anxious feeling",
      "Morning yoga",
      "Morning sunlight exposure (15–20 minutes)",
      "Daily hip and calf strengthening (home)",
    ]) {
      expect(cost(n), n).toBe("dedicated");
    }
  });

  it("does not count things that ride a moment already happening", () => {
    for (const n of [
      "Hibiscus tea (gudhal/jaswand) — 1-2 cups daily",
      "Brahmi tea — evening, before dinner",
      "Dinner before 7 pm",
      "Fixed bedtime anchor at 10:30 pm",
      "12-hour overnight fast",
      "Mouth taping at night",
      "Magnesium oil spray to legs at bedtime",
      "Chai modification: jaggery instead of white sugar",
      "Eat slowly, chew thoroughly, no screens at meals",
      "Nasya — 2 drops warm sesame oil into each nostril",
    ]) {
      expect(cost(n), n).toBe("attached");
    }
  });

  /* "10-minute walk after every meal" carries both signals. The meal is what
     makes it cheap — it is bolted onto something already happening — so
     ATTACHED has to win, and that ordering is the whole reason the rule is
     written the way it is. */
  it("lets the attached signal win when a practice carries both", () => {
    for (const n of [
      "10-minute walk after every meal",
      "10-minute post-meal gentle walk",
      "5 minutes morning sunlight + grounding before breakfast",
    ]) {
      expect(cost(n), n).toBe("attached");
    }
  });

  it("always counts a guided session, whatever it is called", () => {
    expect(cost("Morning belly rhythm — warm water, then belly breathing", true)).toBe("dedicated");
    expect(cost("Hibiscus tea", true)).toBe("dedicated");
  });

  it("defaults an unrecognised practice to attached, so it never cries wolf", () => {
    expect(cost("Something entirely new the coach invented")).toBe("attached");
  });
});

describe("practiceLoad — the verdict", () => {
  const many = (n: number, name: string) => Array.from({ length: n }, () => ({ name }));

  it("reads Hariharan's real plan as heavy", () => {
    const load = practiceLoad([
      { name: "Consistent sleep schedule — 10:30 pm" },
      { name: "Morning sunlight — 10-20 minutes before 9 AM" },
      { name: "Morning belly rhythm", guided: true },
      { name: "Abhyanga — warm sesame oil self-massage" },
      { name: "4-7-8 breathing — morning and before bed" },
      { name: "Nasya — 2 drops warm sesame oil" },
      { name: "Regular meal timing — breakfast by 8 AM" },
      { name: "Daily 20-30 minute walk" },
      { name: "Hibiscus tea (gudhal/jaswand)" },
      { name: "Gratitude journaling — 3 things" },
      { name: "Brahmi tea — evening" },
      { name: "EFT tapping — a guided 2-minute round" },
      { name: "Nasal-only breathing — 10-min blocks" },
      { name: "Dinner before 7 pm" },
    ]);
    expect(load.verdict).toBe("heavy");
    expect(load.dedicated.length).toBeGreaterThanOrEqual(6);
    expect(load.headline).toMatch(/feel behind/i);
  });

  it("reads the median plan as comfortable — or the check gets ignored", () => {
    const load = practiceLoad([
      { name: "Dinner before 7 pm" },
      { name: "12-hour overnight fast" },
      { name: "CCF tea between meals" },
      { name: "Daily seed mix" },
      { name: "Morning sunlight exposure" },
      { name: "4-7-8 breathing before bed" },
      { name: "Fixed bedtime anchor at 10:30 pm" },
    ]);
    expect(load.verdict).toBe("comfortable");
  });

  it("flags on dedicated moments even when the total looks modest", () => {
    const load = practiceLoad([
      { name: "Morning yoga" },
      { name: "Daily 30-min walk" },
      { name: "Gratitude journaling" },
      { name: "Abhyanga" },
      { name: "EFT tapping" },
      { name: "4-7-8 breathing" },
    ]);
    expect(load.total).toBe(6);
    expect(load.verdict).toBe("heavy");
  });

  /* Cheap practices are not free — nine things to remember is nine things —
     but they must not read the same as nine stopped moments. Nazneen's real
     plan is 9 with 2 dedicated and should not flag, so the boundary sits just
     above it. Pinned here because moving it silently would either start
     crying wolf or stop catching Hariharan. */
  it("counts cheap practices without punishing them", () => {
    const load = practiceLoad(many(9, "Hibiscus tea"));
    expect(load.dedicated).toEqual([]);
    expect(load.attachedCount).toBe(9);
    expect(load.verdict).toBe("comfortable");
  });

  it("pins the total boundary — 9 comfortable, 10 full, 11 heavy", () => {
    expect(practiceLoad(many(9, "Hibiscus tea")).verdict).toBe("comfortable");
    expect(practiceLoad(many(10, "Hibiscus tea")).verdict).toBe("full");
    expect(practiceLoad(many(11, "Hibiscus tea")).verdict).toBe("heavy");
  });

  it("is comfortable with an empty plan rather than throwing", () => {
    const load = practiceLoad([]);
    expect(load.total).toBe(0);
    expect(load.verdict).toBe("comfortable");
  });
});

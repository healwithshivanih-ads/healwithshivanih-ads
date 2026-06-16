import { describe, it, expect } from "vitest";
import { resolveTravelGuide, coerceGuide } from "./travel-foods";

const foodsOf = (g: Awaited<ReturnType<typeof resolveTravelGuide>>) =>
  (g?.eat ?? []).map((f) => f.food.toLowerCase()).join(" | ");

describe("resolveTravelGuide — plan gating (curated dataset)", () => {
  it("Jain veg (Dhanishta) → Australia: drops fish + egg, keeps plant/veg", async () => {
    const g = await resolveTravelGuide({
      kind: "travel",
      location: "Sydney, Australia",
      dietPref: "Vegetarian Jain",
      avoidTerms: ["Onion", "Garlic"],
    });
    expect(g).not.toBeNull();
    expect(g!.title).toMatch(/australia/i);
    expect(foodsOf(g)).not.toMatch(/barramundi|salmon|egg/);
    expect(g!.eat.length).toBeGreaterThan(0);
  });

  it("Non-veg → Australia: keeps fish", async () => {
    const g = await resolveTravelGuide({
      kind: "travel",
      location: "australia",
      dietPref: "Non vegetarian",
      avoidTerms: [],
    });
    expect(foodsOf(g)).toMatch(/barramundi|salmon/);
  });

  it("Vegan → Australia: drops dairy (no flat white / yoghurt)", async () => {
    const g = await resolveTravelGuide({
      kind: "travel",
      location: "australia",
      dietPref: "Vegan",
      avoidTerms: [],
    });
    expect(foodsOf(g)).not.toMatch(/yoghurt|flat white/);
    expect(g!.eat.length).toBeGreaterThan(0);
  });

  it("Dairy allergy → Australia: drops dairy items even for non-veg", async () => {
    const g = await resolveTravelGuide({
      kind: "travel",
      location: "australia",
      dietPref: "Non vegetarian",
      avoidTerms: ["dairy allergy"],
    });
    expect(foodsOf(g)).not.toMatch(/yoghurt|flat white/);
  });

  it("Festival (Diwali) → returns guide with celebratory note", async () => {
    const g = await resolveTravelGuide({
      kind: "festival",
      location: "Diwali at home",
      dietPref: "Vegetarian Jain",
      avoidTerms: ["Onion", "Garlic"],
    });
    expect(g).not.toBeNull();
    expect(g!.title).toMatch(/diwali/i);
    expect(g!.note).toBeTruthy();
  });

  it("Illness → sick-day situation guide regardless of location", async () => {
    const g = await resolveTravelGuide({
      kind: "illness",
      location: "",
      dietPref: "Vegetarian Jain",
      avoidTerms: [],
    });
    expect(g).not.toBeNull();
    expect(foodsOf(g)).toMatch(/khichdi|congee|soup/);
  });

  it("Unknown destination → null (card falls back to generic)", async () => {
    const g = await resolveTravelGuide({
      kind: "travel",
      location: "Narnia",
      dietPref: "Non vegetarian",
      avoidTerms: [],
    });
    expect(g).toBeNull();
  });
});

describe("coerceGuide — A/B cached guide read-back", () => {
  it("coerces a pre-authored blob (go_easy → goEasy, source preserved)", () => {
    const g = coerceGuide({
      title: "Eating in Sydney, on your plan",
      note: "tailored",
      eat: [{ food: "Grilled barramundi", why: "lean protein" }, { food: "Bad", why: "" }],
      go_easy: ["Meat pies"],
      source: "pre_authored",
    });
    expect(g).not.toBeNull();
    expect(g!.source).toBe("pre_authored");
    expect(g!.eat.length).toBe(2);
    expect(g!.goEasy).toEqual(["Meat pies"]);
  });

  it("maps copilot source + tolerates missing go_easy", () => {
    const g = coerceGuide({ title: "x", eat: [{ food: "Dal", why: "" }], source: "copilot" });
    expect(g!.source).toBe("copilot");
    expect(g!.goEasy).toEqual([]);
  });

  it("returns null for empty / malformed", () => {
    expect(coerceGuide(null)).toBeNull();
    expect(coerceGuide({ title: "x", eat: [] })).toBeNull();
    expect(coerceGuide({ eat: [{ food: "x", why: "" }] })).toBeNull();
  });
});

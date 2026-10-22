import { describe, expect, it } from "vitest";
import { classifyPracticeKind, parseAppKind, partOfDay, supplementCadence, weeklyDueToday } from "./practice-kind";

// Phrasings modelled on the live roster (2026-10-22, 124 distinct practices:
// 64 daily · 42 guideline · 13 weekly · 5 as-needed). Real client text stays
// out of the repo; these keep each pattern that mattered.
const k = (name: string, cadence = "daily", guided = false) =>
  classifyPracticeKind(name, cadence, { guided }).kind;

describe("standing rules are guidelines, not ticks", () => {
  it.each([
    ["Stop the evening vegetable juice"],
    ["Keep coffee to one, before noon"],
    ["Keep the fat-first morning ritual exactly as it is"],
    ["Most drinks before 4pm, and one coffee before noon"],
    ["Front-load fluids: most of the 3L before 4pm"],
    ["Vegetables first, then protein, then carbs", "every meal"],
    ["Protein at every meal — 25-30g", "every meal"],
    ["Veg-first meal sequencing"],
    ["Go strictly gluten-free"],
    ["Gluten-free trial (n-of-1)", "strict 8–12 weeks"],
    ["Intermittent fasting (12–14 hour overnight fast)"],
    ["Dinner before 7 pm — move the evening meal earlier"],
    ["Light evening meal before 7 PM"],
    ["Lights out by 10:30pm, screens down 30 minutes before", "nightly"],
    ["Sleep 7–9 hours", "nightly"],
    ["Thyroid tablet timing — empty stomach, away from calcium & iron"],
    ["Chai modification: jaggery instead of white sugar"],
    ["Eat slowly, chew thoroughly, no screens at meals", "every meal"],
    ["Two litres of water, counted, across the day"],
    ["Cutting back the cigarettes — at a pace you choose"],
  ])("%s", (name, cadence = "daily") => {
    expect(k(name, cadence)).toBe("guideline");
  });

  it("a rule opener wins over an action word it mentions", () => {
    // names yoga, but is the instruction to pause it
    expect(k("Hold the yoga, keep dinner before 5.30pm", "Mon/Wed/Fri")).toBe("guideline");
  });
});

describe("things you do are daily ticks", () => {
  it.each([
    ["4-7-8 breathing before bed", "nightly"],
    ["10-minute walk after every meal", "after each meal"], // a walk, despite "every meal"
    ["Morning sunlight — 10–15 minutes outdoors"],
    ["Gratitude journaling — 3 things", "nightly"],
    ["Abhyanga — warm sesame oil self-massage before the shower"],
    ["Nasya — 2 drops warm sesame oil each morning"],
    ["Daily seed mix — 1 tbsp ground flax + 1 tbsp pumpkin seeds"],
    ["Fresh amla + lemon water in the morning"],
    ["Parasympathetic activation before meals", "daily, before each meal"],
    ["Castor oil on the eyelids, then the warm compress", "nightly"],
    ["Mouth taping at night", "nightly"],
  ])("%s", (name, cadence = "daily") => {
    expect(k(name, cadence)).toBe("daily");
  });

  it("a guided session is always something you do", () => {
    expect(k("Keep your evening routine", "daily", true)).toBe("daily");
  });

  it("unrecognised text stays daily — nothing silently disappears", () => {
    expect(k("Looking after your mouth while you wait for the dentist")).toBe("daily");
  });
});

describe("weekly and as-needed", () => {
  it("counts per week from several phrasings", () => {
    expect(classifyPracticeKind("Strength training — 2 sessions per week", "weekly")).toMatchObject({ kind: "weekly", perWeek: 2 });
    expect(classifyPracticeKind("Strength set", "3 times per week, on non-consecutive days")).toMatchObject({ kind: "weekly", perWeek: 3 });
    expect(classifyPracticeKind("Strength / resistance training", "2-3x per week")).toMatchObject({ kind: "weekly", perWeek: 2 });
    expect(classifyPracticeKind("Blood pressure — seated", "twice weekly")).toMatchObject({ kind: "weekly", perWeek: 2 });
    expect(k("Calm, seated blood-pressure check", "a few days a week")).toBe("weekly");
  });

  it("named days become a schedule, prose days do not", () => {
    expect(classifyPracticeKind("Yoga class", "Mon/Wed/Fri")).toMatchObject({ kind: "weekly", days: [1, 3, 5] });
    expect(classifyPracticeKind("A Sunday-night reset", "daily").kind).toBe("daily");
  });

  it("due today: named days only on those days; a bare count every day", () => {
    const mwf = classifyPracticeKind("Yoga class", "Mon/Wed/Fri");
    expect(weeklyDueToday(mwf, 1)).toBe(true);
    expect(weeklyDueToday(mwf, 2)).toBe(false);
    expect(weeklyDueToday(classifyPracticeKind("Strength", "3x/week"), 2)).toBe(true);
    expect(weeklyDueToday(classifyPracticeKind("Walk"), 2)).toBe(false);
  });

  it("as needed is a tool, not a daily tick — unless it is also once daily", () => {
    expect(k("EFT tapping — a guided 2-minute round", "as needed")).toBe("as_needed");
    expect(k("A 90-second chest-opening pause when things tighten up", "as needed")).toBe("as_needed");
    expect(k("Ten slow breaths when the irritation rises", "as needed, and once daily to learn it")).toBe("daily");
  });
});

describe("coach override", () => {
  it("wins over every heuristic", () => {
    expect(classifyPracticeKind("Stop the evening juice", "daily", { override: "daily" }).kind).toBe("daily");
    expect(classifyPracticeKind("4-7-8 breathing", "nightly", { override: "guideline" }).kind).toBe("guideline");
    expect(classifyPracticeKind("Swim", "daily", { override: "weekly" })).toMatchObject({ kind: "weekly" });
  });
  it("ignores junk", () => {
    expect(parseAppKind("sometimes")).toBeNull();
    expect(parseAppKind(3)).toBeNull();
    expect(k("Stop the evening juice")).toBe("guideline");
  });
});

describe("time of day", () => {
  it.each([
    ["Morning sunlight", "daily", "waking"],
    ["Abhyanga before the morning shower", "daily", "morning"],
    ["10-minute walk after every meal", "after each meal", "meals"],
    ["Post-lunch 10-minute walk (not in direct sunlight)", "daily", "midday"],
    ["Gratitude journaling", "daily", "evening"],
    ["4-7-8 breathing before bed", "nightly", "bedtime"],
    // "sunscreen" contains "screen" — must not land at bedtime
    ["Sun exposure 20 minutes without sunscreen", "daily", "anytime"],
    ["Daily seed mix", "daily", "anytime"],
  ])("%s → %s", (name, cadence, part) => {
    expect(partOfDay(name, cadence)).toBe(part);
  });
});

describe("supplements taken less than daily", () => {
  it.each([
    ["60,000 IU sachet — once weekly, with a fat-containing meal", "", "weekly", undefined],
    ["Continue the 60,000 IU sachet WEEKLY", "With the largest meal", "weekly", undefined],
    ["60,000 IU weekly", "as prescribed, with a fat-containing meal", "weekly", undefined],
    ["7.5 ml ALTERNATE DAYS (Mon/Wed/Fri) for the first 4 weeks", "", "alternate", [1, 3, 5]],
    ["25-50 mg elemental, alternate days", "with vitamin C", "alternate", undefined],
  ])("%s → %s", (dose, timing, cadence, days) => {
    const r = supplementCadence(dose, timing);
    expect(r?.cadence).toBe(cadence);
    expect(r?.days).toEqual(days);
  });

  it.each([
    ["Loading: 60,000 IU daily x4 days, then 60,000 IU once weekly x~8 weeks", ""],
    ["Gentle elemental dose, alternate-day or daily per tolerance", ""],
    ["15 ml once daily; drop to alternate days if any GI upset", ""],
    ["1 capsule daily, escalating to 2 after the first week", "With dinner"],
    ["Titrate by 1 quarter-tsp per week to a target of 1 level teaspoon daily", ""],
    ["200 mg elemental", "Before Bed"],
  ])("stays daily: %s", (dose, timing) => {
    expect(supplementCadence(dose, timing)).toBeNull();
  });
});

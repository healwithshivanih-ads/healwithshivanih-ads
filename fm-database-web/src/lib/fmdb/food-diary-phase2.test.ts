/**
 * Food diary phase 2 (docs/FOOD_DIARY_PLAN.md §5, §5b) — the tip the client
 * sees and the estimate only the coach sees.
 *
 *   - The swap in the tip respects THIS client's diet, allergies, foods to
 *     avoid and dairy reaction (a no-paneer client is never told "paneer").
 *   - The tip observes, never judges; a gentle client hears about adding
 *     protein, never about what the plate "leaned on".
 *   - The estimate uses clientProteinFloor, so a urate / kidney-flagged client
 *     gets the suppressed floor; the coach's correction beats the AI reading;
 *     an unreadable photo counts for nothing.
 */
import { describe, it, expect } from "vitest";
import { allowedSwaps, diaryGentle, diaryTip, type PlateForTip } from "./food-diary-balance";
import { diaryEstimate, diarySummaryPayload, entryComponents } from "./food-diary-estimate";
import { foldDiary, type DiaryLine, type FoodDiaryConfig } from "./food-diary";
import { buildRecipeNutrientLookup, clientProteinFloor, componentNutrients } from "./menu-nutrients";

let day = 0;
const plate = (band: string, protein: string, carbs = "balanced", dishes = ["poha"]): PlateForTip => ({
  band,
  date: `2026-10-2${(day++ % 3) + 1}`,
  balance: { protein: protein as "present", veg: "present", carbs: carbs as "balanced" },
  dishes,
});

const POHA_MORNINGS = [
  plate("morning", "none", "heavy", ["poha"]),
  plate("morning", "none", "heavy", ["poha", "chai"]),
  plate("morning", "light", "heavy", ["upma"]),
  plate("evening", "present", "balanced", ["dal", "roti", "sabzi"]),
  plate("evening", "present", "balanced", ["rajma", "rice"]),
  plate("evening", "present", "balanced", ["chicken curry"]),
];

describe("swaps respect what she can eat", () => {
  it("a vegetarian with a milk allergy and no paneer is offered neither paneer nor curd", () => {
    const shweta = { dietary_preference: "Vegetarian", known_allergies: ["Milk"], foods_to_avoid: "paneer" };
    const s = allowedSwaps(shweta, "morning");
    expect(s.join(" ")).not.toMatch(/paneer|curd|raita|egg|chicken/);
    expect(s.length).toBeGreaterThan(0);
  });
  it("lactose intolerance keeps curd; a vegan loses all dairy and eggs", () => {
    expect(allowedSwaps({ dietary_preference: "Vegetarian", dairy_reaction_type: "lactose_intolerance", known_allergies: ["lactose"] }, "morning")).toContain("a bowl of curd");
    expect(allowedSwaps({ dietary_preference: "Vegan" }, "morning").join(" ")).not.toMatch(/curd|paneer|egg/);
  });
  it("'non-vegetarian' is not read as vegetarian; an unknown diet is", () => {
    expect(allowedSwaps({ dietary_preference: "Non-vegetarian" }, "midday").join(" ")).toMatch(/chicken/);
    expect(allowedSwaps({}, "midday").join(" ")).not.toMatch(/chicken|egg/);
  });
  it("anything named in her avoid list is out", () => {
    expect(allowedSwaps({ dietary_preference: "Vegetarian", foods_to_avoid: "moong, besan" }, "morning").join(" ")).not.toMatch(/moong|besan/);
  });
});

describe("the end-of-diary tip", () => {
  const veg = { dietary_preference: "Vegetarian" };
  it("one strength, one fix, in food words", () => {
    const tip = diaryTip(POHA_MORNINGS, veg, { gentle: false })!;
    expect(tip.strength).toBe("Dinner was well balanced most days.");
    expect(tip.fix).toMatch(/^Breakfast often leaned on poha with little protein\. Try adding /);
  });
  it("observes, never judges", () => {
    for (const gentle of [false, true]) {
      const tip = diaryTip(POHA_MORNINGS, veg, { gentle })!;
      expect(`${tip.strength} ${tip.fix}`).not.toMatch(/\b(bad|too much|failed|should|must|wrong|poor|unhealthy)\b/i);
    }
  });
  it("a gentle client hears about adding protein, never about carbs", () => {
    const tip = diaryTip(POHA_MORNINGS, veg, { gentle: true })!;
    expect(tip.fix).toMatch(/^Breakfast was often light on protein\. Adding /);
    expect(`${tip.strength} ${tip.fix}`).not.toMatch(/leaned|carb|poha/i);
  });
  it("no fix when every option is ruled out, rather than one she cannot eat", () => {
    const strict = { dietary_preference: "Vegan", foods_to_avoid: "moong, besan, chana, sprouts, soy, tofu, legumes" };
    expect(diaryTip(POHA_MORNINGS, strict, { gentle: false })!.fix).toBeNull();
  });
  it("a one-day diary is not 'most days'", () => {
    const one = POHA_MORNINGS.slice(0, 1).concat(POHA_MORNINGS.slice(3, 4)).map((p) => ({ ...p, date: "2026-10-23" }));
    const tip = diaryTip(one, veg, { gentle: false })!;
    expect(tip.strength).toBe("Dinner was well balanced.");
    expect(tip.fix).toMatch(/^Breakfast leaned on poha with little protein\./);
  });
  it("needs two meals to say anything", () => {
    expect(diaryTip([plate("morning", "none")], veg, { gentle: false })).toBeNull();
  });
});

describe("who gets the gentle version", () => {
  it("anxiety, SSRIs / benzos (incl. Indian brands), eating-disorder history", () => {
    expect(diaryGentle({ active_conditions: ["Generalised anxiety"] })).toBe(true);
    expect(diaryGentle({ current_medications: ["Rivotril 0.25"] })).toBe(true);
    expect(diaryGentle({ medical_history: ["Bulimia in her twenties"] })).toBe(true);
    expect(diaryGentle({ active_conditions: ["Hypothyroidism"], current_medications: ["Thyronorm"] })).toBe(false);
  });
});

describe("the coach estimate", () => {
  const CFG: FoodDiaryConfig = { id: "fd-1", start: "2026-10-23", days: 2, status: "ended", ended_at: "2026-10-24T20:00:00Z" };
  const add = (id: string, date: string, band: string, time: string): DiaryLine => ({
    op: "add", diary_id: "fd-1", ts: `${date}T01:00:00Z`, entry_id: id, date, time, band: band as "morning", photo: `${id}.jpg`, note: "",
  });
  const readOk = (id: string, dishes: { name: string; count: number }[]): DiaryLine => ({
    op: "read", diary_id: "fd-1", ts: "2026-10-25T01:00:00Z", entry_id: id,
    reading: { readable: true, confidence: 0.9, dishes: dishes.map((d) => ({ ...d, size: "regular" })), balance: { protein: "present", veg: "light", carbs: "balanced" } },
  });
  const lines: DiaryLine[] = [
    add("a", "2026-10-23", "morning", "08:30"),
    readOk("a", [{ name: "poha", count: 1 }]),
    add("b", "2026-10-23", "evening", "20:00"),
    readOk("b", [{ name: "moong dal", count: 1 }, { name: "roti", count: 2 }]),
    add("c", "2026-10-24", "morning", "08:30"),
    { op: "read", diary_id: "fd-1", ts: "2026-10-25T01:00:00Z", entry_id: "c", reading: { readable: false, confidence: 0.1, reason: "blurry" } },
    add("d", "2026-10-24", "evening", "20:00"),
    readOk("d", [{ name: "rice", count: 1 }]),
    // The coach says "d" was actually paneer bhurji + 2 roti — hers wins.
    { op: "label", diary_id: "fd-1", ts: "2026-10-25T02:00:00Z", entry_id: "d", label: "paneer bhurji + 2 roti" },
  ];
  const entries = foldDiary(lines, "fd-1").entries;

  it("feeds the engine count-aware components, the coach's correction first", () => {
    expect(entryComponents(entries.find((e) => e.entry_id === "b")!)).toEqual(["moong dal", "roti (2)"]);
    expect(entryComponents(entries.find((e) => e.entry_id === "d")!)).toEqual(["paneer bhurji", "2 roti"]);
    expect(entryComponents(entries.find((e) => e.entry_id === "c")!)).toEqual([]); // unreadable counts for nothing
  });

  it("uses clientProteinFloor — the suppressed floor for a urate-flagged client", () => {
    const urate = {
      sex: "F",
      measurements: { weight_kg: 60 },
      lab_markers: [{ marker_name: "Uric acid", value: 7.4, flag: "high" }],
    };
    const est = diaryEstimate(CFG, entries, urate, null);
    const floor = clientProteinFloor(urate, 60);
    expect(floor.suppressed).toBe(true);
    expect(est.proteinFloorG).toBe(floor.floorG);
    expect(est.proteinFloorG).toBe(48); // 0.8 g/kg, not 1.4
    expect(est.proteinSuppressed).toBe(true);
    expect(est.line).toMatch(/kept moderate — uric acid/);
  });

  it("averages over logged days, reports unreadable photos and thin meals, keeps powder separate", () => {
    const plan = { supplement_protocol: [{ supplement_slug: "whey-protein-isolate", dose: "20 g protein, once daily" }] };
    const est = diaryEstimate(CFG, entries, { measurements: { weight_kg: 60 } }, plan);
    expect(est.loggedDays).toBe(2);
    expect(est.unreadable).toBe(1);
    expect(est.supplementProteinG).toBe(20);
    // Day 2 is the coach's label run through the same engine — not the AI's "rice".
    const lookup = buildRecipeNutrientLookup();
    const labelled = ["paneer bhurji", "2 roti"].reduce((a, c) => a + (componentNutrients(c, lookup)?.protein_g ?? 0), 0);
    const aiGuess = componentNutrients("rice", lookup)?.protein_g ?? 0;
    expect(est.days[1].protein_g).toBe(Math.round(labelled));
    expect(est.days[1].protein_g).toBeGreaterThan(aiGuess);
    expect(est.line).toMatch(/\(\+20 g from the protein powder\)/);
    expect(est.line).toMatch(/breakfast carries almost none/);
    expect(est.line).toMatch(/1 of 4 photos unreadable/);
    const summary = diarySummaryPayload(CFG, entries, est);
    expect(summary.meals.some((m) => m.includes("couldn't read — blurry"))).toBe(true);
    expect(JSON.parse(summary.fingerprint).diary_id).toBe("fd-1");
  });
});

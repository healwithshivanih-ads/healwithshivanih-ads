import { describe, expect, it } from "vitest";
import { targetLine, targetsForWeek } from "./day-targets";

const spec = {
  status: "ok",
  kcal: { phases: { wk1_2: 1800, wk3_4: 1700, wk5_8: 1600, wk9_10: 1650, wk11_12: 1700 } },
  protein: { low: 84, high: 105 },
  carb_share: [0.45, 0.45],
  fat_share: [0.2, 0.35],
  fibre: 25,
};

describe("the day's target", () => {
  it("takes the plan week's calories and turns shares into grams", () => {
    expect(targetsForWeek(spec, 6)).toEqual({ protein: { low: 84, high: 105 }, carbs: { low: 180, high: 180 }, fat: { low: 36, high: 62 }, fibre: 25 });
    expect(targetLine(targetsForWeek(spec, 6)!)).toBe("Protein 84 to 105 g · Carbs 180 g · Fat 36 to 62 g · Fibre 25 g");
  });
  it("no carb level: no carb target; never calories", () => {
    const t = targetsForWeek({ ...spec, carb_share: null }, 1)!;
    expect(t.carbs).toBeUndefined();
    expect(targetLine(t)).not.toMatch(/kcal|calorie/i);
  });
  it("kidney: no protein number, the line instead", () => {
    const t = targetsForWeek({ ...spec, protein: null, protein_note: "Your kidney team sets your protein." }, 1)!;
    expect(t.protein).toBeUndefined();
    expect(t.line).toBe("Your kidney team sets your protein.");
  });
  it("no automatic targets: nothing, or the one line", () => {
    expect(targetsForWeek({ status: "none", why: "pregnancy" }, 1)).toBeNull();
    expect(targetsForWeek({ status: "none", client_line: "Do not cut protein or skip meals." }, 1)).toEqual({ line: "Do not cut protein or skip meals." });
  });
});

import { describe, it, expect } from "vitest";
import { progressSummary, cmToInches, type HistPoint } from "./ochre-body-progress";

function pt(date: string, weightKg: number | null, waistCm: number | null): HistPoint {
  return { date, weightKg, waistCm, hipCm: null };
}

describe("cmToInches", () => {
  it("converts cm to inches", () => {
    expect(cmToInches(2.54)).toBe(1);
    expect(cmToInches(5)).toBe(2);
  });
});

describe("progressSummary — leads with the waist (#6)", () => {
  it("prompts to start tracking with <2 readings", () => {
    expect(progressSummary([]).headline).toBe("Your progress lives here");
    expect(progressSummary([pt("2026-06-01", 80, 90)]).headline).toBe("Your progress lives here");
  });

  it("celebrates inches lost when the scale is flat (recomposition NSV)", () => {
    const s = progressSummary([pt("2026-05-01", 80, 92), pt("2026-06-01", 79.9, 89)]); // waist −3, weight flat
    expect(s.headline).toBe("3 cm off your waist");
    expect(s.body).toMatch(/inches/);
    expect(s.body).toMatch(/scale has barely moved/);
    expect(s.tone).toBe("var(--forest)");
  });

  it("celebrates inches even when the scale went UP", () => {
    const s = progressSummary([pt("2026-05-01", 80, 92), pt("2026-06-01", 80.6, 89)]); // waist −3, weight +0.6
    expect(s.headline).toBe("3 cm off your waist");
    expect(s.tone).toBe("var(--forest)");
  });

  it("reports both when waist and weight both drop", () => {
    const s = progressSummary([pt("2026-05-01", 80, 92), pt("2026-06-01", 77, 89)]);
    expect(s.headline).toBe("3 cm off your waist · 3 kg down");
  });

  it("reports kg when only weight has history", () => {
    const s = progressSummary([pt("2026-05-01", 80, null), pt("2026-06-01", 77.5, null)]);
    expect(s.headline).toBe("2.5 kg down so far");
  });

  it("reframes away from the scale, no false cheer, when nothing has dropped", () => {
    const s = progressSummary([pt("2026-05-01", 80, 90), pt("2026-06-01", 80.2, 90.1)]);
    expect(s.headline).toBe("Keep tracking — this is normal");
    expect(s.body).toMatch(/swings with water/);
    expect(s.tone).toBe("var(--ochre)");
  });

  it("uses earliest→latest across the full series", () => {
    const s = progressSummary([
      pt("2026-04-01", 82, 94),
      pt("2026-05-01", 81, 92),
      pt("2026-06-01", 80.5, 90), // waist 94→90 = −4, weight 82→80.5 = −1.5
    ]);
    expect(s.headline).toBe("4 cm off your waist · 1.5 kg down");
  });
});

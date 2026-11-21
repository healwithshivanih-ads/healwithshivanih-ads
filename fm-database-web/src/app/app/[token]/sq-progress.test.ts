import { describe, expect, it } from "vitest";
import { journeyByDate, progressCheckpoints, progressHeadline, progressTrends } from "./sq-progress";

const row = (date: string, w: number | null, s: number | null = null, d: number | null = null) => ({
  date, weightKg: w, waistCm: null, hipCm: null, bpSystolic: s, bpDiastolic: d, moodScore: null,
});
const base = { heightCm: null, ageYears: null, sex: "" as const, latest: { weightKg: null, waistCm: null, hipCm: null, bpSystolic: null, bpDiastolic: null, measuredOn: null } };
const score = { goodAt: 70, points: [{ wk: 1, v: 50 }, { wk: 3, v: 62 }], deltaLabel: "+12 since start", next: "", caption: "" };

describe("Your progress", () => {
  it("leads with what improved", () => {
    const body = { ...base, history: [row("2026-10-01", 80, 142, 92), row("2026-11-01", 78, 128, 84)] };
    const h = progressHeadline({ symptomScore: score, body, weightLoss: { goal: null } as never });
    expect(h[0]).toContain("wellbeing up 12");
    expect(h.some((x) => x.includes("Down 2 kg"))).toBe(true);
    expect(h.some((x) => x.includes("128/84"))).toBe(true);
  });
  it("weight is not good news without a weight goal, and a rise is never headlined", () => {
    const body = { ...base, history: [row("2026-10-01", 80), row("2026-11-01", 78)] };
    expect(progressHeadline({ symptomScore: null, body, weightLoss: null })).toEqual([]);
    const down = { ...score, points: [{ wk: 1, v: 60 }, { wk: 2, v: 55 }] };
    expect(progressHeadline({ symptomScore: down, body: { ...base, history: [] }, weightLoss: null })).toEqual([]);
  });
  it("needs two readings for a trend", () => {
    const t = progressTrends({ symptomScore: null, body: { ...base, history: [row("2026-10-01", 80)] } });
    expect(t.weight).toBeNull();
    expect(t.weightPoints).toBe(1);
  });
  it("one row when the retest falls in the full-panel week; no baseline numbers", () => {
    const rows = progressCheckpoints([
      { label: "Week 0", sub: "Baseline", value: "TSH 3.1", state: "done" },
      { label: "Week 26", sub: "First retest", value: "TSH", state: "next" },
      { label: "Week 26", sub: "Full panel", value: "Full review with Shivani", state: "todo" },
    ]);
    expect(rows.map((r) => r.value)).toEqual(["On file", "Full review with your coach"]);
    expect(rows[1].sub).toBe("Retest and full panel");
  });
  it("journey is newest first by date", () => {
    const j = journeyByDate([
      { kind: "checkin", week: 0, when: "Sat 13 Jun", date: "2026-06-13", title: "a" },
      { kind: "start", week: 0, when: "Mon 7 Sept", date: "2026-09-07", title: "b" },
    ]);
    expect(j.map((x) => x.title)).toEqual(["b", "a"]);
  });
});

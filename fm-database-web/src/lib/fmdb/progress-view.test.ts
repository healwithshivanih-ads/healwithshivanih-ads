import { describe, expect, it } from "vitest";
import { progressAsOf, progressDraftLines, progressHeadline, releasedProgress } from "./progress-view";

const row = (date: string, w: number | null, s: number | null = null, d: number | null = null) => ({
  date, weightKg: w, waistCm: null, hipCm: null, bpSystolic: s, bpDiastolic: d, moodScore: null,
});
const body = (history: ReturnType<typeof row>[]) => ({
  heightCm: null, ageYears: null, sex: "" as const,
  latest: { weightKg: null, waistCm: null, hipCm: null, bpSystolic: null, bpDiastolic: null, measuredOn: null },
  history,
});
const score = (points: { wk: number; v: number }[]) => ({ goodAt: 70, points, deltaLabel: "", next: "", caption: "" });

describe("releasedProgress", () => {
  it("is null until the coach shares", () => {
    expect(releasedProgress({}, 6, "2026-11-21")).toBeNull();
    expect(releasedProgress({ progress_shared_on: "soon" }, 6, "2026-11-21")).toBeNull();
  });

  it("places the snapshot in the week it was shared", () => {
    expect(releasedProgress({ progress_shared_on: "2026-11-21" }, 6, "2026-11-21")).toEqual({ on: "2026-11-21", week: 6, note: "", hideWeight: false });
    // shared 15 days ago: two whole weeks back
    expect(releasedProgress({ progress_shared_on: "2026-11-06" }, 6, "2026-11-21")?.week).toBe(4);
    // never before week 1
    expect(releasedProgress({ progress_shared_on: "2026-01-01" }, 3, "2026-11-21")?.week).toBe(1);
  });

  it("carries the coach's note and weight switch", () => {
    const s = releasedProgress({ progress_shared_on: "2026-11-21", progress_shared_note: "  Lovely work on sleep. ", progress_hide_weight: true }, 6, "2026-11-21");
    expect(s?.note).toBe("Lovely work on sleep.");
    expect(s?.hideWeight).toBe(true);
  });
});

describe("progressAsOf", () => {
  const data = {
    symptomScore: score([{ wk: 1, v: 50 }, { wk: 3, v: 62 }, { wk: 5, v: 40 }]),
    body: body([row("2026-10-01", 80, 142, 92), row("2026-11-01", 78, 128, 84), row("2026-11-20", 81, 150, 95)]),
    weightLoss: { goal: null } as never,
  };

  it("leaves out everything after the snapshot, so a later bad week never shows", () => {
    const v = progressAsOf(data, { on: "2026-11-10", week: 4, hideWeight: false });
    expect(v.symptomScore?.points.map((p) => p.wk)).toEqual([1, 3]);
    expect(v.body.history.map((h) => h.date)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(progressHeadline(v)).toEqual([
      "You feel better: wellbeing up 12 points since you started.",
      "Down 2 kg since 1 Oct.",
      "Blood pressure lower than at the start: 128/84 now.",
    ]);
  });

  it("has no wellbeing line until two check-ins fall inside the snapshot", () => {
    expect(progressAsOf(data, { on: "2026-10-05", week: 2, hideWeight: false }).symptomScore).toBeNull();
  });

  it("leaves weight out entirely when the coach switched it off", () => {
    const v = progressAsOf(data, { on: "2026-11-10", week: 4, hideWeight: true });
    expect(v.body.history.every((h) => h.weightKg === null)).toBe(true);
    expect(v.weightLoss).toBeNull();
    const lines = progressDraftLines(v).join(" ");
    expect(lines).not.toMatch(/kg|weight/i);
    expect(lines).toMatch(/Blood pressure 142\/92 → 128\/84/);
  });
  it("counts the check-ins when they share a week, never 'Week 0 to Week 0'", () => {
    const same = { symptomScore: score([{ wk: 0, v: 80 }, { wk: 0, v: 60 }]), body: body([]), weightLoss: null };
    expect(progressDraftLines(same)[0]).toBe("Wellbeing 80 → 60 / 100 (from 2 check-ins).");
    const apart = { symptomScore: score([{ wk: 1, v: 50 }, { wk: 4, v: 62 }]), body: body([]), weightLoss: null };
    expect(progressDraftLines(apart)).toContain("Wellbeing 50 → 62 / 100 (Week 1 to Week 4).");
  });
});

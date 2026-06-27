/**
 * Tests for the plan phase/duration logic extracted from plan-editor.tsx (#6).
 */
import { describe, it, expect } from "vitest";
import { addWeeks, todayISO, getBestDurationHint, computePhases } from "./plan-editor-phases";

describe("addWeeks", () => {
  it("advances by exactly N*7 days and returns YYYY-MM-DD (TZ-invariant)", () => {
    const base = addWeeks("2026-01-01", 0);
    const plus2 = addWeeks("2026-01-01", 2);
    const days = (Date.parse(`${plus2}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000;
    expect(days).toBe(14);
    expect(plus2).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  // NOTE: addWeeks parses LOCAL midnight but formats in UTC, so in a positive-
  // offset timezone (e.g. IST) the absolute date lands one day earlier than the
  // input implies — addWeeks("2026-01-01", 0) → "2025-12-31" in IST. Preserved
  // verbatim in the extraction; flagged as a separate fix (affects displayed
  // phase + recheck dates by a day).
});

describe("todayISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getBestDurationHint", () => {
  it("returns the first matching topic's hint", () => {
    expect(getBestDurationHint(["pcos"])?.weeks).toBe(16);
    expect(getBestDurationHint(["unknown", "insulin-resistance"])?.weeks).toBe(8);
  });
  it("returns null when no topic matches", () => {
    expect(getBestDurationHint(["nothing-here"])).toBeNull();
  });
});

describe("computePhases", () => {
  it("splits short plans into 2 contiguous phases", () => {
    const p = computePhases(4, "2026-01-01");
    expect(p.map((x) => x.name)).toEqual(["Foundation", "Build"]);
    expect(p[0].startWeek).toBe(1);
    expect(p[p.length - 1].endWeek).toBe(4);
    expect(p[1].startWeek).toBe(p[0].endWeek + 1);
  });
  it("splits a 12-week plan into Foundation / Build / Maintenance covering all weeks", () => {
    const p = computePhases(12, "2026-01-01");
    expect(p.map((x) => x.name)).toEqual(["Foundation", "Build", "Maintenance"]);
    expect(p[0].startWeek).toBe(1);
    expect(p[2].endWeek).toBe(12);
    // contiguous, no gaps
    expect(p[1].startWeek).toBe(p[0].endWeek + 1);
    expect(p[2].startWeek).toBe(p[1].endWeek + 1);
    // dates line up start→end across the boundary
    expect(p[1].startDate).toBe(p[0].endDate);
    expect(p[2].startDate).toBe(p[1].endDate);
  });
});

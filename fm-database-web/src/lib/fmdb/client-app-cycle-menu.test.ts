/**
 * Tests for three pure client-app computations that had none:
 *
 *   appMenuToWeekTables — the approved menu → the grid Today reads from
 *   computeSeedCycling  — which seeds to eat today, from her cycle dates
 *   computePeriodCare   — the ginger-tea window around her period
 *
 * All three are pure and all three drive something a client sees every day.
 * appMenuToWeekTables in particular sits directly under "the menu isn't
 * showing up" (cl-022, 2026-08-09), so its shape is worth pinning.
 *
 * NOTE: these import client-app.ts directly. vitest.config.ts aliases
 * `server-only` to an empty module precisely so that works — the module being
 * server-only is NOT a barrier to testing it, and nothing here needs extracting
 * to be covered.
 */
import { describe, it, expect } from "vitest";
import {
  appMenuToWeekTables,
  computeSeedCycling,
  computePeriodCare,
} from "./client-app";

// ── appMenuToWeekTables ──────────────────────────────────────────────────────

/** Shaped like the real app_menu block on a published plan. */
const menu = {
  weeks: [
    {
      week: 2,
      days: [
        { slots: [{ slot: "Breakfast", dish: "Omelette" }, { slot: "Lunch", dish: "Dal" }] },
        { slots: [{ slot: "Breakfast", dish: "Chilla" }, { slot: "Lunch", dish: "Rajma" }] },
      ],
    },
  ],
};

describe("appMenuToWeekTables", () => {
  it("keeps the coach's absolute week number — the app selects the table by it", () => {
    expect(appMenuToWeekTables(menu)[0].week).toBe(2);
  });

  it("always emits 7 cells per row, even when the week is short", () => {
    // Today's column is indexed by weekday; a ragged row would read the wrong
    // day's dish or undefined.
    const [t] = appMenuToWeekTables(menu);
    for (const row of t.rows) expect(row.cells).toHaveLength(7);
  });

  it("pads missing days with empty strings rather than undefined", () => {
    const [t] = appMenuToWeekTables(menu);
    const breakfast = t.rows.find((r) => r.slot === "Breakfast")!;
    expect(breakfast.cells.slice(0, 2)).toEqual(["Omelette", "Chilla"]);
    expect(breakfast.cells.slice(2)).toEqual(["", "", "", "", ""]);
  });

  it("orders slots by first appearance across the week, not alphabetically", () => {
    const [t] = appMenuToWeekTables(menu);
    expect(t.rows.map((r) => r.slot)).toEqual(["Breakfast", "Lunch"]);
  });

  it("picks each day's dish by SLOT NAME, not by position", () => {
    // A day that lists its slots in a different order must not shift dishes
    // into the wrong meal.
    const shuffled = {
      weeks: [
        {
          week: 1,
          days: [{ slots: [{ slot: "Lunch", dish: "Dal" }, { slot: "Breakfast", dish: "Poha" }] }],
        },
      ],
    };
    const [t] = appMenuToWeekTables(shuffled);
    expect(t.rows.find((r) => r.slot === "Breakfast")!.cells[0]).toBe("Poha");
    expect(t.rows.find((r) => r.slot === "Lunch")!.cells[0]).toBe("Dal");
  });

  it("defaults a missing week number to 1 instead of NaN", () => {
    expect(appMenuToWeekTables({ weeks: [{ days: [] }] })[0].week).toBe(1);
  });

  it("survives an empty or malformed menu without throwing", () => {
    expect(appMenuToWeekTables({})).toEqual([]);
    expect(appMenuToWeekTables({ weeks: [] })).toEqual([]);
  });
});

// ── computeSeedCycling ───────────────────────────────────────────────────────

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("computeSeedCycling", () => {
  it("shows nothing when the feature is off", () => {
    expect(computeSeedCycling(false, {}, day("2026-08-09"))).toBeNull();
  });

  it("asks for the date rather than guessing when there is no LMP", () => {
    const r = computeSeedCycling(true, {}, day("2026-08-09"))!;
    expect(r.needsDate).toBe(true);
    expect(r.today.seeds).toEqual([]);
  });

  it("gives all four seeds daily when there is no cycle to phase to", () => {
    for (const status of ["postmenopausal", "not_applicable", "POSTMENOPAUSAL"]) {
      const r = computeSeedCycling(true, { cycle_status: status }, day("2026-08-09"))!;
      expect(r.mode, status).toBe("daily");
      expect(r.today.seeds, status).toHaveLength(4);
      expect(r.needsDate, status).toBe(false);
    }
  });

  it("counts day 1 as the first day of bleeding, not day 0", () => {
    const r = computeSeedCycling(
      true,
      { last_menstrual_period: "2026-08-09" },
      day("2026-08-09"),
    )!;
    expect(r.dayInCycle).toBe(1);
    expect(r.phase).toBe("follicular");
  });

  it("switches to luteal just after mid-cycle", () => {
    const c = { last_menstrual_period: "2026-08-01", cycle_length_days: 28 };
    // ovulation = round(28/2) = 14 → day 14 follicular, day 15 luteal
    expect(computeSeedCycling(true, c, day("2026-08-14"))!.phase).toBe("follicular");
    expect(computeSeedCycling(true, c, day("2026-08-15"))!.phase).toBe("luteal");
  });

  it("serves the seeds that match the phase", () => {
    const c = { last_menstrual_period: "2026-08-01", cycle_length_days: 28 };
    expect(computeSeedCycling(true, c, day("2026-08-05"))!.today.seeds).toEqual([
      "flaxseed",
      "pumpkin seed",
    ]);
    expect(computeSeedCycling(true, c, day("2026-08-20"))!.today.seeds).toEqual([
      "sesame (til)",
      "sunflower seed",
    ]);
  });

  it("wraps a STALE period date instead of running off the end of the cycle", () => {
    // A client who hasn't tapped "my period started" for months must still get
    // a sane day number, not day 97.
    const r = computeSeedCycling(
      true,
      { last_menstrual_period: "2026-05-01", cycle_length_days: 28 },
      day("2026-08-09"),
    )!;
    expect(r.dayInCycle).toBeGreaterThanOrEqual(1);
    expect(r.dayInCycle).toBeLessThanOrEqual(28);
  });

  it("falls back to a 28-day cycle when the length is missing or implausible", () => {
    for (const len of [undefined, 0, 3, 90, "abc"]) {
      const r = computeSeedCycling(
        true,
        { last_menstrual_period: "2026-08-01", cycle_length_days: len },
        day("2026-08-09"),
      )!;
      expect(r.cycleLength, String(len)).toBe(28);
    }
  });

  it("honours a plausible custom cycle length", () => {
    const r = computeSeedCycling(
      true,
      { last_menstrual_period: "2026-08-01", cycle_length_days: 35 },
      day("2026-08-09"),
    )!;
    expect(r.cycleLength).toBe(35);
  });
});

// ── computePeriodCare ────────────────────────────────────────────────────────

describe("computePeriodCare", () => {
  const c = { last_menstrual_period: "2026-08-01", cycle_length_days: 28 };

  it("shows nothing when the feature is off, or with no date", () => {
    expect(computePeriodCare(false, c, day("2026-08-02"))).toBeNull();
    expect(computePeriodCare(true, {}, day("2026-08-02"))).toBeNull();
  });

  it("stays silent for a client with no ovulatory cycle", () => {
    for (const status of ["postmenopausal", "not_applicable"]) {
      expect(computePeriodCare(true, { ...c, cycle_status: status }, day("2026-08-02"))).toBeNull();
    }
  });

  it("prompts through the first few crampy days", () => {
    // days 1-4 of the cycle
    for (const d of ["2026-08-01", "2026-08-04"]) {
      const r = computePeriodCare(true, c, day(d))!;
      expect(r, d).not.toBeNull();
      expect(r.heading, d).toBe("Ginger tea for cramps");
    }
  });

  it("prompts again ~2 days BEFORE the next period, to get ahead of it", () => {
    // cycle day 26+ of 28 → 2026-08-26 is day 26
    const r = computePeriodCare(true, c, day("2026-08-26"))!;
    expect(r.heading).toBe("Your period's due soon");
    expect(r.line).toMatch(/day/i);
  });

  it("stays silent through the middle of the cycle — the whole point", () => {
    for (const d of ["2026-08-08", "2026-08-15", "2026-08-20"]) {
      expect(computePeriodCare(true, c, day(d)), d).toBeNull();
    }
  });

  it("always carries the recipe when it does show", () => {
    const r = computePeriodCare(true, c, day("2026-08-02"))!;
    expect(r.recipe).toMatch(/ginger/i);
  });
});

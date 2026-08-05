/**
 * Weekly check-in pre-fill from the daily tick log.
 *
 * The rules under test are safety rules, not conveniences:
 * - sparse tick data must produce NO pre-fill (two days can't speak for a week)
 * - an unticked item must never be pre-filled "Stopped" — absence of a tick is
 *   silence, not a confession
 * - the newest row for a date wins (the shim upserts whole days)
 * - ratio is against days the item APPEARED, so a mid-week plan change doesn't
 *   read as slipping
 */
import { describe, it, expect } from "vitest";
import { deriveCheckinPrefill, type TickRowLite } from "./client-app";

const REF = "2026-08-05";

function day(date: string, done: Record<string, boolean>, kind = "supplement"): TickRowLite {
  return {
    date,
    items: Object.entries(done).map(([id, d]) => ({ kind, id, done: d })),
  };
}

describe("deriveCheckinPrefill", () => {
  it("returns nothing with fewer than 3 active tick days", () => {
    const rows = [day("2026-08-04", { a: true }), day("2026-08-05", { a: true })];
    expect(deriveCheckinPrefill(rows, REF)).toEqual({ supplements: {}, practices: {} });
  });

  it("pre-fills steady (0) at ≥65% and sometimes (1) below", () => {
    const rows = [
      day("2026-08-01", { a: true, b: true }),
      day("2026-08-02", { a: true, b: false }),
      day("2026-08-03", { a: true, b: false }),
      day("2026-08-04", { a: true, b: true }),
    ];
    const out = deriveCheckinPrefill(rows, REF);
    expect(out.supplements.a).toBe(0); // 4/4
    expect(out.supplements.b).toBe(1); // 2/4
  });

  it("never pre-fills an item that was never ticked", () => {
    const rows = [
      day("2026-08-01", { a: true, c: false }),
      day("2026-08-02", { a: true, c: false }),
      day("2026-08-03", { a: true, c: false }),
    ];
    const out = deriveCheckinPrefill(rows, REF);
    expect(out.supplements.a).toBe(0);
    expect(out.supplements.c).toBeUndefined();
  });

  it("routes practices into their own bucket", () => {
    const rows = [
      day("2026-08-01", { walk: true }, "practice"),
      day("2026-08-02", { walk: true }, "practice"),
      day("2026-08-03", { walk: true }, "practice"),
    ];
    const out = deriveCheckinPrefill(rows, REF);
    expect(out.practices.walk).toBe(0);
    expect(out.supplements).toEqual({});
  });

  it("lets the newest row for a date win (upsert semantics)", () => {
    const rows = [
      day("2026-08-01", { a: true }),
      day("2026-08-02", { a: true }),
      day("2026-08-03", { a: true }),
      // later correction of the 3rd: unticked after all
      day("2026-08-03", { a: false }),
    ];
    // day 3 now has no done items → only 2 active days → no pre-fill
    expect(deriveCheckinPrefill(rows, REF)).toEqual({ supplements: {}, practices: {} });
  });

  it("ignores rows outside the trailing window", () => {
    const rows = [
      day("2026-07-01", { a: true }),
      day("2026-07-02", { a: true }),
      day("2026-07-03", { a: true }),
    ];
    expect(deriveCheckinPrefill(rows, REF)).toEqual({ supplements: {}, practices: {} });
  });

  it("measures each item against the days it appeared, not the whole window", () => {
    const rows = [
      day("2026-08-01", { a: true }),
      day("2026-08-02", { a: true }),
      day("2026-08-03", { a: true, later: true }),
      day("2026-08-04", { a: true, later: true }),
      day("2026-08-05", { a: true, later: true }),
    ];
    // "later" joined the plan mid-week: 3 ticks of 3 appearances = steady,
    // not "sometimes" for missing days it didn't exist on.
    expect(deriveCheckinPrefill(rows, REF).supplements.later).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { ClientAppData } from "./client-app";
import { foldSupply, parsePackSize, supplyStatus, timesPerDay, unitsPerDay, type SupplyLine } from "./supply";
import { leftWords, lowRows } from "./supply-rows";

const caps = { count: 60, unit: "capsules" };

describe("units a day, never guessed", () => {
  it("reads a count in the dose", () => {
    expect(unitsPerDay("2 capsules", "with breakfast", undefined, caps)).toBe(2);
    expect(unitsPerDay("1 capsule", "twice daily with meals", undefined, caps)).toBe(2);
    expect(unitsPerDay("1-2 capsules", "with dinner", undefined, caps)).toBe(2);
    expect(unitsPerDay("one tablet", "with breakfast and dinner", undefined, { count: 30, unit: "tablets" })).toBe(2);
  });
  it("divides a strength by the product's strength per unit", () => {
    expect(unitsPerDay("200 mg elemental", "with the evening meal", "100 mg elemental magnesium per capsule", caps)).toBe(2);
    expect(unitsPerDay("1000 mg", "with lunch", "500 mg per capsule (1000 mg per 2-cap serving)", caps)).toBe(2);
    expect(unitsPerDay("100 mcg", "with breakfast", "100 mcg per tablet", caps)).toBe(1);
  });
  it("gives up rather than guess", () => {
    expect(unitsPerDay("200 mg", "with dinner", undefined, caps)).toBeNull();
    expect(unitsPerDay("5 g", "in water", undefined, { count: 100, unit: "g" })).toBeNull();
    expect(unitsPerDay("1 capsule", "as needed", undefined, caps)).toBeNull();
    expect(unitsPerDay("1 capsule", "alternate days", undefined, caps)).toBeNull();
  });
  it("counts times a day from the timing", () => {
    expect(timesPerDay("with breakfast")).toBe(1);
    expect(timesPerDay("morning and bedtime")).toBe(2);
    expect(timesPerDay("three times daily")).toBe(3);
  });
  it("reads only a real pack size", () => {
    expect(parsePackSize({ count: 120, unit: "capsules", source: "url" })).toEqual({ count: 120, unit: "capsules" });
    expect(parsePackSize({ unit: "capsules" })).toBeNull();
    expect(parsePackSize(undefined)).toBeNull();
  });
});

const L = (op: SupplyLine["op"], ts: string, date?: string): SupplyLine => ({ op, item: "s-mag", ts, ...(date ? { date } : {}) });

describe("the taps", () => {
  it("ordered then arrived starts the count; undo steps back one tap", () => {
    expect(foldSupply([L("ordered", "2026-11-01T10:00:00Z")])["s-mag"]).toEqual({ orderedAt: "2026-11-01T10:00:00Z" });
    const arrived = [L("ordered", "2026-11-01T10:00:00Z"), L("arrived", "2026-11-04T09:00:00Z", "2026-11-04")];
    expect(foldSupply(arrived)["s-mag"]).toEqual({ arrivedOn: "2026-11-04" });
    expect(foldSupply([...arrived, L("undo", "2026-11-04T09:01:00Z")])["s-mag"]).toEqual({ orderedAt: "2026-11-01T10:00:00Z" });
    expect(foldSupply([L("ordered", "2026-11-01T10:00:00Z"), L("undo", "2026-11-01T10:01:00Z")])["s-mag"]).toBeUndefined();
  });
  it("a reorder keeps counting the pack in hand", () => {
    const s = foldSupply([L("arrived", "2026-11-01T09:00:00Z", "2026-11-01"), L("ordered", "2026-11-20T10:00:00Z")])["s-mag"];
    const st = supplyStatus(s, caps, 2, "2026-11-25");
    expect(st).toMatchObject({ state: "ordered", runsOutOn: "2026-11-30", daysLeft: 5 });
  });
});

describe("running low", () => {
  const arrived = { arrivedOn: "2026-11-01" };
  it("60 capsules at 2 a day lasts 30 days", () => {
    expect(supplyStatus(arrived, caps, 2, "2026-11-10")).toMatchObject({ state: "arrived", runsOutOn: "2026-11-30" });
    expect(supplyStatus(arrived, caps, 2, "2026-11-23")).toMatchObject({ state: "low", daysLeft: 7 });
    expect(supplyStatus(arrived, caps, 2, "2026-12-01")).toMatchObject({ state: "out" });
  });
  it("no pack size or dose: no date, no card", () => {
    expect(supplyStatus(arrived, null, null, "2026-11-29")).toEqual({ state: "arrived" });
    expect(supplyStatus({ have: true }, caps, 2, "2026-11-29")).toEqual({ state: "arrived" });
  });
  it("says it in words", () => {
    expect(leftWords({ state: "low", runsOutOn: "2026-11-30", daysLeft: 6 })).toBe("about 6 days left");
    expect(leftWords({ state: "low", runsOutOn: "2026-11-30", daysLeft: 1 })).toBe("runs out tomorrow");
  });
  it("Home lists only rows running low, soonest first", () => {
    const data = {
      supplements: [
        { id: "s-mag", name: "Magnesium", buyUrl: "https://vitaone.in/m", pack: { ...caps, perDay: 2 } },
        { id: "s-sel", name: "Selenium", buyUrl: "https://vitaone.in/s", pack: { count: 30, unit: "tablets", perDay: 1 } },
        { id: "s-d3", name: "D3", buyUrl: "https://vitaone.in/d" },
      ],
      upcomingSupplements: [],
      remedies: [],
      supply: { "s-mag": { arrivedOn: "2026-11-01" }, "s-sel": { arrivedOn: "2026-10-28" }, "s-d3": { arrivedOn: "2026-10-01" } },
    } as unknown as ClientAppData;
    expect(lowRows(data, "2026-11-24").map((x) => x.row.name)).toEqual(["Selenium", "Magnesium"]);
  });
});

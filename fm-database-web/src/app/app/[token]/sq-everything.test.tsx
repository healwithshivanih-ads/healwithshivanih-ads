import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { checkVitals, orderRows, shopOf, travellingNow, weightLine } from "./sq-everything";

describe("weight and blood pressure", () => {
  it("takes either or both", () => {
    expect(checkVitals("68.5", "")).toEqual({ weightKg: 68.5 });
    expect(checkVitals("68 kg", "118/76")).toMatchObject({ weightKg: 68, sys: 118, dia: 76, high: false });
  });
  it("says what is wrong", () => {
    expect(checkVitals("", "").error).toBe("Enter at least one of the two.");
    expect(checkVitals("6.8", "").error).toMatch(/kg, like 68.5/);
    expect(checkVitals("", "76/118").error).toBe("The first number is the higher one, like 118/76.");
    expect(checkVitals("", "118 76").error).toMatch(/two numbers/);
  });
  it("flags a high reading", () => {
    expect(checkVitals("", "182/96").high).toBe(true);
  });
  it("shows the change in words", () => {
    expect(weightLine([{ date: "2026-11-01", weightKg: 70 }])).toBe("Log it twice to see the change.");
    expect(weightLine([{ date: "2026-11-01", weightKg: 70 }, { date: "2026-11-19", weightKg: 68.5 }])).toMatch(/^68.5 kg, down 1.5 kg since/);
  });
});

describe("travel and orders", () => {
  const base = { travel: { from: "2026-11-24", to: "2026-11-26", kind: "travel" } } as unknown as ClientAppData;
  it("shows the Travelling card from the day of travel, not before", () => {
    expect(travellingNow(base, "2026-11-23")).toBe(false);
    expect(travellingNow(base, "2026-11-24")).toBe(true);
    expect(travellingNow(base, "2026-11-27")).toBe(false);
  });
  it("lists supplements and assigned remedies with a shop", () => {
    const d = {
      supplements: [{ id: "s1", name: "Magnesium", buyUrl: "https://vitaone.in/x" }],
      upcomingSupplements: [{ id: "s2", name: "Omega-3", startsNextWeek: true }],
      remedies: [{ slug: "r", name: "Triphala", assigned: true, buyUrl: "https://amazon.in/y" }],
    } as unknown as ClientAppData;
    const rows = orderRows(d);
    expect(rows.map((r) => r.name)).toEqual(["Magnesium", "Omega-3 (starts next week)", "Triphala"]);
    expect(shopOf("https://vitaone.in/x")).toBe("VitaOne");
  });
  it("never names the coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "sq-everything.tsx"), "utf8");
    expect(src).not.toMatch(/coach\.name|data\.coach|wa\.me/);
  });
});

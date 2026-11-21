/**
 * Results reach a client's app only after the coach shares them, and then
 * only as numbers with a plain within / above / below tag.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LabVault } from "./lab-vault";
import { TAG_WORDS, bodyAgeOf, rangeTag, releasedResults } from "./released-results";

const marker = (displayName: string, latestValue: number, low?: number, high?: number, extra: Record<string, unknown> = {}) => ({
  key: displayName,
  testName: displayName,
  displayName,
  unit: "ng/mL",
  latestValue,
  latestDate: "2026-10-26",
  prevValue: null,
  delta: null,
  status: "optimal",
  fmOptimal: null,
  conventional: low === undefined && high === undefined ? null : { low, high },
  system: "Vitamins",
  systemIcon: "",
  targetedByPlan: false,
  unitMismatch: false,
  trend: [],
  hasTrend: false,
  ...extra,
});
const VAULT = {
  groups: [{ system: "Vitamins", icon: "", markers: [marker("Vitamin D", 18, 30, 100), marker("Vitamin B12", 450, 200, 900), marker("Ferritin", 400, 15, 150), marker("Homocysteine", 9)] }],
  pinned: [],
  summary: { total: 4, optimal: 0, explore: 0, noReference: 0 },
  asOf: "2026-10-26",
  mode: "plan",
} as unknown as LabVault;
const PHENO = [{ marker_name: "PhenoAge (research score)", value: 45.04, unit: "years", fm_interpretation: "PhenoAge 45.0 at calendar age 53: reading younger." }];

describe("releasedResults", () => {
  it("is nothing at all until the coach shares", () => {
    expect(releasedResults({ lab_markers: PHENO }, VAULT)).toBeNull();
    expect(releasedResults({ results_shared_on: "  ", lab_markers: PHENO }, VAULT)).toBeNull();
  });
  it("once shared, carries body age, the note and every number with its tag", () => {
    const r = releasedResults({ results_shared_on: "2026-11-20", results_shared_note: " Good news first. ", lab_markers: PHENO, lab_markers_date: "2026-10-26" }, VAULT)!;
    expect(r.sharedOn).toBe("2026-11-20");
    expect(r.note).toBe("Good news first.");
    expect(r.bodyAge).toEqual({ value: 45, calendarAge: 53, date: "2026-10-26" });
    expect(r.groups[0].rows.map((x) => `${x.name}:${x.tag}:${x.range}`)).toEqual([
      "Vitamin D:below:30 to 100 ng/mL",
      "Vitamin B12:within:200 to 900 ng/mL",
      "Ferritin:above:15 to 150 ng/mL",
      "Homocysteine:none:",
    ]);
  });
  it("adds no interpretation text of its own", () => {
    const r = releasedResults({ results_shared_on: "2026-11-20" }, VAULT)!;
    expect(JSON.stringify(r)).not.toMatch(/deficien|risk|concern|worry|good|bad|optimal/i);
  });
});

describe("rangeTag", () => {
  it("says nothing when the units do not match the range", () => {
    expect(rangeTag({ latestValue: 5, conventional: { low: 1, high: 3 }, unitMismatch: true })).toBe("none");
  });
  it("handles an upper or lower limit only", () => {
    expect(rangeTag({ latestValue: 5, conventional: { high: 3 }, unitMismatch: false })).toBe("above");
    expect(rangeTag({ latestValue: 5, conventional: { low: 6 }, unitMismatch: false })).toBe("below");
  });
  it("uses the coach's wording", () => {
    expect(TAG_WORDS.above).toBe("Above the usual range");
    expect(TAG_WORDS.below).toBe("Below the usual range");
  });
});

describe("bodyAgeOf", () => {
  it("is null when body age was never worked out", () => {
    expect(bodyAgeOf([], null)).toBeNull();
    expect(bodyAgeOf(undefined, null)).toBeNull();
    expect(bodyAgeOf([{ marker_name: "PhenoAge (research score)", value: "n/a" }], null)).toBeNull();
  });
});

describe("wiring", () => {
  const root = path.resolve(__dirname, "../../..");
  it("the switch and the markers are projected to Fly", () => {
    const src = fs.readFileSync(path.join(root, "scripts/app-staging-action.py"), "utf8");
    for (const k of ["results_shared_on", "results_shared_note", "lab_markers", "lab_markers_date"]) expect(src).toContain(`"${k}",`);
  });
  it("released results ride only with the new front's data", () => {
    const src = fs.readFileSync(path.join(root, "src/lib/fmdb/client-app.ts"), "utf8");
    expect(src.match(/releasedResults\(/g)).toHaveLength(1);
    expect(src).toMatch(/sq: sqShell === "v2" \? await loadSqData\([^)]*releasedResults\(client, labVault\)[,)]/);
  });
});

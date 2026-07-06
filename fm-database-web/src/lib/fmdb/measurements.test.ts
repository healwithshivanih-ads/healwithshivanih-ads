import { describe, it, expect } from "vitest";
import {
  collectMeasurementSnapshots,
  latestMeasurements,
  validateMeasurement,
  inchesToCm,
  cmToInches,
  ftInToCm,
  cmToFtIn,
  lbToKg,
} from "./measurements";

describe("collectMeasurementSnapshots", () => {
  it("unions all three stores and dedupes field-level by date", () => {
    const snaps = collectMeasurementSnapshots({
      measurements: { weight_kg: 82, measured_on: "2026-05-01" },
      health_snapshots: [
        { date: "2026-05-10", source: "lab", measurements: { weight_kg: 80 }, lab_values: [{ test_name: "TSH", value: "2.1", unit: "mIU/L" }] },
      ],
      measurements_log: [
        { date: "2026-05-20", weight_kg: 79, waist_cm: 90 },
      ],
    });
    expect(snaps.map((s) => s.date)).toEqual(["2026-05-01", "2026-05-10", "2026-05-20"]);
    expect(snaps[2].measurements.weight_kg).toBe(79);
    expect(snaps[1].lab_values[0].test_name).toBe("TSH");
  });

  it("counts a coach measurements_log weight the health-trends chart would otherwise miss (Geetika case)", () => {
    // Newest health_snapshot is older; the fresh weight is only in measurements_log.
    const latest = latestMeasurements({
      health_snapshots: [{ date: "2026-06-10", measurements: { weight_kg: 122 } }],
      measurements_log: [{ date: "2026-06-30", weight_kg: 120.8, waist_cm: 117 }],
    });
    expect(latest?.date).toBe("2026-06-30");
    expect(latest?.measurements.weight_kg).toBe(120.8);
  });

  it("maps the differing BP/HR field names across stores to canonical keys", () => {
    // measurements_log uses blood_pressure_*/resting_heart_rate; snapshots use bp_*/hr_bpm.
    const [s] = collectMeasurementSnapshots({
      measurements_log: [
        { date: "2026-06-01", blood_pressure_systolic: 118, blood_pressure_diastolic: 76, resting_heart_rate: 64 },
      ],
    });
    expect(s.measurements.bp_systolic).toBe(118);
    expect(s.measurements.bp_diastolic).toBe(76);
    expect(s.measurements.hr_bpm).toBe(64);
  });

  it("parses a flat 'S/D' blood_pressure string", () => {
    const [s] = collectMeasurementSnapshots({
      measurements: { measured_on: "2026-06-01", blood_pressure: "130/85" },
    });
    expect(s.measurements.bp_systolic).toBe(130);
    expect(s.measurements.bp_diastolic).toBe(85);
  });

  it("merges a lab-only snapshot and a same-date coach weight log into one entry", () => {
    const [s] = collectMeasurementSnapshots({
      health_snapshots: [{ date: "2026-06-05", measurements: {}, lab_values: [{ test_name: "Ferritin", value: "45", unit: "ng/mL" }] }],
      measurements_log: [{ date: "2026-06-05", weight_kg: 75 }],
    });
    expect(s.measurements.weight_kg).toBe(75);
    expect(s.lab_values[0].test_name).toBe("Ferritin");
  });
});

describe("latestMeasurements (the '3 stores' landmine)", () => {
  it("keeps an older field's value alive when a newer entry only repeats a DIFFERENT field", () => {
    // The bug: waist/BP were last recorded by the coach two weeks ago; today
    // the client app logs weight only. The old implementation returned just
    // the literal last-dated snapshot's fields (weight only), silently
    // dropping waist/BP even though nothing changed. Each field must surface
    // its own true latest value, independent of the others.
    const latest = latestMeasurements({
      measurements_log: [
        { date: "2026-06-20", waist_cm: 82, bp_systolic: 118, bp_diastolic: 76 },
      ],
      health_snapshots: [
        { date: "2026-07-06", source: "client_app", measurements: { weight_kg: 79.5 } },
      ],
    });
    expect(latest?.measurements.weight_kg).toBe(79.5);
    expect(latest?.measurements.waist_cm).toBe(82);
    expect(latest?.measurements.bp_systolic).toBe(118);
    expect(latest?.measurements.bp_diastolic).toBe(76);
    // the "as of" caption reflects whichever field was touched most recently
    expect(latest?.date).toBe("2026-07-06");
  });

  it("picks each field's own most recent value even when sources interleave across dates", () => {
    const latest = latestMeasurements({
      health_snapshots: [
        { date: "2026-05-01", measurements: { weight_kg: 82, hr_bpm: 70 } },
        { date: "2026-06-15", measurements: { weight_kg: 80 } },
      ],
      measurements_log: [
        { date: "2026-06-01", waist_cm: 90, hip_cm: 100 },
        { date: "2026-06-10", hip_cm: 98 },
      ],
    });
    expect(latest?.measurements.weight_kg).toBe(80); // 06-15, newest weight
    expect(latest?.measurements.waist_cm).toBe(90); // only ever set 06-01
    expect(latest?.measurements.hip_cm).toBe(98); // 06-10 overwrote 06-01
    expect(latest?.measurements.hr_bpm).toBe(70); // only ever set 05-01, must still surface
    expect(latest?.date).toBe("2026-06-15");
  });

  it("returns null when there is nothing on file", () => {
    expect(latestMeasurements({})).toBeNull();
  });
});

describe("unit conversion", () => {
  it("inch/cm round-trips", () => {
    expect(inchesToCm(36)).toBeCloseTo(91.4, 1);
    expect(cmToInches(91.4)).toBeCloseTo(36, 0);
  });
  it("ft+in → cm and back", () => {
    expect(ftInToCm(5, 6)).toBeCloseTo(167.6, 1);
    const { ft, inch } = cmToFtIn(167.6);
    expect(ft).toBe(5);
    expect(inch).toBeCloseTo(6, 0);
  });
  it("lb → kg", () => {
    expect(lbToKg(150)).toBeCloseTo(68, 0);
  });
});

describe("validateMeasurement (the cl-017 waist/hip bug)", () => {
  it("rejects a negative hip (-1.5) — the exact corrupt value on file", () => {
    const r = validateMeasurement("hip_cm", -1.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/positive/);
  });
  it("rejects a 36 cm waist as implausible and hints at inches → 91 cm", () => {
    const r = validateMeasurement("waist_cm", 36);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/91\.4 cm/);
  });
  it("accepts the corrected 91.4 cm waist", () => {
    expect(validateMeasurement("waist_cm", 91.4)).toEqual({ ok: true, value: 91.4 });
  });
  it("rejects a waist entered in cm that is really an inch-count out of range (231)", () => {
    // e.g. 91 inches typed into the inch box → 231 cm, above ceiling
    expect(validateMeasurement("waist_cm", 231).ok).toBe(false);
  });
  it("accepts a normal height and rejects a height entered in inches (66)", () => {
    expect(validateMeasurement("height_cm", 168).ok).toBe(true);
    expect(validateMeasurement("height_cm", 66).ok).toBe(false);
  });
  it("passes through unknown keys unchecked", () => {
    expect(validateMeasurement("something_else", 5)).toEqual({ ok: true, value: 5 });
  });
});

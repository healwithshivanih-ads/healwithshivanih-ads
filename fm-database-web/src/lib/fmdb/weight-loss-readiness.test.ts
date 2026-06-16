import { describe, it, expect } from "vitest";
import { assessWeightLossReadiness } from "./weight-loss-readiness";

function snap(date: string, labs: Array<[string, string | number]>) {
  return { date, lab_values: labs.map(([test_name, value]) => ({ test_name, value: String(value) })) };
}

describe("assessWeightLossReadiness", () => {
  it("is ready with optimal labs, no meds, good sleep, not perimenopausal", () => {
    const r = assessWeightLossReadiness({
      sex: "F",
      age_band: "30-35",
      five_pillars: { sleep_hours: 8, sleep_quality: 4, stress_level: 2 },
      health_snapshots: [snap("2026-06-01", [["TSH", 1.8], ["Fasting Insulin", 4], ["Fasting Glucose", 85]])],
    });
    expect(r.verdict).toBe("ready");
    expect(r.flags).toHaveLength(0);
  });

  it("flags high TSH as address_first", () => {
    const r = assessWeightLossReadiness({
      health_snapshots: [snap("2026-06-01", [["TSH", 5.2]])],
    });
    expect(r.verdict).toBe("address_first");
    expect(r.flags.find((f) => f.key === "thyroid")?.severity).toBe("high");
  });

  it("flags suboptimal TSH (2.5-4) as caution and notes thyroid meds", () => {
    const r = assessWeightLossReadiness({
      current_medications: ["Levothyroxine 50mcg"],
      health_snapshots: [snap("2026-06-01", [["TSH", 3.4]])],
    });
    expect(r.verdict).toBe("caution");
    const t = r.flags.find((f) => f.key === "thyroid");
    expect(t?.severity).toBe("med");
    expect(t?.detail).toMatch(/medication/i);
  });

  it("computes HOMA-IR and flags insulin resistance", () => {
    const r = assessWeightLossReadiness({
      // glucose 100 × insulin 12 / 405 = 2.96 → high
      health_snapshots: [snap("2026-06-01", [["Fasting Glucose", 100], ["Fasting Insulin", 12]])],
    });
    const ir = r.flags.find((f) => f.key === "insulin_resistance");
    expect(ir?.severity).toBe("high");
    expect(r.verdict).toBe("address_first");
  });

  it("flags weight-gain medications with coordinate-with-prescriber wording", () => {
    const r = assessWeightLossReadiness({ current_medications: ["Sertraline 50mg", "Metformin 500mg"] });
    const med = r.flags.find((f) => f.key.startsWith("med:"));
    expect(med).toBeTruthy();
    expect(med?.detail).toMatch(/prescriber/i);
    // metformin must NOT flag (it doesn't cause weight gain)
    expect(r.flags.some((f) => /metformin/i.test(f.label))).toBe(false);
  });

  it("flags poor sleep + high stress as a cortisol blocker", () => {
    const r = assessWeightLossReadiness({
      five_pillars: { sleep_hours: 5, stress_level: 5 },
    });
    expect(r.flags.find((f) => f.key === "cortisol")?.severity).toBe("med");
    expect(r.verdict).toBe("caution");
  });

  it("adds a perimenopause informational note for a woman 44-56", () => {
    const r = assessWeightLossReadiness({ sex: "F", age_band: "50-55" });
    const peri = r.flags.find((f) => f.key === "perimenopause");
    expect(peri?.severity).toBe("info");
    // info-only → still "ready" verdict (not a blocker, just guidance)
    expect(r.verdict).toBe("ready");
  });

  it("uses the most recent snapshot's value", () => {
    const r = assessWeightLossReadiness({
      health_snapshots: [
        snap("2026-01-01", [["TSH", 5.5]]),
        snap("2026-06-01", [["TSH", 1.9]]), // newer, optimal
      ],
    });
    expect(r.flags.some((f) => f.key === "thyroid")).toBe(false);
  });

  it("records what it couldn't check (honest missing list)", () => {
    const r = assessWeightLossReadiness({ sex: "M", age_band: "40-45" });
    expect(r.missing).toContain("thyroid labs (no TSH on file)");
  });
});

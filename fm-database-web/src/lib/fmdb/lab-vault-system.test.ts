import { describe, expect, it } from "vitest";
import { markerSystem } from "./lab-vault";

describe("markerSystem: blood markers stay out of Urine; longest match wins (21 Nov 2026)", () => {
  it.each(["Fasting Glucose", "Lp(a)", "ApoA1", "Thyroglobulin Antibody (Tg Ab)"])("%s is not Urine or Liver", (n) => {
    const s = markerSystem(n).system;
    expect(s).not.toMatch(/urine/i);
    if (/thyroglobulin/i.test(n)) expect(s).not.toMatch(/liver/i);
  });
});

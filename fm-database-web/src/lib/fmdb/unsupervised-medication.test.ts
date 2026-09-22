import { describe, it, expect } from "vitest";
import { detectUnsupervisedMedication } from "./unsupervised-medication";

/** The real shape that went undetected — Shweta, cl-906. */
const SHWETA = {
  current_mental_health_care: "No",
  psych_medications: [
    {
      name: "Alprazolam 0.25 & melatonin 3mg",
      still_taking: true,
      side_effects: "Alert mind, insomnia & headache if I stop",
    },
  ],
  current_medications: ["Shell cal 500, omez 20, restil 0.25, melatonin 3mg"],
};

describe("detectUnsupervisedMedication", () => {
  it("catches the case it was built for, at critical", () => {
    const a = detectUnsupervisedMedication(SHWETA)!;
    expect(a).not.toBeNull();
    expect(a.severity).toBe("critical"); // her own words describe withdrawal
    expect(a.findings.some((f) => f.drugClass === "Benzodiazepine")).toBe(true);
    expect(a.findings.some((f) => f.withdrawalEvidence)).toBe(true);
    // the free-text list names the SAME drug under an Indian brand — both rows
    // are evidence, and the brand is the one a coach might not recognise
    expect(a.findings.some((f) => /restil/i.test(f.reported))).toBe(true);
    expect(a.actions[0]).toMatch(/do not suggest reducing or stopping/i);
    // The referral is for a TAPER. Wording that implies legitimising or
    // continuing the drug is wrong: a self-started dependence has no
    // indication to treat.
    expect(a.actions[1]).toMatch(/supervised taper/i);
    expect(a.actions[1]).not.toMatch(/take it over/i);
    // The quote is rendered to the coach in quotation marks, so it must not
    // start or end mid-word — it read "ert mind, insomnia..." before the fix.
    const quote = a.findings.find((f) => f.withdrawalEvidence)!.withdrawalEvidence!;
    expect(quote).toContain("Alert mind");
    expect(quote).not.toMatch(/^[a-z]/);
  });

  it("stays silent when the client IS under mental health care", () => {
    expect(
      detectUnsupervisedMedication({ ...SHWETA, current_mental_health_care: "Yes" }),
    ).toBeNull();
  });

  // cleared vs unknown: a blank field means the question was never answered.
  // It must never manufacture a safety flag out of missing data.
  it("stays silent when supervision was never asked", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(
        detectUnsupervisedMedication({ ...SHWETA, current_mental_health_care: v }),
      ).toBeNull();
    }
  });

  it("stays silent on ordinary medications", () => {
    expect(
      detectUnsupervisedMedication({
        current_mental_health_care: "No",
        current_medications: ["Thyronorm 50mcg", "Omez 20", "Shell cal 500", "Becosules"],
      }),
    ).toBeNull();
  });

  it("drops a drug the client has stopped", () => {
    expect(
      detectUnsupervisedMedication({
        current_mental_health_care: "No",
        psych_medications: [{ name: "Alprazolam 0.25", still_taking: false }],
      }),
    ).toBeNull();
  });

  it("warns rather than criticals when there is no withdrawal language", () => {
    const a = detectUnsupervisedMedication({
      current_mental_health_care: "No",
      current_medications: ["Zolfresh 10 at night"],
    })!;
    expect(a.severity).toBe("warning");
    expect(a.findings[0].drugClass).toBe("Z-drug sedative-hypnotic");
  });

  // Same failure mode drug-match.ts was bitten by: a short term hiding inside
  // a longer unrelated word. "codein" must not fire on "codeine-free", and no
  // term may match mid-word.
  it("does not fire on substrings inside unrelated words", () => {
    expect(
      detectUnsupervisedMedication({
        current_mental_health_care: "No",
        current_medications: ["Valiumesque herbal tonic", "Ativanol cream", "tramadolium"],
      }),
    ).toBeNull();
  });

  // ...but digits and punctuation must still terminate a match, or the way
  // clients actually write doses stops resolving.
  it("still matches when a dose or hyphen follows the name", () => {
    for (const m of ["Alprax-0.25", "Restil 0.25", "Alprax0.25", "ZOLFRESH-10"]) {
      const a = detectUnsupervisedMedication({
        current_mental_health_care: "No",
        current_medications: [m],
      });
      expect(a, `expected a finding for ${m}`).not.toBeNull();
    }
  });

  it("reports each class once and names them all in the headline", () => {
    const a = detectUnsupervisedMedication({
      current_mental_health_care: "No",
      current_medications: ["Alprazolam 0.25", "Zolpidem 10", "Tramadol 50"],
    })!;
    expect(new Set(a.findings.map((f) => f.drugClass)).size).toBe(3);
    expect(a.headline).toMatch(/Benzodiazepine/);
    expect(a.headline).toMatch(/Opioid/);
  });

  it("survives junk without throwing", () => {
    expect(detectUnsupervisedMedication(null)).toBeNull();
    expect(detectUnsupervisedMedication({})).toBeNull();
    expect(
      detectUnsupervisedMedication({
        current_mental_health_care: "No",
        psych_medications: [null, "a string", { name: 123 }],
        current_medications: "Alprazolam 0.25",
      })!.findings.length,
    ).toBe(1);
  });
});

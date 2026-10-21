import { describe, expect, it } from "vitest";
import { CONCERN_IDS, CONCERN_LABEL, classifyConcerns, isConcernId, SOURCE_CONCERN } from "./concerns";

describe("classifyConcerns — the real booking concerns on file (Oct 2026)", () => {
  const cases: Array<[string, string[]]> = [
    ["Migraine, iron and vitamin deficiency, sleep", ["nutrients", "sleep"]],
    ["Bowl movement", ["gut"]],
    ["Gut health", ["gut"]],
    ["Autoimmune disorders (Hashimoto’s thyroid and MS), fatigue, ", ["thyroid", "energy", "autoimmune"]],
    [
      "High BP and Mental health\nMigraine, high bp and currently diagnosed with hb1c 6.2. Also want to take care of mental health.",
      ["blood_sugar", "heart", "mood"],
    ],
    ["Ulcerative Colitis & Asthma", ["gut", "autoimmune"]],
    ["Period irregularities", ["hormones"]],
    ["Perimenopausal", ["hormones"]],
    ["Depression, H Pylori", ["gut", "mood"]],
    ["Severe headaches, Back Pain and sciatica, Tinnitus", ["joints"]],
  ];
  it.each(cases)("%s", (text, want) => {
    expect(classifyConcerns(text)).toEqual(want);
  });
});

describe("classifyConcerns — false friends", () => {
  it("does not read 'symptoms' as MS or 'bpm' as BP", () => {
    expect(classifyConcerns("many symptoms, heart rate 80 bpm")).toEqual(["heart"]);
    expect(classifyConcerns("symptoms")).toEqual([]);
  });
  it("does not read 'chair' as hair or 'bicycle' as a cycle", () => {
    expect(classifyConcerns("I sit in a chair and ride a bicycle")).toEqual([]);
  });
  it("is empty for empty or unknown text", () => {
    expect(classifyConcerns("")).toEqual([]);
    expect(classifyConcerns(null)).toEqual([]);
    expect(classifyConcerns("tinnitus")).toEqual([]);
  });
});

describe("vocabulary integrity", () => {
  it("every id has a label and ids are unique", () => {
    expect(new Set(CONCERN_IDS).size).toBe(CONCERN_IDS.length);
    for (const id of CONCERN_IDS) expect(CONCERN_LABEL[id]).toBeTruthy();
  });
  it("every lead source maps to a real concern", () => {
    for (const v of Object.values(SOURCE_CONCERN)) expect(isConcernId(v)).toBe(true);
  });
});

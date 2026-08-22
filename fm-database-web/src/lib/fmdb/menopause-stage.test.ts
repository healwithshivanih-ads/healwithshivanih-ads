/**
 * Ported from fm-database/tests/test_menopause_stage.py — keep both files'
 * cases in lockstep with fmdb/assess/suggester.py::menopause_stage().
 */
import { describe, it, expect } from "vitest";
import { menopauseStage } from "./menopause-stage";

describe("menopauseStage", () => {
  it("reads the shapes the roster actually uses", () => {
    expect(menopauseStage(["Postmenopausal"])).toBe("postmenopause");
    expect(menopauseStage(["Perimenopause onset 2023"])).toBe("perimenopause");
    expect(menopauseStage(["Perimenopause"])).toBe("perimenopause");
  });

  it("post wins when a record carries both", () => {
    expect(
      menopauseStage(["Perimenopause onset 2023", "Postmenopausal since 2026"]),
    ).toBe("postmenopause");
  });

  it("reads medical_history, not just active_conditions", () => {
    expect(menopauseStage(undefined, ["Surgical menopause 2019"])).toBe("postmenopause");
    expect(
      menopauseStage(undefined, ["Hysterectomy with oophorectomy 2020"]),
    ).toBe("postmenopause");
  });

  it("accepts a bare string as well as an array", () => {
    expect(menopauseStage("Peri-menopausal symptoms")).toBe("perimenopause");
  });

  it("is silent when there is nothing to read", () => {
    expect(menopauseStage()).toBeNull();
    expect(menopauseStage([])).toBeNull();
    expect(menopauseStage(["Type 2 diabetes", "Hashimoto's"])).toBeNull();
    expect(menopauseStage(null)).toBeNull();
  });

  it("does not fire on unrelated uses of the word — 'Premenopausal' must NOT match", () => {
    expect(menopauseStage(["Premenopausal"])).toBeNull();
  });
});

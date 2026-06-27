/**
 * Tests for the assess symptom-taxonomy helpers (Codex audit #6).
 */
import { describe, it, expect } from "vitest";
import {
  gendersToShow,
  CATEGORY_ORDER,
  SLUG_CATEGORY_OVERRIDES,
  CONCEPT_CLUSTERS,
} from "./assess-symptom-taxonomy";

describe("gendersToShow", () => {
  it("shows only women's for female", () => {
    for (const s of ["F", "female", "Woman"]) {
      expect(gendersToShow(s)).toEqual({ showWomens: true, showMens: false });
    }
  });
  it("shows only men's for male", () => {
    for (const s of ["M", "male", "Man"]) {
      expect(gendersToShow(s)).toEqual({ showWomens: false, showMens: true });
    }
  });
  it("shows BOTH when sex is unknown/blank", () => {
    for (const s of ["", null, undefined, "other"]) {
      expect(gendersToShow(s)).toEqual({ showWomens: true, showMens: true });
    }
  });
});

describe("taxonomy data", () => {
  it("category order is non-empty and includes gendered categories", () => {
    expect(CATEGORY_ORDER).toContain("womens_health");
    expect(CATEGORY_ORDER).toContain("mens_health");
  });
  it("overrides route female-specific slugs to womens_health", () => {
    expect(SLUG_CATEGORY_OVERRIDES["pms"]).toBe("womens_health");
    expect(SLUG_CATEGORY_OVERRIDES["erectile-dysfunction"]).toBe("mens_health");
  });
  it("every concept cluster bucket is keyed by a known category", () => {
    for (const cat of Object.keys(CONCEPT_CLUSTERS)) {
      expect(CATEGORY_ORDER).toContain(cat);
    }
  });
});

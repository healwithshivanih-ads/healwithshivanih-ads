import { describe, it, expect } from "vitest";
import { checkCoverage, isFullyCovered, type LabCoverageRegistry } from "./lab-coverage";
import type { LabProfile, LabAddon } from "./lab-providers";

// Minimal profiles mirroring acumen.yaml after the hormone expansion.
const base: LabProfile = {
  id: 1, name: "Base Panel", audience: "everyone", ourCostInr: 8500, mrpInr: 12500, marginInr: 4000,
  includes: [], coveredAddonSlugs: ["apob", "apoa1", "lp-a", "am-cortisol"],
};
const peri: LabProfile = {
  id: 3, name: "Perimenopause", audience: "women 40+", ourCostInr: 13000, mrpInr: 20000, marginInr: 7000,
  includes: [], coveredAddonSlugs: ["apob", "apoa1", "lp-a", "am-cortisol", "fsh", "lh", "estradiol-e2", "progesterone", "dhea-s", "total-testosterone", "shbg", "ca-125", "ca-15-3"],
};

const addons: LabAddon[] = [
  { slug: "total-testosterone", name: "Testosterone Total", catalogueInr: null, ourCostInr: null, clientInr: null },
  { slug: "free-testosterone", name: "Testosterone Free", catalogueInr: 2150, ourCostInr: 1075, clientInr: null },
  { slug: "amh", name: "AMH", catalogueInr: 2400, ourCostInr: 1200, clientInr: null },
  { slug: "c-peptide", name: "C-Peptide", catalogueInr: 1400, ourCostInr: 700, clientInr: null },
];

const registry: LabCoverageRegistry = {
  "TSH": { coverage: "in_base" },
  "ApoB": { coverage: "in_base", slug: "apob" },
  "Reverse T3": { coverage: "not_at_acumen" },
  "Total Testosterone": { coverage: "addon:total-testosterone" },
  "Free Testosterone": { coverage: "addon:free-testosterone" },
  "AMH (Anti-Müllerian Hormone)": { coverage: "addon:amh" },
  "C-Peptide": { coverage: "addon:c-peptide" },
  "17-OH Progesterone": { coverage: "profile_only", in_profiles: [2, 3] },
};

describe("checkCoverage", () => {
  it("Perimenopause: total testosterone IS covered, free testosterone is an add-on", () => {
    const r = checkCoverage(["TSH", "Total Testosterone", "Free Testosterone"], peri, registry, addons);
    expect(r.covered).toEqual(["TSH", "Total Testosterone"]); // peri carries total-testosterone
    expect(r.availableAsAddon).toEqual([{ marker: "Free Testosterone", slug: "free-testosterone", name: "Testosterone Free" }]);
    expect(r.notAtAcumen).toEqual([]);
  });

  it("Base panel: hormones fall to add-ons (Base carries none of them)", () => {
    const r = checkCoverage(["TSH", "Total Testosterone", "AMH (Anti-Müllerian Hormone)"], base, registry, addons);
    expect(r.covered).toEqual(["TSH"]);
    expect(r.availableAsAddon.map((a) => a.slug)).toEqual(["total-testosterone", "amh"]);
  });

  it("specialty markers route to notAtAcumen", () => {
    const r = checkCoverage(["Reverse T3"], peri, registry, addons);
    expect(r.notAtAcumen).toEqual(["Reverse T3"]);
    expect(r.covered).toEqual([]);
  });

  it("an unmapped / custom marker is unknown (→ requisition), never silently covered", () => {
    const r = checkCoverage(["Some Custom Test", "Vitamin Q (custom)"], peri, registry, addons);
    expect(r.unknown).toEqual(["Some Custom Test", "Vitamin Q"]); // "(custom)" stripped
    expect(r.covered).toEqual([]);
  });

  it("profile_only marker: covered on an in_profiles panel, not addable elsewhere", () => {
    expect(checkCoverage(["17-OH Progesterone"], peri, registry, addons).covered).toEqual(["17-OH Progesterone"]);
    const onBase = checkCoverage(["17-OH Progesterone"], base, registry, addons);
    expect(onBase.notAtAcumen).toEqual(["17-OH Progesterone"]); // base (id 1) not in [2,3], no à-la-carte
  });

  it("no profile selected → in_base markers aren't counted as covered", () => {
    const r = checkCoverage(["TSH"], null, registry, addons);
    expect(r.covered).toEqual([]);
    expect(r.unknown).toEqual(["TSH"]);
  });

  it("an add-on slug with no catalogue entry → notAtAcumen (no phantom add-on)", () => {
    const r = checkCoverage(["Free Testosterone"], base, registry, []); // empty addons list
    expect(r.notAtAcumen).toEqual(["Free Testosterone"]);
  });

  it("dedupes repeated markers", () => {
    const r = checkCoverage(["TSH", "TSH"], peri, registry, addons);
    expect(r.covered).toEqual(["TSH"]);
  });

  it("isFullyCovered: true only when nothing is add-on/notAtAcumen/unknown", () => {
    expect(isFullyCovered(checkCoverage(["TSH"], peri, registry, addons))).toBe(true);
    expect(isFullyCovered(checkCoverage(["TSH", "Free Testosterone"], peri, registry, addons))).toBe(false);
  });
});

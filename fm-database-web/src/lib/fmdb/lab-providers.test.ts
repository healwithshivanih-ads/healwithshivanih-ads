import { describe, it, expect } from "vitest";
import { parseAcumen, profilesForClient, priceSelection } from "./lab-providers";

// Minimal fixture mirroring acumen.yaml#profiles_final + a superseded packages
// block (which MUST be ignored) + addon_tests.
const RAW = {
  provider: {
    slug: "acumen-diagnostics",
    display_name: "Acumen Diagnostics",
    phone_e164: "+919808050050",
    home_collection: true,
  },
  // superseded — the parser must NOT read these:
  packages: [{ slug: "fm-essential-basic", target_inr: 3999 }],
  profiles_final: [
    { id: 1, name: "Base Panel", audience: "everyone", our_cost_inr: 8500, mrp_inr: 12500, margin_inr: 4000, catalogue_inr: 18400, includes: ["Full thyroid", "Iron studies"], covered_addon_slugs: ["apob", "am-cortisol"] },
    { id: 2, name: "Women's Reproductive", audience: "women <45", our_cost_inr: 16500, mrp_inr: 23500, margin_inr: 7000, includes_extra: ["Reproductive hormones"] },
    { id: 3, name: "Perimenopause", audience: "women 40+", our_cost_inr: 13000, mrp_inr: 20000, margin_inr: 7000, includes_extra: ["Perimenopause hormones"], covered_addon_slugs: ["fsh", "estradiol-e2"] },
    { id: 4, name: "Male", audience: "men", our_cost_inr: 14000, mrp_inr: 21000, margin_inr: 7000 },
  ],
  addon_tests: [
    { slug: "methylmalonic-acid", name: "MMA Serum", quoted_inr: null, dos_list_inr: 3430 },
    { slug: "c-peptide", name: "C-Peptide", quoted_inr: 1400, dos_list_inr: 1400 },
  ],
};

const acumen = parseAcumen(RAW);

describe("parseAcumen", () => {
  it("reads profiles_final, ignores the superseded packages block", () => {
    expect(acumen.profiles.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(acumen.profiles.find((p) => p.id === 1)?.mrpInr).toBe(12500);
    // a target_inr of 3999 from `packages` must never appear
    expect(acumen.profiles.some((p) => p.mrpInr === 3999)).toBe(false);
  });

  it("reads catalogue_inr (à-la-carte deal anchor); null when absent", () => {
    expect(acumen.profiles.find((p) => p.id === 1)?.catalogueInr).toBe(18400);
    // id 4 fixture has no catalogue_inr → null (no deal shown for it)
    expect(acumen.profiles.find((p) => p.id === 4)?.catalogueInr).toBeNull();
  });

  it("composes coveredAddonSlugs as Base ∪ the profile's own", () => {
    const peri = acumen.profiles.find((p) => p.id === 3)!;
    // peri's own (fsh, estradiol-e2) + Base's (apob, am-cortisol), de-duped
    expect([...peri.coveredAddonSlugs].sort()).toEqual(["am-cortisol", "apob", "estradiol-e2", "fsh"]);
    // a profile with no own coverage still inherits Base's
    const women = acumen.profiles.find((p) => p.id === 2)!;
    expect([...women.coveredAddonSlugs].sort()).toEqual(["am-cortisol", "apob"]);
  });

  it("derives add-on our-cost = 50% of catalogue; client price stays null (margin pending)", () => {
    const mma = acumen.addons.find((a) => a.slug === "methylmalonic-acid")!;
    expect(mma.catalogueInr).toBe(3430);
    expect(mma.ourCostInr).toBe(1715); // 50% of 3430
    expect(mma.clientInr).toBeNull();
  });

  it("carries provider metadata", () => {
    expect(acumen.homeCollection).toBe(true);
    expect(acumen.phoneE164).toBe("+919808050050");
  });

  it("composes `includes`: Base = its own list; others = Base + their extras", () => {
    expect(acumen.profiles.find((p) => p.id === 1)?.includes).toEqual(["Full thyroid", "Iron studies"]);
    expect(acumen.profiles.find((p) => p.id === 2)?.includes).toEqual(["Full thyroid", "Iron studies", "Reproductive hormones"]);
    expect(acumen.profiles.find((p) => p.id === 4)?.includes).toEqual(["Full thyroid", "Iron studies"]); // no extras
  });

  // ── fail-closed guards (adversarial review 2026-06-25) ──
  it("drops BOTH entries of a duplicated profile id — never charge a stale dupe", () => {
    const dup = parseAcumen({
      ...RAW,
      profiles_final: [
        // a stale Base left above the corrected one (the yaml's documented
        // "keep superseded blocks in-place" editing pattern)
        { id: 1, name: "Base STALE", audience: "everyone", our_cost_inr: 5000, mrp_inr: 9999, margin_inr: 4999 },
        ...RAW.profiles_final,
      ],
    });
    expect(dup.profiles.some((p) => p.id === 1)).toBe(false); // both id:1 gone
    expect(priceSelection(dup, { profileId: 1 })).toEqual({
      ok: false,
      error: expect.stringContaining("unknown profile"),
    });
    // unaffected profiles still book
    expect(priceSelection(dup, { profileId: 4 })).toMatchObject({ ok: true, amountInr: 21000 });
  });

  it("drops a profile with missing/zero our_cost_inr — no ₹0-cost orders / corrupt margin", () => {
    const bad = parseAcumen({
      ...RAW,
      profiles_final: [{ id: 5, name: "No Cost", audience: "everyone", mrp_inr: 5000, margin_inr: 5000 }],
    });
    expect(bad.profiles.some((p) => p.id === 5)).toBe(false);
    expect(priceSelection(bad, { profileId: 5 })).toMatchObject({ ok: false });
  });
});

describe("profilesForClient — Base + the matching gender/age profile(s)", () => {
  const ids = (sex: string, age: number | null) =>
    profilesForClient(acumen, { sex, age }).map((p) => p.id);

  it("woman 30 → Base + Women's Reproductive", () => {
    expect(ids("F", 30)).toEqual([1, 2]);
  });
  it("woman 50 → Base + Perimenopause", () => {
    expect(ids("F", 50)).toEqual([1, 3]);
  });
  it("man → Base + Male", () => {
    expect(ids("M", 40)).toEqual([1, 4]);
  });
  it("missing sex/age → Base only", () => {
    expect(ids("", null)).toEqual([1]);
    expect(ids("F", null)).toEqual([1]);
  });

  // boundary / overlap band (deal's audience strings overlap 40–44 by design)
  it("woman 39 → Reproductive only (not Perimenopause)", () => {
    expect(ids("F", 39)).toEqual([1, 2]);
  });
  it("woman 40 → BOTH Reproductive + Perimenopause (overlap start)", () => {
    expect(ids("F", 40)).toEqual([1, 2, 3]);
  });
  it("woman 44 → BOTH (still in overlap)", () => {
    expect(ids("F", 44)).toEqual([1, 2, 3]);
  });
  it("woman 45 → Perimenopause only (<45 is exclusive)", () => {
    expect(ids("F", 45)).toEqual([1, 3]);
  });
});

describe("priceSelection — server-side derivation, never trust input", () => {
  it("Base alone = ₹12,500", () => {
    const r = priceSelection(acumen, { profileId: 1 });
    expect(r).toMatchObject({ ok: true, amountInr: 12500, ourCostInr: 8500 });
  });
  it("Women's Reproductive = ₹23,500", () => {
    expect(priceSelection(acumen, { profileId: 2 })).toMatchObject({ ok: true, amountInr: 23500 });
  });
  it("rejects an unknown profile id (can't be coerced into a price)", () => {
    expect(priceSelection(acumen, { profileId: 99 })).toEqual({ ok: false, error: expect.stringContaining("unknown profile") });
  });
  it("rejects an empty selection", () => {
    expect(priceSelection(acumen, { profileId: null })).toEqual({ ok: false, error: expect.stringContaining("empty") });
  });
  it("rejects an unknown add-on", () => {
    expect(priceSelection(acumen, { profileId: 1, addonSlugs: ["nope"] })).toEqual({
      ok: false,
      error: expect.stringContaining('unknown add-on'),
    });
  });
  it("rejects a known-but-unpriced add-on (margin pending) — blocks add-on booking", () => {
    expect(priceSelection(acumen, { profileId: 1, addonSlugs: ["c-peptide"] })).toEqual({
      ok: false,
      error: expect.stringContaining("not yet priced"),
    });
  });
  it("itemises the line for the chosen profile", () => {
    const r = priceSelection(acumen, { profileId: 4 });
    expect(r.ok && r.lines).toEqual([{ label: "Male", inr: 21000 }]);
  });
});

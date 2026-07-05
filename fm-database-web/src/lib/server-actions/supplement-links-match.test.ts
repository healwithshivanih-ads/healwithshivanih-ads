import { describe, it, expect } from "vitest";
import {
  pickLinkEntry,
  canonToken,
  isInternationalClient,
  type LinksFile,
} from "./supplement-links-match";

// A synthetic catalogue that reproduces the real-world hazard: a generic
// "iron" product (VitaOne bisglycinate) sitting next to the specific product
// the plan actually prescribes (Tonoferon ferrous ascorbate).
const LINKS: LinksFile = {
  vo_iron_complex: {
    display_name: "Iron Complex (Iron Bisglycinate)",
    url: "https://vitaone.in/shop/iron-complex",
    source: "vitaone",
    aliases: ["iron", "iron_bisglycinate", "iron_complex"],
  },
  tonoferon_iron_liquid: {
    display_name: "Tonoferon Liquid (Ferrous Ascorbate Syrup)",
    url: "https://amzn.to/tono",
    source: "amazon",
    covers: ["iron-ferrous-ascorbate"],
  },
  phgg_sunfiber_trulo: {
    display_name: "Trulo Sunfiber PHGG",
    url: "https://amzn.to/phgg",
    source: "amazon",
    covers: ["partially-hydrolyzed-guar-gum"],
  },
  mag_glycinate_vo: {
    display_name: "Magnesium Glycinate",
    url: "https://vitaone.in/shop/mag",
    source: "vitaone",
    aliases: ["magnesium_glycinate"],
  },
};

describe("pickLinkEntry", () => {
  it("canonToken normalises hyphens / spaces / case to one form", () => {
    expect(canonToken("iron-ferrous-ascorbate")).toBe("iron_ferrous_ascorbate");
    expect(canonToken("Iron Ferrous Ascorbate")).toBe("iron_ferrous_ascorbate");
  });

  it("binds by catalogue slug (covers) over any name substring — the reported bug", () => {
    // Name alone is generic ("Iron Ferrous Ascorbate"); the slug makes it exact.
    const e = pickLinkEntry(LINKS, "Iron Ferrous Ascorbate", "iron-ferrous-ascorbate");
    expect(e?.url).toBe("https://amzn.to/tono");
  });

  it("a bare category word ('iron') can NOT hijack a specific formulation", () => {
    // No slug passed, no exact/covers match → the loose 'iron' token must be
    // rejected, so we return nothing rather than the WRONG bisglycinate.
    const e = pickLinkEntry(LINKS, "Iron Ferrous Ascorbate");
    expect(e).toBeUndefined();
  });

  it("PHGG resolves to the isolated product via covers", () => {
    const e = pickLinkEntry(LINKS, "Partially Hydrolyzed Guar Gum", "partially-hydrolyzed-guar-gum");
    expect(e?.url).toBe("https://amzn.to/phgg");
  });

  it("still matches a legit multi-word alias substring (magnesium_glycinate)", () => {
    const e = pickLinkEntry(LINKS, "Magnesium Glycinate Bedtime");
    expect(e?.url).toBe("https://vitaone.in/shop/mag");
  });

  it("an exact name still resolves without a slug", () => {
    const e = pickLinkEntry(LINKS, "Iron Complex (Iron Bisglycinate)");
    expect(e?.url).toBe("https://vitaone.in/shop/iron-complex");
  });

  it("returns undefined when nothing plausibly matches", () => {
    expect(pickLinkEntry(LINKS, "Rhodiola Rosea", "rhodiola-rosea")).toBeUndefined();
  });
});

// The Krittika bug (2026-07-05): a US client's iron / magnesium / omega-3
// resolved to vitaone.in because the India products matched the plan slug at
// a higher score than the *_iherb entries. International mode restricts the
// candidate pool to internationally-shippable retailers BEFORE scoring.
const INTL_LINKS: LinksFile = {
  ...LINKS,
  vo_iron_complex_bisglycinate: {
    display_name: "Iron Complex (VitaOne)",
    url: "https://vitaone.in/products/iron-complex-11",
    source: "vitaone",
    covers: ["iron-bisglycinate"],
  },
  iron_bisglycinate_iherb: {
    display_name: "Iron Bisglycinate — iHerb",
    url: "https://iherb.com/pr/now-foods-iron/54089",
    source: "iherb",
    covers: ["iron-bisglycinate"],
  },
  uk_brand_direct: {
    display_name: "Ashwagandha (brand store, ships worldwide)",
    url: "https://brand.example.com/ashwagandha",
    source: "custom",
    ships_international: true,
    covers: ["ashwagandha-ksm66"],
  },
};

describe("pickLinkEntry — international mode", () => {
  it("India default: a vitaone product still wins on retailer priority", () => {
    const e = pickLinkEntry(INTL_LINKS, "Iron Bisglycinate", "iron-bisglycinate");
    expect(e?.url).toContain("vitaone.in");
  });

  it("international: the SAME lookup lands on iHerb, never vitaone", () => {
    const e = pickLinkEntry(INTL_LINKS, "Iron Bisglycinate", "iron-bisglycinate", {
      international: true,
    });
    expect(e?.url).toBe("https://iherb.com/pr/now-foods-iron/54089");
  });

  it("international with no shippable entry: undefined, NOT an Indian link", () => {
    // PHGG exists only as an amzn.to (India) product.
    const e = pickLinkEntry(
      INTL_LINKS,
      "Partially Hydrolyzed Guar Gum",
      "partially-hydrolyzed-guar-gum",
      { international: true },
    );
    expect(e).toBeUndefined();
  });

  it("ships_international opts a non-iHerb entry into the international pool", () => {
    const e = pickLinkEntry(INTL_LINKS, "Ashwagandha", "ashwagandha-ksm66", {
      international: true,
    });
    expect(e?.url).toBe("https://brand.example.com/ashwagandha");
  });

  it("exact-key match is also gated by the international filter", () => {
    // "mag_glycinate_vo" isn't a key match; use the alias entry's key form.
    const e = pickLinkEntry(INTL_LINKS, "mag glycinate vo", undefined, {
      international: true,
    });
    expect(e).toBeUndefined();
  });
});

describe("isInternationalClient", () => {
  it("empty / missing country = India default", () => {
    expect(isInternationalClient(undefined)).toBe(false);
    expect(isInternationalClient("")).toBe(false);
    expect(isInternationalClient("   ")).toBe(false);
  });
  it("India in any spelling stays domestic", () => {
    expect(isInternationalClient("India")).toBe(false);
    expect(isInternationalClient("india")).toBe(false);
    expect(isInternationalClient("IN")).toBe(false);
  });
  it("non-India countries are international", () => {
    expect(isInternationalClient("United States of America")).toBe(true);
    expect(isInternationalClient("USA")).toBe(true);
    expect(isInternationalClient("United Kingdom")).toBe(true);
    expect(isInternationalClient("Indonesia")).toBe(true);
  });
});

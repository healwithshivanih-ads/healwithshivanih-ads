import { describe, it, expect } from "vitest";
import { pickLinkEntry, canonToken, type LinksFile } from "./supplement-links-match";

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

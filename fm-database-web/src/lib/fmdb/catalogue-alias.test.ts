import { describe, expect, it } from "vitest";
import { buildAliasIndex, relatedSlugs } from "./catalogue-alias";
import { pickLinkEntry } from "../server-actions/supplement-links-match";

// After the 2026-10 supplement merge, `ginger-root` lives on as an alias of
// `ginger`. Published plans still name the retired slug, and a bare
// `<slug>.yaml` read silently skipped it — the pregnancy-safety and drug-
// interaction checks then said nothing about that supplement.

const records = [
  { slug: "ginger", aliases: ["ginger-root", "adrak"] },
  { slug: "fish-oil-epa-dha", aliases: ["omega-3"] },
  // an alias that collides with another entry's CANONICAL slug must lose
  { slug: "turmeric", aliases: ["ginger"] },
];

describe("buildAliasIndex", () => {
  const idx = buildAliasIndex(records);

  it("resolves a retired slug to the survivor", () => {
    expect(idx.get("ginger-root")).toBe("ginger");
    expect(idx.get("omega-3")).toBe("fish-oil-epa-dha");
  });

  it("never lets an alias shadow another entry's canonical slug", () => {
    expect(idx.get("ginger")).toBe("ginger");
  });

  it("leaves unknown slugs unresolved", () => {
    expect(idx.get("selenium")).toBeUndefined();
  });
});

describe("relatedSlugs", () => {
  const idx = buildAliasIndex(records);

  it("returns the canonical slug and every alias, from either end", () => {
    expect(relatedSlugs("omega-3", idx).sort()).toEqual(["fish-oil-epa-dha", "omega-3"]);
    expect(relatedSlugs("fish-oil-epa-dha", idx).sort()).toEqual(["fish-oil-epa-dha", "omega-3"]);
  });
});

describe("pickLinkEntry with merged slugs", () => {
  const links = {
    nordic_omega: { url: "https://example.com/omega", covers: ["omega-3"] },
  };

  it("binds a product to the survivor through the retired slug it was tagged with", () => {
    const entry = pickLinkEntry(links, "Fish Oil — Omega-3 (EPA + DHA)", ["fish-oil-epa-dha", "omega-3"]);
    expect(entry?.url).toBe("https://example.com/omega");
  });

  it("still accepts a single slug", () => {
    expect(pickLinkEntry(links, "x", "omega-3")?.url).toBe("https://example.com/omega");
  });
});

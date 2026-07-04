/**
 * Pure matching core for supplement_links.yaml resolution.
 *
 * Lives OUTSIDE the "use server" file so it can be unit-tested and imported
 * synchronously (server-action modules may only export async functions).
 *
 * The one rule that matters here: a plan supplement must resolve to the RIGHT
 * product or to NO product — never to a wrong one with false confidence. A
 * generic category word ("iron") must not hijack a specific formulation
 * ("iron-ferrous-ascorbate") and send the client to the wrong bottle.
 */

export type LinkSource =
  | "vitaone"
  | "fmnutrition"
  | "amazon"
  | "iherb"
  | "custom"
  | "search";

export interface SupplementLink {
  display_name: string;
  url: string;
  source: LinkSource;
  notes?: string;
  unit_strength?: string;
  /** VitaOne supplement-facts label image URL, when captured from the product
   *  catalogue. Surfaced as a thumbnail next to the client's Reorder link. */
  image_url?: string;
}

export interface LinksEntry {
  display_name?: string;
  url?: string;
  source?: string;
  notes?: string;
  aliases?: string[];
  /** Catalogue supplement slug(s) this product supplies, e.g.
   *  ["iron-ferrous-ascorbate"]. The DETERMINISTIC binding: when the caller
   *  passes the plan supplement's catalogue slug, an exact covers match wins
   *  over any name-based fuzzy match. */
  covers?: string[];
  unit_strength?: string;
  /** VitaOne supplement-facts label image URL (added 2026-07-04 catalogue import). */
  facts_image_url?: string;
}

export interface LinksFile {
  [key: string]: LinksEntry;
}

// Retailer preference — VitaOne is the priority store, then FM Nutrition, then
// Amazon; iHerb and custom/other rank below. Breaks ties between equally-scored
// matches so a supplement stocked at several stores resolves to the preferred.
export const SOURCE_RANK: Record<string, number> = {
  vitaone: 0,
  fmnutrition: 1,
  amazon: 2,
  iherb: 3,
  custom: 4,
  other: 5,
};

export function sourceRank(entry: LinksEntry): number {
  const src =
    entry.source ?? (entry.url?.includes("vitaone") ? "vitaone" : "other");
  return SOURCE_RANK[src] ?? 9;
}

/** Canonical comparison form: lowercase, every run of non-alphanumerics → a
 *  single "_", trimmed. Makes "iron-ferrous-ascorbate", "Iron Ferrous
 *  Ascorbate" and "iron_ferrous_ascorbate" all compare equal. */
export function canonToken(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Score every entry and return the best, or undefined if nothing matches.
 * Score tiers, most→least trusted:
 *   2000  DETERMINISTIC — the plan's catalogue slug exactly equals this
 *         product's covers / aliases / key. The only binding that can't be wrong.
 *   1000  exact key match on the (slugified) display name
 *    900  exact alias match on the (slugified) display name
 *   ≤len  fuzzy substring on the name — HARDENED: a bare single-word token
 *         (no "_", e.g. "iron") may NOT match a more specific multi-word slug
 *         ("iron_ferrous_ascorbate"). That direction is how a generic category
 *         word used to hijack a specific formulation. Prefer no link over wrong.
 * Ties break by retailer priority.
 */
export function pickLinkEntry(
  links: LinksFile,
  rawName: string,
  catalogueSlug?: string,
): LinksEntry | undefined {
  const name = (rawName || "").trim();
  const slug = canonToken(name);
  const entries = Object.entries(links);
  const cands: { v: LinksEntry; score: number }[] = [];

  const catSlug = canonToken(catalogueSlug ?? "");
  if (catSlug) {
    for (const [k, v] of entries) {
      const tokens = [k, ...(v.aliases ?? []), ...(v.covers ?? [])].map(canonToken);
      if (tokens.includes(catSlug)) cands.push({ v, score: 2000 });
    }
  }

  if (slug && links[slug]) cands.push({ v: links[slug], score: 1000 });
  for (const [, v] of entries) {
    if (slug && (v.aliases ?? []).map(canonToken).includes(slug)) {
      cands.push({ v, score: 900 });
    }
  }
  if (slug) {
    for (const [k, v] of entries) {
      for (const tok of [k, ...(v.aliases ?? [])].map(canonToken)) {
        if (tok.length < 3) continue;
        // product token is more specific than (contains) the query → always
        // safe; query more specific than the token → trust only a multi-word
        // token, so a bare category word can't hijack a specific formulation.
        const safe = tok.includes(slug) || (slug.includes(tok) && tok.includes("_"));
        if (safe) cands.push({ v, score: tok.length });
      }
    }
  }

  return cands.sort(
    (a, b) => b.score - a.score || sourceRank(a.v) - sourceRank(b.v),
  )[0]?.v;
}

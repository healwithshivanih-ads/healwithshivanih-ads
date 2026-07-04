"use server";

/**
 * Read ~/fm-plans/supplement_links.yaml to resolve a supplement name →
 * { display_name, url, source }. Falls back to a VitaOne search URL
 * with the affiliate referral param when no entry exists.
 *
 * This is the minimal launch-grade version. The full 158-keyword
 * VITAONE_CATALOG lives in render-client-letter.py and powers the
 * printed schedule in the HTML letter. For the public supplements
 * landing page we accept a simpler fallback so the page ships today;
 * the catalog can move into this file later.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

const VITAONE_REFERRAL = "?pr=vita13720sh";

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
  /** The product's fixed per-unit strength, e.g. "5000 IU / capsule" or
   *  "600 mg / capsule". Reference data (from the retailer's product page) that
   *  lets the coach dose a plan in whole capsules instead of an off-grid mg
   *  range. Populated by Codex from vitaone.in. Surfaced in the plan editor. */
  unit_strength?: string;
}

interface LinksEntry {
  display_name?: string;
  url?: string;
  source?: string;
  notes?: string;
  aliases?: string[];
  unit_strength?: string;
}

// Retailer preference — VitaOne is the priority store, then FM Nutrition, then
// Amazon; the country-specific iHerb links and any custom/other entries rank
// below. When more than one entry matches a supplement name equally well, the
// higher-priority retailer wins. iHerb still resolves for a client whose name
// maps specifically to an iHerb entry.
const SOURCE_RANK: Record<string, number> = {
  vitaone: 0,
  fmnutrition: 1,
  amazon: 2,
  iherb: 3,
  custom: 4,
  other: 5,
};
function sourceRank(entry: LinksEntry): number {
  const src =
    entry.source ?? (entry.url?.includes("vitaone") ? "vitaone" : "other");
  return SOURCE_RANK[src] ?? 9;
}

interface LinksFile {
  [key: string]: LinksEntry;
}

let cache: LinksFile | null = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

async function readLinks(): Promise<LinksFile> {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "supplement_links.yaml"),
      "utf-8",
    );
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      cache = parsed as LinksFile;
      cacheAt = Date.now();
      return cache;
    }
  } catch {
    /* missing file → empty */
  }
  cache = {};
  cacheAt = Date.now();
  return cache;
}

function vitaoneSearchUrl(name: string): string {
  // VitaOne site doesn't expose a documented search query param, so we
  // build a "browse" URL that lands the client on the catalog with the
  // referral cookie set. They'll see related products to pick from.
  return `https://www.vitaone.in/shop${VITAONE_REFERRAL}`;
}

export async function resolveSupplementLink(
  rawName: string,
): Promise<SupplementLink> {
  const name = (rawName || "").trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const links = await readLinks();

  // Gather every candidate entry with a match score (exact key > exact alias >
  // longest bidirectional substring), then pick the best. Equal-quality matches
  // are broken by retailer priority (VitaOne → fmnutrition → amazon → …), so a
  // supplement stocked at several stores always resolves to the preferred one.
  const entries = Object.entries(links);
  const cands: { v: LinksEntry; score: number }[] = [];
  if (links[slug]) cands.push({ v: links[slug], score: 1000 });
  for (const [, v] of entries) {
    if (v.aliases?.includes(slug)) cands.push({ v, score: 900 });
  }
  for (const [k, v] of entries) {
    for (const tok of [k, ...(v.aliases ?? [])]) {
      if (tok.length >= 3 && (slug.includes(tok) || tok.includes(slug))) {
        cands.push({ v, score: tok.length });
      }
    }
  }
  const entry: LinksEntry | undefined = cands.sort(
    (a, b) => b.score - a.score || sourceRank(a.v) - sourceRank(b.v),
  )[0]?.v;

  if (entry?.url) {
    return {
      display_name: entry.display_name ?? name,
      url: entry.url,
      source:
        (entry.source as LinkSource) ??
        (entry.url.includes("vitaone") ? "vitaone" : "custom"),
      notes: entry.notes,
      unit_strength: entry.unit_strength,
    };
  }

  return {
    display_name: name,
    url: vitaoneSearchUrl(name),
    source: "search",
  };
}

/** Batch product lookup for the plan editor: name → resolved retailer +
 *  per-unit strength. Only real catalogue matches are returned (the generic
 *  "browse the shop" search fallback is dropped). Used to nudge the coach to
 *  dose in whole capsules of the actual product. */
export async function resolveSupplementProducts(
  names: string[],
): Promise<
  Record<string, { source: LinkSource; url: string; unit_strength?: string }>
> {
  const out: Record<string, { source: LinkSource; url: string; unit_strength?: string }> = {};
  for (const raw of names) {
    const name = (raw || "").trim();
    if (!name || out[name]) continue;
    const link = await resolveSupplementLink(name);
    if (link.source !== "search") {
      out[name] = { source: link.source, url: link.url, unit_strength: link.unit_strength };
    }
  }
  return out;
}

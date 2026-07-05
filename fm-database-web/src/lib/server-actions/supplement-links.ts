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
import {
  pickLinkEntry,
  type LinkSource,
  type LinksFile,
  type PickLinkOpts,
  type SupplementLink,
} from "@/lib/server-actions/supplement-links-match";
// NB: this is a "use server" module — every export becomes a server action, so
// it must NOT export types. Import LinkSource / SupplementLink directly from
// "@/lib/server-actions/supplement-links-match" instead.

// VitaOne's attributing referral param is ?ref= (confirmed live on the product
// page); ?pr= was the legacy/incorrect param and does not attribute orders.
const VITAONE_REFERRAL = "?ref=vita13720sh";

// iHerb rewards/referral code — same code the curated *_iherb catalogue
// entries carry (see ~/fm-plans/US_CLIENT_AFFILIATE_SYSTEM.md).
const IHERB_REFERRAL = "rcode=WNB6015";

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

function iherbSearchUrl(name: string): string {
  // A KEYWORD search on the ingredient — fail-safe by construction (shows
  // the right ingredient's options, never a wrong bottle) and carries the
  // referral code. Parentheticals dropped: "Omega-3 (fish oil, EPA+DHA)"
  // searches better as "Omega-3".
  const kw = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || name;
  return `https://www.iherb.com/search?kw=${encodeURIComponent(kw)}&${IHERB_REFERRAL}`;
}

export async function resolveSupplementLink(
  rawName: string,
  catalogueSlug?: string,
  opts?: PickLinkOpts,
): Promise<SupplementLink> {
  const name = (rawName || "").trim();
  const links = await readLinks();
  // All matching logic (deterministic slug binding + hardened name fuzzy) lives
  // in the pure, unit-tested pickLinkEntry — see supplement-links-match.ts.
  // For international (non-India) clients the candidate pool is restricted to
  // internationally-shippable retailers (iHerb) BEFORE scoring.
  const entry = pickLinkEntry(links, name, catalogueSlug, opts);

  if (entry?.url) {
    return {
      display_name: entry.display_name ?? name,
      url: entry.url,
      source:
        (entry.source as LinkSource) ??
        (entry.url.includes("vitaone") ? "vitaone" : "custom"),
      notes: entry.notes,
      unit_strength: entry.unit_strength,
      image_url: entry.facts_image_url,
    };
  }

  return {
    display_name: name,
    // International fallback = iHerb keyword search (right ingredient, right
    // referral, ships worldwide). India fallback stays the VitaOne shop.
    url: opts?.international ? iherbSearchUrl(name) : vitaoneSearchUrl(name),
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

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

export interface SupplementLink {
  display_name: string;
  url: string;
  source: "vitaone" | "amazon" | "iherb" | "custom" | "search";
  notes?: string;
}

interface LinksEntry {
  display_name?: string;
  url?: string;
  source?: string;
  notes?: string;
  aliases?: string[];
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

  // 1. Exact key match
  // 2. Exact alias match (entry has an aliases[] field that includes the slug)
  // 3. LONGEST bidirectional substring match across keys + aliases
  const entries = Object.entries(links);
  const entry: LinksEntry | undefined =
    links[slug] ??
    entries.find(([, v]) => v.aliases?.includes(slug))?.[1] ??
    entries
      .flatMap(([k, v]) =>
        [k, ...(v.aliases ?? [])].map((tok) => ({ tok, v })),
      )
      .filter(({ tok }) => tok.length >= 3 && (slug.includes(tok) || tok.includes(slug)))
      .sort((a, b) => b.tok.length - a.tok.length)[0]?.v;

  if (entry?.url) {
    return {
      display_name: entry.display_name ?? name,
      url: entry.url,
      source:
        (entry.source as SupplementLink["source"]) ??
        (entry.url.includes("vitaone") ? "vitaone" : "custom"),
      notes: entry.notes,
    };
  }

  return {
    display_name: name,
    url: vitaoneSearchUrl(name),
    source: "search",
  };
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";
import { buildAliasIndex, relatedSlugs, type AliasRecord } from "./catalogue-alias";

/**
 * Alias-aware catalogue lookups — see catalogue-alias.ts for why.
 *
 * The index is rebuilt at most once a minute: the coach UI runs under PM2 for
 * days, and a `git pull` that merges two entries must start resolving without
 * a restart.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; index: Map<string, string> }>();

export async function catalogueAliasIndex(kind: string): Promise<Map<string, string>> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.index;
  const dir = path.join(getCataloguePath(), kind);
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".yaml"));
  } catch {
    names = [];
  }
  const records: AliasRecord[] = [];
  await Promise.all(
    names.map(async (n) => {
      try {
        const d = yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as AliasRecord | null;
        if (d) records.push(d);
      } catch {
        /* unreadable entry — the validator reports it; skip here */
      }
    }),
  );
  const index = buildAliasIndex(records);
  cache.set(kind, { at: Date.now(), index });
  return index;
}

/** Canonical slug for `slug` (itself when it is canonical or unknown). */
export async function resolveCatalogueSlug(kind: string, slug: string): Promise<string> {
  try {
    await fs.access(path.join(getCataloguePath(), kind, `${slug}.yaml`));
    return slug;
  } catch {
    return (await catalogueAliasIndex(kind)).get(slug) ?? slug;
  }
}

/** Every slug naming the same entry (canonical + aliases). */
export async function relatedCatalogueSlugs(kind: string, slug: string): Promise<string[]> {
  return relatedSlugs(slug, await catalogueAliasIndex(kind));
}

/** Read a catalogue record by slug OR alias; null when neither resolves. */
export async function loadCatalogueRecord<T = Record<string, unknown>>(
  kind: string,
  slug: string,
): Promise<T | null> {
  const canonical = await resolveCatalogueSlug(kind, slug);
  try {
    const raw = await fs.readFile(path.join(getCataloguePath(), kind, `${canonical}.yaml`), "utf-8");
    return (yaml.load(raw) as T) ?? null;
  } catch {
    return null;
  }
}

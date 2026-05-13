"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";

const LINKS_PATH = path.join(
  process.env.HOME ?? "",
  "fm-plans",
  "supplement_links.yaml"
);

/**
 * ProductLink — generalised from the earlier supplement-only schema (2026-05-13).
 * Now covers:
 *   - supplement (vitamins, herbs, minerals — original use)
 *   - food (protein powders, organic grains, ghee, kombucha cultures…)
 *   - device (infrared red-light, PEMF mats, blue-blockers, oura ring…)
 *   - other (anything else)
 *
 * The legacy YAML on disk has no `category` field; the loader defaults old
 * entries to `"supplement"` so existing links keep working.
 */
export type ProductCategory = "supplement" | "food" | "device" | "other";

export interface ProductLink {
  key: string; // lowercase, used as lookup key in Python
  display_name: string;
  url: string;
  source: "amazon" | "iherb" | "other";
  category: ProductCategory;
  notes?: string;
}

/** Legacy export — kept so existing imports compile. */
export type SupplementLink = ProductLink;

function entryToYaml(l: ProductLink): Omit<ProductLink, "key"> {
  // Keep the YAML compact — omit notes when empty.
  return {
    display_name: l.display_name,
    url: l.url,
    source: l.source,
    category: l.category,
    ...(l.notes ? { notes: l.notes } : {}),
  };
}

/** Load all custom product links. */
export async function loadSupplementLinks(): Promise<ProductLink[]> {
  if (!fs.existsSync(LINKS_PATH)) return [];
  try {
    const { load } = await import("js-yaml");
    const raw = load(fs.readFileSync(LINKS_PATH, "utf-8")) as Record<
      string,
      {
        display_name?: string;
        url?: string;
        source?: string;
        category?: string;
        notes?: string;
      }
    > | null;
    if (!raw) return [];
    return Object.entries(raw).map(([key, val]) => ({
      key,
      display_name: val.display_name ?? key.replace(/_/g, " "),
      url: val.url ?? "",
      source: (val.source as ProductLink["source"]) ?? "other",
      // Default legacy entries (no category field on disk) to "supplement"
      // since that's what was authored before the 2026-05-13 generalisation.
      category: (val.category as ProductCategory) ?? "supplement",
      notes: val.notes,
    }));
  } catch {
    return [];
  }
}

/** Upsert a single product link (create or update by key). */
export async function upsertSupplementLink(
  link: ProductLink
): Promise<{ ok: boolean; error?: string }> {
  try {
    const existing = await loadSupplementLinks();
    const map: Record<string, Omit<ProductLink, "key">> = {};
    for (const l of existing) map[l.key] = entryToYaml(l);
    // Upsert
    const key = link.key
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    map[key] = entryToYaml(link);

    const { dump } = await import("js-yaml");
    fs.mkdirSync(path.dirname(LINKS_PATH), { recursive: true });
    fs.writeFileSync(LINKS_PATH, dump(map, { lineWidth: 120 }), "utf-8");
    revalidatePath("/backlog");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Delete a product link by key. */
export async function deleteSupplementLink(
  key: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const existing = await loadSupplementLinks();
    const map: Record<string, Omit<ProductLink, "key">> = {};
    for (const l of existing) {
      if (l.key !== key) map[l.key] = entryToYaml(l);
    }
    const { dump } = await import("js-yaml");
    fs.writeFileSync(LINKS_PATH, dump(map, { lineWidth: 120 }), "utf-8");
    revalidatePath("/backlog");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

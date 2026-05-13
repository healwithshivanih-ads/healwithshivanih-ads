"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";

const LINKS_PATH = path.join(
  process.env.HOME ?? "",
  "fm-plans",
  "supplement_links.yaml"
);

export interface SupplementLink {
  key: string; // lowercase, used as lookup key in Python
  display_name: string;
  url: string;
  source: "amazon" | "iherb" | "other";
  notes?: string;
}

/** Load all custom supplement links. */
export async function loadSupplementLinks(): Promise<SupplementLink[]> {
  if (!fs.existsSync(LINKS_PATH)) return [];
  try {
    const { load } = await import("js-yaml");
    const raw = load(fs.readFileSync(LINKS_PATH, "utf-8")) as Record<
      string,
      { display_name?: string; url?: string; source?: string; notes?: string }
    > | null;
    if (!raw) return [];
    return Object.entries(raw).map(([key, val]) => ({
      key,
      display_name: val.display_name ?? key.replace(/_/g, " "),
      url: val.url ?? "",
      source: (val.source as SupplementLink["source"]) ?? "other",
      notes: val.notes,
    }));
  } catch {
    return [];
  }
}

/** Upsert a single supplement link (create or update by key). */
export async function upsertSupplementLink(
  link: SupplementLink
): Promise<{ ok: boolean; error?: string }> {
  try {
    const existing = await loadSupplementLinks();
    const map: Record<string, Omit<SupplementLink, "key">> = {};
    for (const l of existing) {
      map[l.key] = {
        display_name: l.display_name,
        url: l.url,
        source: l.source,
        ...(l.notes ? { notes: l.notes } : {}),
      };
    }
    // Upsert
    const key = link.key
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    map[key] = {
      display_name: link.display_name,
      url: link.url,
      source: link.source,
      ...(link.notes ? { notes: link.notes } : {}),
    };

    const { dump } = await import("js-yaml");
    fs.mkdirSync(path.dirname(LINKS_PATH), { recursive: true });
    fs.writeFileSync(LINKS_PATH, dump(map, { lineWidth: 120 }), "utf-8");
    revalidatePath("/backlog");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Delete a supplement link by key. */
export async function deleteSupplementLink(
  key: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const existing = await loadSupplementLinks();
    const map: Record<string, Omit<SupplementLink, "key">> = {};
    for (const l of existing) {
      if (l.key !== key) {
        map[l.key] = {
          display_name: l.display_name,
          url: l.url,
          source: l.source,
          ...(l.notes ? { notes: l.notes } : {}),
        };
      }
    }
    const { dump } = await import("js-yaml");
    fs.writeFileSync(LINKS_PATH, dump(map, { lineWidth: 120 }), "utf-8");
    revalidatePath("/backlog");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

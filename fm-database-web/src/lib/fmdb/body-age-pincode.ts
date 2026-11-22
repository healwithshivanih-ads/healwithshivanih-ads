/**
 * Does the laboratory come to this PIN code? Checked on the order form BEFORE payment (Shivani, 21 Nov 2026:
 * "Pin code - we should check at the time of booking itself").
 *
 * The laboratory's partner site publishes its list of serviceable PIN codes and refreshes it weekly. A copy
 * lives in the catalogue at `lab_providers/thyrocare_pincodes.txt` (one six-digit code per line; `#` lines are
 * notes, the first of which should carry the date it was read). The app has no live link to the laboratory.
 *
 * Three answers, on purpose:
 *   yes      the code is in the list
 *   no       the list is loaded and the code is not in it: the order is refused before any money moves
 *   unknown  there is no list (missing or empty file): the order goes ahead as before, and the visit is
 *            confirmed by hand on WhatsApp, with a full refund if the laboratory cannot come.
 * A stale list can be wrong both ways, so the "no" wording sends the buyer to WhatsApp instead of a dead end.
 *
 * Pure core first; the loader imports paths lazily (vitest convention, see body-age-orders.ts).
 */
export type PinAnswer = "yes" | "no" | "unknown";

/** Six-digit Indian PIN codes from a list file. Anything else on a line is ignored. */
export function parsePincodeList(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0];
    for (const m of line.matchAll(/(?<!\d)[1-9]\d{5}(?!\d)/g)) out.add(m[0]);
  }
  return out;
}

export function tidyPincode(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\D/g, "").slice(0, 6) : "";
}

export function pincodeAnswer(pincode: string, list: Set<string> | null): PinAnswer {
  if (!list || list.size === 0) return "unknown";
  return list.has(tidyPincode(pincode)) ? "yes" : "no";
}

let cache: { file: string; mtimeMs: number; list: Set<string> } | null = null;

/** The catalogue's list, or null when there is none. Re-read when the file changes. */
export async function loadPincodeList(file?: string): Promise<Set<string> | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let f = file;
  if (!f) {
    const { getCataloguePath } = await import("@/lib/fmdb/paths");
    f = path.join(getCataloguePath(), "lab_providers", "thyrocare_pincodes.txt");
  }
  try {
    const st = await fs.stat(f);
    if (cache && cache.file === f && cache.mtimeMs === st.mtimeMs) return cache.list;
    const list = parsePincodeList(await fs.readFile(f, "utf8"));
    cache = { file: f, mtimeMs: st.mtimeMs, list };
    return list.size ? list : null;
  } catch {
    return null;
  }
}

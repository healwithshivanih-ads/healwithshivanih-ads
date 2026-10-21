import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";
import { parseContentLibrary, type ContentItem } from "./content-library";

export const CONTENT_LIBRARY_FILE = "_content_library.yaml";

/** The library, or an empty list if the file is missing or unreadable — no link is ever better than a wrong one. */
export async function loadContentLibrary(): Promise<ContentItem[]> {
  try {
    const raw = yaml.load(await fs.readFile(path.join(getCataloguePath(), CONTENT_LIBRARY_FILE), "utf-8"));
    return parseContentLibrary(raw).items;
  } catch {
    return [];
  }
}

/**
 * Is a library link actually reachable right now? YouTube via oEmbed (a
 * private / not-yet-premiered video answers 401/403), anything else by a GET
 * that must answer 200. Used at approval, after the date check — the date in
 * the library is a plan; this is the fact.
 */
export async function linkIsPublic(url: string): Promise<boolean> {
  try {
    const target = /^https:\/\/(youtu\.be|(www\.)?youtube\.com)\//.test(url)
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : url;
    const res = await fetch(target, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

import "server-only";

/**
 * App open tracking (2026-06-12, app rollout).
 *
 * Every /app/<token> render ON FLY appends a timestamp to
 * clients/<id>/_app_opens.yaml. The FLY_INTAKE_ONLY gate is the whole
 * trick: clients only ever hit Fly, the coach only ever hits localhost
 * (incl. the studio's phone-preview iframe) — so coach previews never
 * pollute the data. On Fly the plans root is the staging tree; the
 * per-minute intake-reconcile cron union-merges the file back into the
 * authoritative store on the Mac (app-staging-action.py).
 *
 * Reads are coach-side (dashboard adoption columns) against the
 * authoritative store.
 */

import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

const MAX_OPENS = 500;

function opensFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_app_opens.yaml");
}

/** Fire-and-forget append — never throws, never blocks the page. */
export async function logAppOpen(clientId: string): Promise<void> {
  if (!process.env.FLY_INTAKE_ONLY) return; // client traffic only
  try {
    const file = opensFile(clientId);
    let opens: string[] = [];
    try {
      const doc = yaml.load(await fs.readFile(file, "utf8")) as { opens?: string[] } | null;
      if (Array.isArray(doc?.opens)) opens = doc.opens;
    } catch {
      /* first open */
    }
    opens.push(new Date().toISOString());
    if (opens.length > MAX_OPENS) opens = opens.slice(-MAX_OPENS);
    await fs.writeFile(file, yaml.dump({ opens }), "utf8");
  } catch (err) {
    console.error("[app-opens] log failed:", err);
  }
}

export interface AppOpenStats {
  count: number;
  lastOpenedAt: string | null; // ISO
}

/** Coach-side read for the adoption view. */
export async function readAppOpens(clientId: string): Promise<AppOpenStats> {
  try {
    const doc = yaml.load(await fs.readFile(opensFile(clientId), "utf8")) as {
      opens?: string[];
    } | null;
    const opens = Array.isArray(doc?.opens) ? doc.opens : [];
    return { count: opens.length, lastOpenedAt: opens[opens.length - 1] ?? null };
  } catch {
    return { count: 0, lastOpenedAt: null };
  }
}

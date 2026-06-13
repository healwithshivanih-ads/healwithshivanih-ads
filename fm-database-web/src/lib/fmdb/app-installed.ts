import "server-only";

/**
 * App INSTALL tracking (2026-06-13) — a truer signal than "opened".
 *
 * "Opened" only means the client loaded /app/<token> in a browser tab.
 * "Installed" means the PWA is on their home screen: we detect it when the
 * app runs in standalone display-mode (the only cross-platform signal —
 * iOS never fires `appinstalled`), or when the `appinstalled` event fires
 * (Android/desktop). The client posts to /api/app-installed; we stamp
 * clients/<id>/_app_installed.yaml.
 *
 * Fly is effectively the sole writer (clients only hit Fly; the standalone
 * check filters out coach previews in a normal tab). The per-minute
 * intake-reconcile cron copies the file back to the authoritative store on
 * the Mac, newest-wins (app-staging-action.py), same as _push_subscription.
 *
 * NOTE: this can't backfill clients who installed before this shipped — it's
 * a forward-going count. Reads are coach-side (dashboard adoption tile).
 */

import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

function installedFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_app_installed.yaml");
}

interface InstalledDoc {
  installed?: boolean;
  first_installed_at?: string;
  last_confirmed_at?: string;
  source?: string;
  platform?: string;
}

/** Fire-and-forget stamp — never throws. Preserves first_installed_at across
 *  repeat confirmations; bumps last_confirmed_at each time. */
export async function recordAppInstalled(
  clientId: string,
  opts: { source?: string; platform?: string } = {},
): Promise<void> {
  try {
    const file = installedFile(clientId);
    let prev: InstalledDoc = {};
    try {
      prev = (yaml.load(await fs.readFile(file, "utf8")) as InstalledDoc | null) ?? {};
    } catch {
      /* first install */
    }
    const now = new Date().toISOString();
    const doc: InstalledDoc = {
      installed: true,
      first_installed_at: prev.first_installed_at || now,
      last_confirmed_at: now,
      source: prev.source || opts.source || "standalone",
      platform: opts.platform || prev.platform || "",
    };
    await fs.writeFile(file, yaml.dump(doc), "utf8");
  } catch (err) {
    console.error("[app-installed] record failed:", err);
  }
}

export interface AppInstallStats {
  installed: boolean;
  firstInstalledAt: string | null;
  lastConfirmedAt: string | null;
}

/** Coach-side read for the adoption view. */
export async function readAppInstalled(clientId: string): Promise<AppInstallStats> {
  try {
    const doc = (yaml.load(await fs.readFile(installedFile(clientId), "utf8")) as InstalledDoc | null) ?? {};
    return {
      installed: doc.installed === true,
      firstInstalledAt: doc.first_installed_at ?? null,
      lastConfirmedAt: doc.last_confirmed_at ?? null,
    };
  } catch {
    return { installed: false, firstInstalledAt: null, lastConfirmedAt: null };
  }
}

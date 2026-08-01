/**
 * Has this client been around lately?
 *
 * One question, two callers who need it answered DIFFERENTLY, which is the
 * whole reason this module exists rather than a single exported helper.
 *
 *   - The weekly-menu cron asks it while the client is ABSENT. "Days since
 *     their last open" is exactly right there: nobody has touched the app, the
 *     number climbs, and past 14 days we stop burning Haiku calls on menus
 *     nobody reads.
 *
 *   - The client app asks it while the client is LOOKING AT IT. The same
 *     question returns 0 for everyone, always — opening the app is what
 *     triggers the render, so the most recent open is always seconds old. A
 *     dormancy check written that way would never once fire in the surface
 *     that most needs it.
 *
 * So the render-time question is asked about the gap BEFORE this visit:
 * ignore opens from the last 24 hours, and ask how long the silence was
 * before them. A client returning after three weeks reads as 21 days on the
 * morning they come back, and as 1 day the following morning — which is the
 * self-lifting behaviour we want, with nothing to un-pause by hand.
 *
 * The 24-hour filter is also why this needs no timezone. "Yesterday" in the
 * client's own zone and "more than 24h ago" differ by hours; the threshold
 * they are compared against is two weeks.
 */

import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";

import { getPlansRoot } from "./paths";

/**
 * Dormancy cut-off in days, shared by the menu cron and the practice drip.
 *
 * Coach set 14 on 2026-07-24 for weekly menus: two missed weeks is a clear
 * signal, and it reverses itself the moment the client opens the app again.
 * The practice drip reuses the same number deliberately — a client who is too
 * absent to be worth drafting a menu for is a client who should not come back
 * to a pile of new practices either.
 *
 * The env var keeps its original menu-scoped name so an existing override on
 * the Mac cron does not silently stop working; it now governs both. 0
 * disables the pause entirely.
 */
export const DORMANT_DAYS = Number(process.env.FM_MENU_DORMANT_DAYS ?? 14);

const DAY_MS = 86_400_000;

/** Raw open timestamps from ~/fm-plans/clients/<id>/_app_opens.yaml. */
export async function readAppOpens(clientId: string): Promise<string[]> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "_app_opens.yaml");
    const doc = (yaml.load(await fs.readFile(f, "utf-8")) as { opens?: unknown[] }) ?? {};
    return (doc.opens ?? []).map(String).filter(Boolean);
  } catch {
    // No file yet is the normal state for a client who has never opened the
    // app. Treated as "unknown", never as "dormant" — see below.
    return [];
  }
}

/** Most recent parseable timestamp, in ms. Null when there isn't one. */
function latestMs(opens: string[]): number | null {
  let best: number | null = null;
  for (const o of opens) {
    const t = Date.parse(o);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

/**
 * Days since the client last opened the app — the ABSENT-side question, for
 * the menu cron.
 *
 * Null when there are no opens on record. A client who has never opened the
 * app is deliberately NOT dormant: they have not had the chance yet, and
 * treating them as dormant would pause their very first menu.
 */
export function daysSinceLastOpen(opens: string[], nowMs = Date.now()): number | null {
  const last = latestMs(opens);
  if (last === null) return null;
  return Math.floor((nowMs - last) / DAY_MS);
}

/**
 * Length of the silence BEFORE this visit — the PRESENT-side question, for
 * anything rendered while the client is in the app.
 *
 * Opens inside the last 24 hours are excluded, so the answer describes the
 * gap the client just broke rather than the visit breaking it.
 *
 * Null when they have no older opens at all: a first-week client has no gap
 * to measure, and inventing one would gate them out of their own plan.
 */
export function daysSinceOpenBeforeToday(
  opens: string[],
  nowMs = Date.now(),
): number | null {
  const older = opens.filter((o) => {
    const t = Date.parse(o);
    return Number.isFinite(t) && nowMs - t >= DAY_MS;
  });
  return daysSinceLastOpen(older, nowMs);
}

/** Convenience for the menu cron, which only ever wants the absent-side read. */
export async function daysSinceLastAppOpen(clientId: string): Promise<number | null> {
  return daysSinceLastOpen(await readAppOpens(clientId));
}

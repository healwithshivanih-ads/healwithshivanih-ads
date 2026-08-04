/**
 * Per-client pause on weekly AI generation — the menu draft AND the recipe
 * pack that follows it.
 *
 * There are TWO ways this can be off for a client, and they are not the same
 * thing:
 *
 *   · DORMANCY (app-engagement.ts) — automatic, inferred from app opens, and
 *     self-lifting: the client comes back, generation resumes, nothing to
 *     un-pause by hand. It answers "has she disappeared?"
 *
 *   · THIS — a deliberate standing decision by the coach about a client who is
 *     very much present. Hariharan and Shruti both open the app; they just do
 *     not need a fresh menu written every week. So it is stickier than
 *     dormancy on purpose: no app open, no new plan and no cron clears it,
 *     only the coach. A pause that quietly undid itself would put her straight
 *     back to paying for content nobody reads.
 *
 * What a paused client keeps: everything already on disk. The app falls back
 * to the last loaded week (client-app.ts week resolution), so she stays
 * FROZEN on her current menu rather than seeing an empty one, and recipes
 * already written keep rendering. This gates the WRITE path only.
 */

import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";

import { getPlansRoot } from "./paths";

function clientFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "client.yaml");
}

/** Is the weekly recipe pack paused for this client?
 *
 *  Fails OPEN (false) when the record is missing or unreadable — an unreadable
 *  client.yaml is a problem to fix, not a reason to silently stop generating
 *  for someone the coach never paused.
 */
export async function weeklyGenerationPaused(clientId: string): Promise<boolean> {
  try {
    const doc =
      (yaml.load(await fs.readFile(clientFile(clientId), "utf-8")) as {
        weekly_generation_paused?: unknown;
      }) ?? {};
    return doc.weekly_generation_paused === true;
  } catch {
    return false;
  }
}

/**
 * Set (or clear) the pause.
 *
 * Read-modify-write on the whole document, which is how every other
 * client.yaml writer here works. The alternative — a targeted line edit —
 * cannot be done safely against a hand-formatted 2000-line file with nested
 * blocks that repeat the same key names.
 *
 * `dumpYaml` is NOT used because it does not exist on this path; js-yaml's
 * own dump is what `updateClientFieldsAction` and friends use. The
 * PyYAML-underscore-int hazard does not apply to a boolean.
 */
export async function setWeeklyGenerationPaused(
  clientId: string,
  paused: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const file = clientFile(clientId);
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>) ?? {};
  } catch (e) {
    return { ok: false, error: `Could not read ${clientId}: ${(e as Error).message}` };
  }
  if (doc.weekly_generation_paused === paused) return { ok: true };
  doc.weekly_generation_paused = paused;
  doc.updated_at = new Date().toISOString();
  doc.updated_by = "Shivani";
  const v = Number(doc.version);
  doc.version = Number.isFinite(v) ? v + 1 : 1;
  try {
    // Atomic temp + rename — mirrors supplement-change-notify.ts, so a crash
    // mid-write cannot truncate a PHI record.
    const tmp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
    await fs.rename(tmp, file);
  } catch (e) {
    return { ok: false, error: `Could not write ${clientId}: ${(e as Error).message}` };
  }
  return { ok: true };
}

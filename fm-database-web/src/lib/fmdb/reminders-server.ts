/**
 * Server-only store for the client's reminder OVERRIDES.
 *
 * Reminders themselves are derived from the live plan (see reminders-derive.ts)
 * at both display time (Fly) and fire time (Mac cron) — so a republished plan
 * regenerates them automatically. This file holds only what the client changed:
 * which reminders they silenced, and any time they pinned. Stored at
 * clients/<id>/_reminders.yaml; the staging cron reverse-mirrors it Fly→Mac
 * (Fly is the sole writer, newest wins — same posture as _push_subscription).
 *
 * Delivery state (which reminder fired on which day) lives in a SEPARATE file,
 * _reminders_fired.yaml, written ONLY by the cron on the Mac and never synced —
 * keeping it off Fly means a preference edit can't clobber it and double-fire.
 *
 * NOT a "use server" file — a plain server util imported by the API route, the
 * cron handler, and loadClientAppData.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import type { ReminderOverrides } from "./reminders-derive";

interface OverrideDoc {
  /** app token at save time — used to deep-link the push to /app/<token> */
  token?: string;
  overrides: ReminderOverrides;
  updated_at: string;
}

function remFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_reminders.yaml");
}
function firedFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_reminders_fired.yaml");
}

async function writeAtomic(file: string, doc: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 200 }), "utf-8");
  await fs.rename(tmp, file);
}

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Coerce the app's posted items into a clean override map. */
export function itemsToOverrides(rawItems: unknown[]): ReminderOverrides {
  const out: ReminderOverrides = {};
  for (const raw of rawItems.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.slice(0, 40) : "";
    if (!id) continue;
    const o: { on?: boolean; time?: string; time_custom?: boolean } = {
      on: r.on === true,
    };
    if (r.time_custom === true && typeof r.time === "string" && VALID_TIME.test(r.time)) {
      o.time = r.time;
      o.time_custom = true;
    }
    out[id] = o;
  }
  return out;
}

export async function saveOverrides(
  clientId: string,
  token: string,
  overrides: ReminderOverrides,
): Promise<void> {
  await writeAtomic(remFile(clientId), {
    token: token || undefined,
    overrides,
    updated_at: new Date().toISOString(),
  } satisfies OverrideDoc);
}

export async function readOverrides(
  clientId: string,
): Promise<{ token: string; overrides: ReminderOverrides }> {
  try {
    const raw = await fs.readFile(remFile(clientId), "utf-8");
    const d = yaml.load(raw) as OverrideDoc | null;
    const overrides = d?.overrides && typeof d.overrides === "object" ? d.overrides : {};
    return { token: typeof d?.token === "string" ? d.token : "", overrides };
  } catch {
    return { token: "", overrides: {} };
  }
}

// ── Fired-tracking (cron-side only, Mac-authoritative, never synced) ──────────

type FiredMap = Record<string, string>; // reminderId -> "YYYY-MM-DD" (IST) last fired

export async function readFired(clientId: string): Promise<FiredMap> {
  try {
    const raw = await fs.readFile(firedFile(clientId), "utf-8");
    const d = yaml.load(raw) as { fired?: FiredMap } | null;
    return d?.fired && typeof d.fired === "object" ? d.fired : {};
  } catch {
    return {};
  }
}

export async function writeFired(clientId: string, fired: FiredMap): Promise<void> {
  await writeAtomic(firedFile(clientId), { fired, updated_at: new Date().toISOString() });
}

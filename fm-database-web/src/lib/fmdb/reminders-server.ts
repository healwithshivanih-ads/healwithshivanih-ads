/**
 * Server-only store for the client app's time-of-day reminder preferences.
 *
 * The client toggles reminders + times in the app's Account screen (on Fly).
 * Those land in clients/<id>/_reminders.yaml. The staging cron reverse-mirrors
 * that file to the Mac (newest wins — same posture as _push_subscription.yaml),
 * where the /api/cron/app-reminders job reads it and fires a web-push at each
 * reminder's time via sendPushToClient.
 *
 * Delivery state (which reminder fired on which day) lives in a SEPARATE file,
 * _reminders_fired.yaml, written ONLY by the cron on the Mac and never synced —
 * keeping it out of _reminders.yaml means a Fly-side preference edit can't
 * clobber the Mac's fired-tracking and cause a double-fire.
 *
 * NOT a "use server" file — a plain server util imported by the API route and
 * the cron handler.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

export type ReminderCadence = "daily" | "weekly";

export interface ReminderItem {
  id: string;
  /** Short client-facing line, used as the push body. */
  label: string;
  /** 24h local (IST) "HH:MM". */
  time: string;
  on: boolean;
  cadence: ReminderCadence;
  /** 0=Sun … 6=Sat — only meaningful when cadence === "weekly". */
  weekday?: number;
}

export interface ReminderDoc {
  /** The app token at save time — used to deep-link the push to /app/<token>. */
  token?: string;
  items: ReminderItem[];
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

/** Coerce one untrusted item from the app into a clean ReminderItem, or null. */
function sanitizeItem(raw: unknown): ReminderItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.slice(0, 40) : "";
  const label = typeof r.label === "string" ? r.label.slice(0, 120) : "";
  const time = typeof r.time === "string" ? r.time.trim() : "";
  if (!id || !label || !VALID_TIME.test(time)) return null;
  const cadence: ReminderCadence = r.cadence === "weekly" ? "weekly" : "daily";
  const weekday =
    cadence === "weekly" && typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6
      ? Math.floor(r.weekday)
      : undefined;
  return { id, label, time, on: r.on === true, cadence, weekday };
}

/** Persist the full reminder set for a client (overwrite — the app sends all). */
export async function saveReminders(
  clientId: string,
  token: string,
  rawItems: unknown[],
): Promise<ReminderItem[]> {
  const items = rawItems.map(sanitizeItem).filter((x): x is ReminderItem => x !== null).slice(0, 30);
  await writeAtomic(remFile(clientId), {
    token: token || undefined,
    items,
    updated_at: new Date().toISOString(),
  } satisfies ReminderDoc);
  return items;
}

export async function readReminders(clientId: string): Promise<ReminderDoc | null> {
  try {
    const raw = await fs.readFile(remFile(clientId), "utf-8");
    const d = yaml.load(raw) as ReminderDoc | null;
    if (!d || !Array.isArray(d.items)) return null;
    d.items = d.items.map(sanitizeItem).filter((x): x is ReminderItem => x !== null);
    return d;
  } catch {
    return null;
  }
}

// ── Fired-tracking (cron-side only, Mac-authoritative, never synced) ──────────

type FiredMap = Record<string, string>; // reminderId -> "YYYY-MM-DD" last fired (IST)

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

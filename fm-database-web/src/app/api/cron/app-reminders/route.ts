/**
 * POST /api/cron/app-reminders — fire time-of-day push reminders.
 *
 * Fired every minute by scripts/cron-runner.js.
 *
 * For each client with a clients/<id>/_reminders.yaml (written by the app's
 * Account screen, reverse-mirrored from Fly), for each ENABLED reminder whose
 * local-IST time has arrived today and hasn't fired yet, send a web-push via
 * sendPushToClient. Idempotent per (client, reminder, day) via the Mac-only
 * _reminders_fired.yaml.
 *
 * Catch-up semantics: a reminder fires at its time OR up to CATCHUP_WINDOW_MIN
 * minutes late (so a sleeping Mac that wakes mid-morning still nudges, once),
 * but never blasts a long-past reminder — important on first deploy and after
 * extended downtime.
 *
 * A reminder only lands if the client has ALSO enabled push; sendPushToClient
 * returns false otherwise and we DON'T mark it fired (so it can still arrive if
 * they switch push on later within the catch-up window).
 *
 * Auth: x-cron-secret header must match CRON_SECRET env — same pattern as all
 * other /api/cron/* routes.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { readReminders, readFired, writeFired } from "@/lib/fmdb/reminders-server";
import { sendPushToClient } from "@/lib/fmdb/push-server";

export const dynamic = "force-dynamic";

const IST_TZ = "Asia/Kolkata";
/** How late a reminder may fire (covers a Mac waking from sleep). */
const CATCHUP_WINDOW_MIN = 180;

/** "YYYY-MM-DD" in IST. */
function todayIST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: IST_TZ });
}

/** Current IST minutes-of-day (0–1439) and weekday (0=Sun). */
function nowIST(): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minutes: hour * 60 + minute, weekday: wkMap[get("weekday")] ?? -1 };
}

function parseHHMM(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const today = todayIST();
  const { minutes: nowMin, weekday: nowWeekday } = nowIST();

  const clientsDir = path.join(getPlansRoot(), "clients");
  let clientIds: string[] = [];
  try {
    const entries = await fs.readdir(clientsDir, { withFileTypes: true });
    clientIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return NextResponse.json({ ok: true, today, sent: 0, detail: { note: "no clients dir" } });
  }

  const sent: Array<{ clientId: string; id: string }> = [];
  const skipped: Array<{ clientId: string; id: string; reason: string }> = [];

  for (const clientId of clientIds) {
    const doc = await readReminders(clientId);
    if (!doc || doc.items.length === 0) continue;

    const fired = await readFired(clientId);
    let dirty = false;
    const url = doc.token ? `/app/${doc.token}` : "/";

    for (const item of doc.items) {
      if (!item.on) continue;
      if (item.cadence === "weekly" && item.weekday !== nowWeekday) continue;

      const remMin = parseHHMM(item.time);
      if (remMin === null) {
        skipped.push({ clientId, id: item.id, reason: "bad_time" });
        continue;
      }
      const lateBy = nowMin - remMin;
      if (lateBy < 0) continue; // not yet
      if (lateBy > CATCHUP_WINDOW_MIN) continue; // too late today
      if (fired[item.id] === today) continue; // already fired today

      const ok = await sendPushToClient(clientId, {
        title: "The Ochre Tree 🌿",
        body: item.label,
        url,
        tag: `reminder:${item.id}`,
      });
      if (ok) {
        fired[item.id] = today;
        dirty = true;
        sent.push({ clientId, id: item.id });
      } else {
        // push not enabled / not subscribed / delivery failed — retry next tick
        skipped.push({ clientId, id: item.id, reason: "push_unavailable" });
      }
    }

    if (dirty) {
      await writeFired(clientId, fired).catch((e) =>
        console.error(`[app-reminders] ${clientId}: failed to persist fired:`, e?.message),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    now_ist_min: nowMin,
    sent: sent.length,
    skipped: skipped.length,
    detail: { sent, skipped },
  });
}

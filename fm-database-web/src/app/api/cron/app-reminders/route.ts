/**
 * POST /api/cron/app-reminders — fire plan-derived, time-of-day push reminders.
 *
 * Fired every minute by scripts/cron-runner.js.
 *
 * For each client with a published plan: re-derive the reminder set from the
 * CURRENT plan (so a republished plan regenerates automatically), overlay the
 * client's saved on/off + pinned-time overrides, and for each enabled reminder
 * whose local-IST time has arrived today (and hasn't fired yet) send a web-push
 * via sendPushToClient. Idempotent per (client, reminder, day) via the Mac-only
 * _reminders_fired.yaml.
 *
 * Cheap: skips any client without an enabled push subscription before touching
 * the plan, and skips any reminder not due this minute.
 *
 * Catch-up: a reminder fires at its time OR up to CATCHUP_WINDOW_MIN late (so a
 * sleeping Mac that wakes mid-morning still nudges once), but never blasts a
 * long-past reminder. A reminder only lands if the client has push on; if
 * delivery is unavailable we DON'T mark it fired (so it can still arrive if they
 * enable push later within the window).
 *
 * Auth: x-cron-secret must match CRON_SECRET — same pattern as all /api/cron/*.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { deriveReminders, effectiveReminders } from "@/lib/fmdb/reminders-derive";
import { readOverrides, readFired, writeFired } from "@/lib/fmdb/reminders-server";
import { sendPushToClient, pushStatus } from "@/lib/fmdb/push-server";

export const dynamic = "force-dynamic";

const IST_TZ = "Asia/Kolkata";
const CATCHUP_WINDOW_MIN = 180;

type Dict = Record<string, unknown>;

function todayIST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: IST_TZ });
}

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
  const wk: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minutes: hour * 60 + minute, weekday: wk[get("weekday")] ?? -1 };
}

function parseHHMM(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Authoritative published plan for a client (the Mac holds the source of truth). */
async function publishedPlanForClient(clientId: string): Promise<Dict | null> {
  const dir = path.join(getPlansRoot(), "published");
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    try {
      const d = yaml.load(await fs.readFile(path.join(dir, f), "utf-8")) as Dict | null;
      if (d && d.client_id === clientId) return d;
    } catch {
      /* skip malformed */
    }
  }
  return null;
}

async function readClientYaml(clientId: string): Promise<Dict> {
  try {
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
      "utf-8",
    );
    return (yaml.load(raw) as Dict) ?? {};
  } catch {
    return {};
  }
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
    // Gate on push before any plan I/O — no subscription means nothing to fire.
    if (!(await pushStatus(clientId)).enabled) continue;

    const plan = await publishedPlanForClient(clientId);
    if (!plan) continue;
    const client = await readClientYaml(clientId);

    const { token, overrides } = await readOverrides(clientId);
    const reminders = effectiveReminders(deriveReminders(plan, client), overrides);
    if (reminders.length === 0) continue;

    const fired = await readFired(clientId);
    let dirty = false;
    const url = token ? `/app/${token}` : "/";

    for (const r of reminders) {
      if (!r.on) continue;
      if (r.cadence === "weekly" && r.weekday !== nowWeekday) continue;

      const remMin = parseHHMM(r.time);
      if (remMin === null) continue;
      const lateBy = nowMin - remMin;
      if (lateBy < 0 || lateBy > CATCHUP_WINDOW_MIN) continue;
      if (fired[r.id] === today) continue;

      const ok = await sendPushToClient(clientId, {
        title: "The Ochre Tree 🌿",
        body: r.label,
        url,
        tag: `reminder:${r.id}`,
      });
      if (ok) {
        fired[r.id] = today;
        dirty = true;
        sent.push({ clientId, id: r.id });
      } else {
        skipped.push({ clientId, id: r.id, reason: "push_unavailable" });
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

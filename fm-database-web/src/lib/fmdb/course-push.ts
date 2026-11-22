/**
 * Web push for course listeners (guided/<id>/_push_subscription.yaml).
 *
 * Kept apart from push-server.ts on purpose: that module is keyed on
 * clients/<id> and every send goes through the CLIENT contact gate, which a
 * course buyer (not a client) has no lifecycle for. A course listener's gate
 * is simpler and stricter:
 *   - the subscriber is active and owns the course,
 *   - the listener turned notifications on themselves, and
 *   - only the two reminders they chose: the daily one at THEIR time, and
 *     "a new session is open". Nothing else ever goes out from here — no
 *     offers, no nudges to buy (the coach does not chase).
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import webpush from "web-push";
import { guidedRoot } from "./guided-tier";
import { VAPID_PUBLIC_KEY } from "./push-public";
import type { WebPushSubscription } from "./push-server";

const SUBJECT = process.env.VAPID_SUBJECT || "mailto:reachochretree@gmail.com";

let configured = false;
function ensureConfigured(): boolean {
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  if (!priv) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, priv);
    configured = true;
  }
  return true;
}

interface Stored extends WebPushSubscription {
  updated_at?: string;
}

function subFile(subscriberId: string): string {
  if (!/^gd-[a-f0-9]{6,20}$/.test(subscriberId)) throw new Error("bad subscriber id");
  return path.join(guidedRoot(), subscriberId, "_push_subscription.yaml");
}

async function readDevices(subscriberId: string): Promise<Stored[]> {
  try {
    const d = yaml.load(await fs.readFile(subFile(subscriberId), "utf8")) as { subscriptions?: Stored[] } | null;
    return (d?.subscriptions ?? []).filter((s) => s?.endpoint && s.keys?.p256dh && s.keys?.auth);
  } catch {
    return [];
  }
}

async function writeDevices(subscriberId: string, devices: Stored[]): Promise<void> {
  const file = subFile(subscriberId);
  if (!devices.length) {
    await fs.unlink(file).catch(() => {});
    return;
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    tmp,
    yaml.dump({ subscriptions: devices, enabled: true, updated_at: new Date().toISOString() }, { lineWidth: 200 }),
    "utf8",
  );
  await fs.rename(tmp, file);
}

export async function saveCourseSubscription(subscriberId: string, sub: WebPushSubscription): Promise<void> {
  const others = (await readDevices(subscriberId)).filter((d) => d.endpoint !== sub.endpoint);
  await writeDevices(subscriberId, [...others, { ...sub, updated_at: new Date().toISOString() }]);
}

export async function removeCourseSubscription(subscriberId: string, endpoint?: string): Promise<void> {
  const left = endpoint ? (await readDevices(subscriberId)).filter((d) => d.endpoint !== endpoint) : [];
  await writeDevices(subscriberId, left);
}

export async function coursePushStatus(subscriberId: string): Promise<{ enabled: boolean; devices: number }> {
  const n = (await readDevices(subscriberId)).length;
  return { enabled: n > 0, devices: n };
}

/** Best-effort send to every device; prunes dead endpoints; never throws. */
export async function sendCoursePush(
  subscriberId: string,
  payload: { title: string; body: string; url: string; tag: string },
): Promise<boolean> {
  if (!ensureConfigured()) return false;
  const devices = await readDevices(subscriberId);
  if (!devices.length) return false;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.sendNotification(d as webpush.PushSubscription, body, { urgency: "normal", TTL: 6 * 60 * 60 });
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(d.endpoint);
        else console.error(`[course-push] ${subscriberId} delivery failed (HTTP ${status ?? "?"})`);
      }
    }),
  );
  if (dead.length) await writeDevices(subscriberId, devices.filter((d) => !dead.includes(d.endpoint)));
  return sent > 0;
}

/**
 * Server-only web-push: store client subscriptions + send notifications.
 * Used by the /api/app-push route (subscribe/unsubscribe) and by event
 * triggers (e.g. a new weekly menu going live). NOT a "use server" file —
 * a plain server util imported by server actions / route handlers.
 *
 * Subscription lives at clients/<id>/_push_subscription.yaml. On Fly the
 * client writes it (subscribe hits the public app); the staging cron
 * reverse-mirrors it to the Mac so coach-side sends can read it too.
 *
 * A CLIENT HAS DEVICES, PLURAL. This stored one subscription and silently
 * overwrote it, so a client who turned notifications on for their laptop and
 * then their phone had the laptop quietly stop working — and the reverse:
 * turning it on somewhere that is not the phone they actually check looks
 * exactly like push being broken. Nothing reported it, because overwriting
 * succeeded. Devices are a list now, every one is sent to, and the legacy
 * single-subscription file is still read so nobody has to re-subscribe.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import webpush from "web-push";
import { getPlansRoot } from "./paths";
import { VAPID_PUBLIC_KEY } from "./push-public";

const SUBJECT = process.env.VAPID_SUBJECT || "mailto:reachochretree@gmail.com";
const PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

let configured = false;
function ensureConfigured(): boolean {
  if (!PRIVATE) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, PRIVATE);
    configured = true;
  }
  return true;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
interface StoredDevice extends WebPushSubscription {
  updated_at?: string;
}
interface SubDoc {
  /** Current shape. */
  subscriptions?: StoredDevice[];
  /** Legacy single-device shape, still read so existing clients keep working. */
  subscription?: WebPushSubscription;
  enabled: boolean;
  updated_at: string;
}

function subFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_push_subscription.yaml");
}

async function readDoc(clientId: string): Promise<SubDoc | null> {
  try {
    const raw = await fs.readFile(subFile(clientId), "utf-8");
    return (yaml.load(raw) as SubDoc | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Every device this client can be reached on, de-duplicated by endpoint.
 * Reads both the list shape and the legacy single-subscription shape.
 */
async function readDevices(clientId: string): Promise<StoredDevice[]> {
  const d = await readDoc(clientId);
  if (!d || d.enabled === false) return [];
  const raw = d.subscriptions?.length
    ? d.subscriptions
    : d.subscription
      ? [d.subscription as StoredDevice]
      : [];
  const seen = new Map<string, StoredDevice>();
  for (const s of raw) {
    if (s?.endpoint && s.keys?.p256dh && s.keys?.auth) seen.set(s.endpoint, s);
  }
  return [...seen.values()];
}

async function writeDevices(clientId: string, devices: StoredDevice[]): Promise<void> {
  if (!devices.length) {
    await removeSubscription(clientId);
    return;
  }
  await writeAtomic(subFile(clientId), {
    subscriptions: devices,
    enabled: true,
    updated_at: new Date().toISOString(),
  });
}

async function writeAtomic(file: string, doc: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 200 }), "utf-8");
  await fs.rename(tmp, file);
}

export async function saveSubscription(
  clientId: string,
  subscription: WebPushSubscription,
): Promise<void> {
  // Add or refresh THIS device. Other devices are left alone — a second
  // phone must not evict the first.
  const others = (await readDevices(clientId)).filter(
    (d) => d.endpoint !== subscription.endpoint,
  );
  await writeDevices(clientId, [
    ...others,
    { ...subscription, updated_at: new Date().toISOString() },
  ]);
}

/**
 * Toggle-off. With an endpoint, only THAT device stops — turning
 * notifications off on a laptop must not silence the phone. Without one,
 * every device stops.
 */
export async function removeSubscription(
  clientId: string,
  endpoint?: string,
): Promise<void> {
  if (endpoint) {
    const left = (await readDevices(clientId)).filter((d) => d.endpoint !== endpoint);
    if (left.length) {
      await writeAtomic(subFile(clientId), {
        subscriptions: left,
        enabled: true,
        updated_at: new Date().toISOString(),
      });
      return;
    }
  }
  try {
    await fs.unlink(subFile(clientId));
  } catch {
    /* nothing stored — fine */
  }
}

export async function pushStatus(
  clientId: string,
): Promise<{ enabled: boolean; devices: number }> {
  const devices = await readDevices(clientId);
  return { enabled: devices.length > 0, devices: devices.length };
}

/**
 * Send to every device a client has. Best-effort: returns true if AT LEAST
 * ONE delivery was accepted, never throws. Prunes endpoints the push service
 * reports as gone (404/410 — browser reinstalled or unsubscribed).
 *
 * A failure that is not a dead endpoint is LOGGED with its status code. It
 * used to be swallowed entirely, which meant "the client says push doesn't
 * work" could only be answered by guessing: an expired VAPID key, a refused
 * payload and a client who never subscribed all looked identical from the
 * outside. Those have completely different fixes.
 */
export async function sendPushToClient(
  clientId: string,
  payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    /** Lets the receiving device confirm it drew this — see
     *  /api/push-receipt. Omitted for notifications with no message behind
     *  them, like the subscribe-time check. */
    receipt?: { client: string; id: string };
  },
): Promise<boolean> {
  if (!ensureConfigured()) {
    console.error("[push] VAPID_PRIVATE_KEY not set — cannot notify", clientId);
    return false;
  }
  const devices = await readDevices(clientId);
  if (!devices.length) return false;

  const body = JSON.stringify(payload);
  // Android holds normal-priority pushes while the phone is dozing and
  // delivers them in a later batch — which reads as "notifications don't
  // work". A message from your coach is worth waking the radio for. TTL
  // caps how long the push service will retry: a day-old "Shivani replied"
  // is noise, since by then they have either seen it or she has followed up.
  const options = { urgency: "high" as const, TTL: 12 * 60 * 60 };
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(device as webpush.PushSubscription, body, options);
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(device.endpoint);
        } else {
          console.error(
            `[push] ${clientId} delivery failed (HTTP ${status ?? "?"}) to ` +
              `${new URL(device.endpoint).host}: ${(e as Error).message}`,
          );
        }
      }
    }),
  );

  if (dead.length) {
    const left = devices.filter((d) => !dead.includes(d.endpoint));
    await writeDevices(clientId, left);
  }
  return sent > 0;
}

/**
 * Server-only web-push: store client subscriptions + send notifications.
 * Used by the /api/app-push route (subscribe/unsubscribe) and by event
 * triggers (e.g. a new weekly menu going live). NOT a "use server" file —
 * a plain server util imported by server actions / route handlers.
 *
 * Subscription lives at clients/<id>/_push_subscription.yaml. On Fly the
 * client writes it (subscribe hits the public app); the staging cron
 * reverse-mirrors it to the Mac so coach-side sends can read it too.
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
interface SubDoc {
  subscription: WebPushSubscription;
  enabled: boolean;
  updated_at: string;
}

function subFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "_push_subscription.yaml");
}

async function readDoc(clientId: string): Promise<SubDoc | null> {
  try {
    const raw = await fs.readFile(subFile(clientId), "utf-8");
    const d = yaml.load(raw) as SubDoc | null;
    return d && d.subscription?.endpoint ? d : null;
  } catch {
    return null;
  }
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
  await writeAtomic(subFile(clientId), {
    subscription,
    enabled: true,
    updated_at: new Date().toISOString(),
  });
}

/** Toggle-off / unsubscribe: drop the stored subscription entirely. */
export async function removeSubscription(clientId: string): Promise<void> {
  try {
    await fs.unlink(subFile(clientId));
  } catch {
    /* nothing stored — fine */
  }
}

export async function pushStatus(clientId: string): Promise<{ enabled: boolean }> {
  const d = await readDoc(clientId);
  return { enabled: !!d?.enabled };
}

/**
 * Send a notification to a client. Best-effort: returns false (never throws)
 * when push isn't configured, the client hasn't subscribed, or delivery
 * fails. Prunes the subscription on 404/410 (browser unsubscribed / expired).
 */
export async function sendPushToClient(
  clientId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<boolean> {
  if (!ensureConfigured()) return false;
  const d = await readDoc(clientId);
  if (!d || !d.enabled) return false;
  try {
    await webpush.sendNotification(
      d.subscription as webpush.PushSubscription,
      JSON.stringify(payload),
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await removeSubscription(clientId); // dead endpoint — clean up
    }
    return false;
  }
}

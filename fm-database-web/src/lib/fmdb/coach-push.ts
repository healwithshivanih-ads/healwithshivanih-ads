/**
 * Push subscriptions for the COACH's own app (/m).
 *
 * Separate from push-server.ts, which is per-CLIENT and keyed by client id.
 * There is exactly one coach and potentially several of her devices, so the
 * shape is a list rather than a record — phone, iPad, laptop can each hold a
 * subscription and all of them should ring.
 *
 * HOST-SCOPED, for the same reason the chat thread is: `/m` runs on Fly and on
 * the Mac, both write, and the two trees are reconciled by Mutagen. Each host
 * owns its own file; reads merge every one present. A subscription made on the
 * phone (Fly) is what matters in practice — a client's message always arrives
 * on Fly — but merging costs nothing and means a Mac-made subscription is not
 * silently ignored.
 *
 * Dead endpoints are pruned on send. A browser that has been reinstalled
 * returns 404/410 forever otherwise, and a list of corpses makes every send
 * slower and the "is she reachable" question unanswerable.
 */
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { getPlansRoot } from "./paths";
import { currentHost } from "./client-thread";
import { VAPID_PUBLIC_KEY } from "./push-public";

export type CoachSubscription = {
  endpoint: string;
  subscription: webpush.PushSubscription;
  label?: string;
  updated_at: string;
};

function fileFor(host: string): string {
  const safe = host.replace(/[^a-z0-9]/gi, "").toLowerCase() || "unknown";
  return path.join(getPlansRoot(), `_coach_push.${safe}.json`);
}

function readFile(file: string): CoachSubscription[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as CoachSubscription[]) : [];
  } catch {
    return [];
  }
}

/** Every subscription across every host, de-duplicated by endpoint. */
export function listCoachSubscriptions(): CoachSubscription[] {
  const root = getPlansRoot();
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const byEndpoint = new Map<string, CoachSubscription>();
  for (const name of names) {
    if (!/^_coach_push\.[a-z0-9]+\.json$/i.test(name)) continue;
    for (const s of readFile(path.join(root, name))) {
      if (s?.endpoint && s?.subscription) {
        const prev = byEndpoint.get(s.endpoint);
        // Newest wins — a re-subscribe on the same device refreshes its keys.
        if (!prev || (s.updated_at ?? "") > (prev.updated_at ?? "")) {
          byEndpoint.set(s.endpoint, s);
        }
      }
    }
  }
  return [...byEndpoint.values()];
}

function writeThisHost(subs: CoachSubscription[]): boolean {
  const file = fileFor(currentHost());
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(subs, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** Add or refresh a device. Only ever touches THIS host's file. */
export function saveCoachSubscription(
  subscription: webpush.PushSubscription,
  label?: string,
): boolean {
  if (!subscription?.endpoint) return false;
  const mine = readFile(fileFor(currentHost())).filter(
    (s) => s.endpoint !== subscription.endpoint,
  );
  mine.push({
    endpoint: subscription.endpoint,
    subscription,
    ...(label ? { label } : {}),
    updated_at: new Date().toISOString(),
  });
  return writeThisHost(mine);
}

/** Remove one device (or all of this host's, with no endpoint). */
export function removeCoachSubscription(endpoint?: string): boolean {
  const mine = readFile(fileFor(currentHost()));
  return writeThisHost(endpoint ? mine.filter((s) => s.endpoint !== endpoint) : []);
}

export function coachPushEnabled(): boolean {
  return listCoachSubscriptions().length > 0;
}

function configured(): boolean {
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:shivanihari@gmail.com";
  if (!priv) return false;
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, priv);
  return true;
}

/**
 * Notify every one of the coach's devices.
 *
 * Returns how many actually received it — not how many were tried — so a
 * caller can tell "she was told" from "we have a list of dead endpoints".
 */
export async function sendPushToCoach(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<{ sent: number; pruned: number }> {
  if (!configured()) return { sent: 0, pruned: 0 };
  const subs = listCoachSubscriptions();
  if (!subs.length) return { sent: 0, pruned: 0 };

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payload));
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.endpoint);
      }
    }),
  );

  // Prune only this host's copies; another host will prune its own when it
  // next fails on the same endpoint.
  if (dead.length) {
    const mine = readFile(fileFor(currentHost())).filter(
      (s) => !dead.includes(s.endpoint),
    );
    writeThisHost(mine);
  }
  return { sent, pruned: dead.length };
}

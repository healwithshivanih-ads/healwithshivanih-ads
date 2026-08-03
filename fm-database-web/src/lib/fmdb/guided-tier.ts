/**
 * Guided tier — self-serve subscribers running a standard protocol.
 *
 * A guided subscriber is NOT a client. They bought the ₹6,999/yr (web) or
 * ₹7,999/yr (Play) self-guided programme: no coach-authored plan, no labs, no
 * WhatsApp access. Records live in their own bucket so the existing
 * clients/prospects scans never see them:
 *
 *     <plansRoot>/guided/<subscriberId>/subscriber.yaml
 *
 * On Fly that path sits on the Mutagen-synced volume, so a record written by
 * the enrolment endpoint at purchase time appears on the coach's Macs without
 * any manual step (same mechanism as intake submissions).
 *
 * Additive by construction — mirrors the discovery-tier discipline: no
 * existing resolver, scan or client file is touched. Package and discovery
 * clients are byte-for-byte unaffected.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { withFsRetry } from "./fs-retry";
import { dumpYaml } from "./yaml-dump";

export interface GuidedSubscriber {
  subscriber_id: string;
  display_name: string;
  email: string;
  phone: string;
  app_token: string;
  /** Slug in guided-protocols.ts ("gut-reset" …). */
  protocol_slug: string;
  /** Dietary identity, captured at join. Used ONLY to render authored
   *  alternates + an acknowledgement chip — never to compute a personalised
   *  plan (adaptation is the assessment/package boundary). Allergies are
   *  deliberately NOT stored server-side (DPDP sensitive tier); the app
   *  renders a universal allergy-override line instead. */
  dietary_preference: "" | "vegetarian" | "vegetarian_egg" | "jain" | "non_vegetarian";
  /** Additional protocols bought later (₹2,499/₹2,999 each). */
  extra_protocols: string[];
  /** YYYY-MM-DD — the Monday week 1 begins. */
  start_date: string;
  /** Razorpay/Play payment id — the enrolment idempotency key. */
  payment_id: string;
  amount_paisa: number;
  source: "web" | "play";
  status: "active" | "refunded" | "upgraded";
  /** Set when status === "upgraded": the client id whose app_token this became. */
  upgraded_to?: string;
  timezone: string;
  purchased_at: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export function guidedRoot(): string {
  return path.join(getPlansRoot(), "guided");
}

function subscriberFile(id: string): string {
  return path.join(guidedRoot(), id, "subscriber.yaml");
}

/** gd- + 10 hex — short, unambiguous, never collides with cl-* client ids. */
export function newSubscriberId(): string {
  return `gd-${crypto.randomBytes(5).toString("hex")}`;
}

/** 32-hex app token — same length class as client app_tokens (≥16 enforced
 *  by loadClientAppData). */
export function newGuidedToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Week 1 starts the next Monday — or today, when purchase lands on a Monday.
 *  Computed in the subscriber's timezone so a Sunday-night purchase in India
 *  doesn't start a week late. */
export function nextMondayYmd(now: Date, tz: string): string {
  // Day-of-week + date in the target tz.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dowName = get("weekday"); // "Mon".."Sun"
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dow = Math.max(0, DOW.indexOf(dowName));
  const daysAhead = dow === 0 ? 0 : 7 - dow;
  const base = new Date(now.getTime() + daysAhead * 86_400_000);
  const p2 = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  return p2; // en-CA gives YYYY-MM-DD
}

/** 1-indexed programme week for a YYYY-MM-DD "today" in the subscriber's tz.
 *  0 → not started yet. */
export function guidedWeek(startYmd: string, todayYmd: string): number {
  const s = Date.parse(`${startYmd}T00:00:00Z`);
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(t) || t < s) return 0;
  return Math.floor((t - s) / (7 * 86_400_000)) + 1;
}

async function readYamlFile(p: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const d = yaml.load(raw);
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function subscriberDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(guidedRoot());
    return entries.filter((e) => !e.startsWith("."));
  } catch {
    return []; // bucket doesn't exist yet — no subscribers
  }
}

function coerce(d: Record<string, unknown>): GuidedSubscriber | null {
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  if (!s(d.subscriber_id) || !s(d.app_token) || !s(d.protocol_slug)) return null;
  const diet = ((): GuidedSubscriber["dietary_preference"] => {
    const v = s(d.dietary_preference);
    return v === "vegetarian" || v === "vegetarian_egg" || v === "jain" || v === "non_vegetarian" ? v : "";
  })();
  return {
    subscriber_id: s(d.subscriber_id),
    display_name: s(d.display_name),
    email: s(d.email),
    phone: s(d.phone),
    app_token: s(d.app_token),
    protocol_slug: s(d.protocol_slug),
    dietary_preference: diet,
    extra_protocols: Array.isArray(d.extra_protocols)
      ? (d.extra_protocols as unknown[]).map((x) => String(x))
      : [],
    start_date: s(d.start_date),
    payment_id: s(d.payment_id),
    amount_paisa: typeof d.amount_paisa === "number" ? d.amount_paisa : 0,
    source: d.source === "play" ? "play" : "web",
    status: d.status === "refunded" ? "refunded" : d.status === "upgraded" ? "upgraded" : "active",
    ...(typeof d.upgraded_to === "string" && d.upgraded_to ? { upgraded_to: d.upgraded_to } : {}),
    timezone: s(d.timezone) || "Asia/Kolkata",
    purchased_at: s(d.purchased_at),
    created_at: s(d.created_at),
    updated_at: s(d.updated_at),
    version: typeof d.version === "number" ? d.version : 1,
  };
}

/** Token → subscriber. Mirrors resolveDiscoveryClientByToken's scan shape. */
export async function resolveGuidedSubscriberByToken(
  token: string,
): Promise<GuidedSubscriber | null> {
  if (!token || token.length < 16) return null;
  for (const id of await subscriberDirs()) {
    const d = await readYamlFile(subscriberFile(id));
    if (d && d.app_token === token) return coerce(d);
  }
  return null;
}

/** payment_id → subscriber (enrolment idempotency). */
export async function findGuidedByPaymentId(paymentId: string): Promise<GuidedSubscriber | null> {
  if (!paymentId) return null;
  for (const id of await subscriberDirs()) {
    const d = await readYamlFile(subscriberFile(id));
    if (d && d.payment_id === paymentId) return coerce(d);
  }
  return null;
}

export interface CreateGuidedInput {
  display_name: string;
  email: string;
  phone: string;
  protocol_slug: string;
  dietary_preference?: GuidedSubscriber["dietary_preference"];
  payment_id: string;
  amount_paisa: number;
  source: "web" | "play";
  timezone?: string;
}

/** Create (or return the existing) subscriber for this payment. Idempotent on
 *  payment_id — a redelivered webhook never creates twice. */
export async function createGuidedSubscriber(
  input: CreateGuidedInput,
  now: Date = new Date(),
): Promise<{ subscriber: GuidedSubscriber; created: boolean }> {
  const existing = await findGuidedByPaymentId(input.payment_id);
  if (existing) return { subscriber: existing, created: false };

  const tz = input.timezone || "Asia/Kolkata";
  const iso = now.toISOString();
  const sub: GuidedSubscriber = {
    subscriber_id: newSubscriberId(),
    display_name: input.display_name.slice(0, 120),
    email: input.email.slice(0, 200).toLowerCase(),
    phone: input.phone.slice(0, 20),
    app_token: newGuidedToken(),
    protocol_slug: input.protocol_slug,
    dietary_preference: input.dietary_preference ?? "",
    extra_protocols: [],
    start_date: nextMondayYmd(now, tz),
    payment_id: input.payment_id,
    amount_paisa: input.amount_paisa,
    source: input.source,
    status: "active",
    timezone: tz,
    purchased_at: iso,
    created_at: iso,
    updated_at: iso,
    version: 1,
  };
  const dir = path.dirname(subscriberFile(sub.subscriber_id));
  await withFsRetry(() => fs.mkdir(dir, { recursive: true }));
  await withFsRetry(() => fs.writeFile(subscriberFile(sub.subscriber_id), dumpYaml(sub), "utf8"));
  return { subscriber: sub, created: true };
}

/** Active subscriber with this email, if any (adoption lookup at client
 *  onboarding — the guided→1:1 upgrade path). */
export async function findActiveGuidedByEmail(email: string): Promise<GuidedSubscriber | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  for (const id of await subscriberDirs()) {
    const d = await readYamlFile(subscriberFile(id));
    if (!d) continue;
    const s = coerce(d);
    if (s && s.status === "active" && s.email === needle) return s;
  }
  return null;
}

/** Mark a subscriber upgraded to a client. Their token now lives on the
 *  client record (client resolution runs first), and the guided branch stops
 *  resolving it (status filter) — one identity, no seam. */
export async function markGuidedUpgraded(subscriberId: string, clientId: string): Promise<void> {
  const f = subscriberFile(subscriberId);
  const d = await readYamlFile(f);
  if (!d) throw new Error(`guided subscriber not found: ${subscriberId}`);
  d.status = "upgraded";
  d.upgraded_to = clientId;
  d.updated_at = new Date().toISOString();
  d.version = (typeof d.version === "number" ? d.version : 1) + 1;
  await withFsRetry(() => fs.writeFile(f, dumpYaml(d), "utf8"));
}

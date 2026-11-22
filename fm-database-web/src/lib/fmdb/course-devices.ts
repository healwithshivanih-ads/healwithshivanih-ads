/**
 * A course link works on at most two phones (Shivani, 22 Nov 2026: "how do
 * we manage that they may simply forward the link to a friend?").
 *
 * - The first two devices that open the link are remembered: each gets a
 *   long-lived random cookie, and only its SHA-256 is stored here.
 * - A third device sees "already open on 2 phones" and can ask for a 6-digit
 *   code, sent ONLY to the email the course was bought with (never to an
 *   address typed on that screen). The right code adds this phone and drops
 *   the one used least recently.
 * - Codes last 15 minutes and allow 5 tries; one send per minute, 5 a day.
 *
 *     <plansRoot>/guided/<subscriberId>/_course_devices.json   ← written by Fly only
 *
 * Course buyers only (paid or gift). Programme clients are untouched: their
 * app_token works on any number of their own devices, as before.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { guidedRoot } from "./guided-tier";
import { withFsRetry } from "./fs-retry";

export const COURSE_DEVICE_COOKIE = "ochre_course_device";
export const CODE_TTL_MS = 15 * 60_000;
export const CODE_MAX_TRIES = 5;
export const CODE_RESEND_GAP_MS = 60_000;
export const CODE_MAX_SENDS_PER_DAY = 5;

/**
 * The limit runs where buyers open the app: on Fly (FLY_INTAKE_ONLY). On the
 * Mac a coach preview of a buyer's link must neither use up one of their two
 * phones nor write this Fly-owned file, so it is off there — unless
 * COURSE_DEVICE_LIMIT=1 turns it on for local testing.
 */
export function courseDeviceLimitActive(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.FLY_INTAKE_ONLY || env.COURSE_DEVICE_LIMIT === "1";
}

export function maxCourseDevices(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.COURSE_MAX_DEVICES);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 2;
}

export interface StoredDevice {
  /** sha256 of the cookie value — the raw id never touches disk. */
  id: string;
  first_seen: string;
  last_seen: string;
}

interface DeviceDoc {
  devices: StoredDevice[];
  code?: { hash: string; expires_at: string; tries: number };
  /** ISO times of code sends, trimmed to the last 24 h. */
  sends?: string[];
}

function docFile(subscriberId: string): string {
  if (!/^gd-[a-f0-9]{6,20}$/.test(subscriberId)) throw new Error("bad subscriber id");
  return path.join(guidedRoot(), subscriberId, "_course_devices.json");
}

async function readDoc(subscriberId: string): Promise<DeviceDoc> {
  try {
    const d = JSON.parse(await fs.readFile(docFile(subscriberId), "utf8")) as DeviceDoc;
    return { devices: Array.isArray(d.devices) ? d.devices : [], code: d.code, sends: Array.isArray(d.sends) ? d.sends : [] };
  } catch {
    return { devices: [], sends: [] };
  }
}

async function writeDoc(subscriberId: string, doc: DeviceDoc): Promise<void> {
  const file = docFile(subscriberId);
  await withFsRetry(() => fs.mkdir(path.dirname(file), { recursive: true }));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await withFsRetry(() => fs.writeFile(tmp, JSON.stringify(doc, null, 1), "utf8"));
  await withFsRetry(() => fs.rename(tmp, file));
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function newDeviceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function validRawId(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && /^[a-f0-9]{32}$/.test(raw);
}

export type DeviceStatus = "known" | "claimable" | "full";

/** Is this device (its cookie value) one of the listener's phones? */
export async function courseDeviceStatus(
  subscriberId: string,
  rawId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<DeviceStatus> {
  const doc = await readDoc(subscriberId);
  if (validRawId(rawId) && doc.devices.some((d) => d.id === sha(rawId))) return "known";
  return doc.devices.length < maxCourseDevices(env) ? "claimable" : "full";
}

/** Bump last_seen (least-recently-used order). At most once an hour per device. */
export async function touchCourseDevice(subscriberId: string, rawId: string, now = new Date()): Promise<void> {
  if (!validRawId(rawId)) return;
  const doc = await readDoc(subscriberId);
  const d = doc.devices.find((x) => x.id === sha(rawId));
  if (!d || now.getTime() - Date.parse(d.last_seen) < 3_600_000) return;
  d.last_seen = now.toISOString();
  await writeDoc(subscriberId, doc);
}

/** Register this device while there is a free slot. Returns the cookie value
 *  to set, or null when the slots are full. An already-known id is kept. */
export async function claimCourseDevice(
  subscriberId: string,
  rawId: string | null | undefined,
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const doc = await readDoc(subscriberId);
  if (validRawId(rawId) && doc.devices.some((d) => d.id === sha(rawId))) return rawId;
  if (doc.devices.length >= maxCourseDevices(env)) return null;
  const id = validRawId(rawId) ? rawId : newDeviceId();
  const iso = now.toISOString();
  doc.devices.push({ id: sha(id), first_seen: iso, last_seen: iso });
  await writeDoc(subscriberId, doc);
  return id;
}

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "wait" | "limit" };

/** Make a fresh 6-digit code (replacing any earlier one). The caller emails it. */
export async function issueCourseCode(subscriberId: string, now = new Date()): Promise<IssueResult> {
  const doc = await readDoc(subscriberId);
  const dayAgo = now.getTime() - 86_400_000;
  const sends = (doc.sends ?? []).filter((t) => Date.parse(t) > dayAgo);
  const last = sends.length ? Date.parse(sends[sends.length - 1]) : 0;
  if (now.getTime() - last < CODE_RESEND_GAP_MS) return { ok: false, reason: "wait" };
  if (sends.length >= CODE_MAX_SENDS_PER_DAY) return { ok: false, reason: "limit" };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  doc.code = { hash: sha(`${subscriberId}:${code}`), expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(), tries: 0 };
  doc.sends = [...sends, now.toISOString()];
  await writeDoc(subscriberId, doc);
  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true; rawId: string }
  | { ok: false; reason: "none" | "expired" | "wrong" | "used_up"; triesLeft?: number };

/**
 * Check a code. Right → this device is added (keeping its cookie if it had a
 * valid one) and the least-recently-used device is dropped to stay within
 * the limit; the code is spent. Wrong → a try is spent; after 5 the code dies.
 */
export async function verifyCourseCode(
  subscriberId: string,
  code: string,
  rawId: string | null | undefined,
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<VerifyResult> {
  const doc = await readDoc(subscriberId);
  const c = doc.code;
  if (!c) return { ok: false, reason: "none" };
  if (Date.parse(c.expires_at) < now.getTime()) {
    delete doc.code;
    await writeDoc(subscriberId, doc);
    return { ok: false, reason: "expired" };
  }
  const want = Buffer.from(c.hash, "hex");
  const got = Buffer.from(sha(`${subscriberId}:${String(code).replace(/\D/g, "")}`), "hex");
  if (!crypto.timingSafeEqual(want, got)) {
    c.tries += 1;
    const left = CODE_MAX_TRIES - c.tries;
    if (left <= 0) delete doc.code;
    await writeDoc(subscriberId, doc);
    return left <= 0 ? { ok: false, reason: "used_up" } : { ok: false, reason: "wrong", triesLeft: left };
  }
  delete doc.code;
  const id = validRawId(rawId) ? rawId : newDeviceId();
  const iso = now.toISOString();
  const others = doc.devices.filter((d) => d.id !== sha(id)).sort((a, b) => a.last_seen.localeCompare(b.last_seen));
  const keep = others.slice(Math.max(0, others.length - (maxCourseDevices(env) - 1)));
  doc.devices = [...keep, { id: sha(id), first_seen: iso, last_seen: iso }];
  await writeDoc(subscriberId, doc);
  return { ok: true, rawId: id };
}

/** "priya.rao@gmail.com" → "p•••o@gmail.com" — enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "";
  return user.length <= 2 ? `${user[0]}•••@${domain}` : `${user[0]}•••${user[user.length - 1]}@${domain}`;
}

/** Read the device cookie from a raw Cookie header. */
export function deviceIdFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COURSE_DEVICE_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Cookie options: long-lived, never readable by page scripts. */
export function deviceCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: 400 * 86_400 };
}

/** The 6-digit code email: plain, transactional, from the ops mailbox. */
export async function sendCourseCodeEmail(to: string, firstName: string, courseTitle: string, code: string): Promise<boolean> {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass || !to) return false;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.default.createTransport({ service: "gmail", auth: { user, pass } });
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  await t.sendMail({
    from: `The Ochre Tree <${user}>`,
    to,
    subject: `Your ${courseTitle} code: ${code}`,
    text: [
      hi,
      "",
      `Your code to open ${courseTitle} on a new phone is ${code}. It works for 15 minutes.`,
      "",
      "Your oldest phone will be signed out, so the course stays on two phones at most.",
      "",
      "If you didn't ask for this, you can ignore this email: nothing changes until the code is entered.",
      "",
      "The Ochre Tree",
    ].join("\n"),
  });
  return true;
}

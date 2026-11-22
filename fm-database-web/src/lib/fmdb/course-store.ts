/**
 * Course listener data, saved on the server so a new phone keeps the history.
 *
 *     <plansRoot>/guided/<subscriberId>/course-<slug>.json   ← written by Fly (the app)
 *     <plansRoot>/guided/<subscriberId>/_course_fired.json   ← written by the Mac (reminder cron)
 *     <plansRoot>/clients/<clientId>/course-<slug>.json       ← a programme client given the
 *                                                               course in their own app (Fly)
 *
 * Two files, one writer each: the guided/ tree is Mutagen-synced both ways,
 * and two machines writing the same file is how a sync conflict starts.
 *
 * The data is the listener's own: the daily 30-second log, the 5-question
 * symptom score at weeks 0 / 6 / 12, which tracks they listened to, and the
 * reminder time they chose. No safety-screen answers are ever stored here
 * (those never leave the phone that took the screen).
 *
 * Token resolution is DELIBERATELY separate from resolveAppToken
 * (letter-token.ts). That one returns a client_id every /api/app-* route
 * writes under clients/<id>/; widening it to guided tokens would let a
 * "gd-…" id reach every package write path. Course routes call
 * resolveCourseToken and write only here.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { guidedRoot, resolveGuidedSubscriberByToken, type GuidedSubscriber } from "./guided-tier";
import { getPlansRoot } from "./paths";
import { clientCourseOwnerId, clientCourseStart } from "./client-courses";
import { withFsRetry } from "./fs-retry";
import {
  COURSE_SCORE_QUESTIONS,
  getCourse,
  type CourseDef,
  type CourseScoreId,
  type CourseVersion,
} from "./courses";

export type MealComfort = "poor" | "okay" | "good";
export type BowelMovement = "none" | "easy" | "hard" | "loose";
export type SleepQuality = "poor" | "okay" | "good";

export interface CourseDayLog {
  /** 0–10 */
  bloating?: number;
  meals?: MealComfort;
  bowel?: BowelMovement;
  /** 0–10 */
  stress?: number;
  sleep?: SleepQuality;
  /** Ticked by the app when ≥ 80% of any track played, or by hand. */
  listened?: boolean;
  /** "My triggers" — optional free text. */
  note?: string;
  updated_at?: string;
}

export interface CourseScore {
  date: string;
  /** The checkpoint week this answers (0, 6 or 12). */
  week: number;
  answers: Record<CourseScoreId, number>;
  /** 0–50, recomputed server-side. */
  total: number;
  at: string;
}

export interface CourseListen {
  date: string;
  track: string;
  version: CourseVersion;
  at: string;
}

export interface CourseReminderPrefs {
  /** "HH:MM" in the listener's timezone, or null = no daily reminder. */
  daily_time: string | null;
  /** Push when a new session opens. */
  unlock: boolean;
}

export interface CourseRecord {
  course: string;
  days: Record<string, CourseDayLog>;
  scores: CourseScore[];
  listens: CourseListen[];
  reminders: CourseReminderPrefs;
  updated_at: string;
}

const MAX_NOTE = 600;
const MAX_LISTENS = 2000;

export function emptyCourseRecord(slug: string): CourseRecord {
  return {
    course: slug,
    days: {},
    scores: [],
    listens: [],
    reminders: { daily_time: null, unlock: true },
    updated_at: "",
  };
}

/** Where an owner's course data lives. A buyer's id is their subscriber id
 *  (guided/<id>/); a programme client's is "client:<clientId>"
 *  (client-courses.ts), saved beside their other app data in clients/<id>/. */
export function ownerDir(ownerId: string): string {
  const m = /^client:([a-z0-9][a-z0-9-]{0,63})$/i.exec(ownerId);
  if (m) return path.join(getPlansRoot(), "clients", m[1]);
  if (ownerId.includes("/") || ownerId.includes("..") || ownerId.startsWith("client:")) {
    throw new Error("bad course owner id");
  }
  return path.join(guidedRoot(), ownerId);
}

function recordFile(subscriberId: string, slug: string): string {
  return path.join(ownerDir(subscriberId), `course-${slug}.json`);
}

export function firedFile(subscriberId: string): string {
  return path.join(guidedRoot(), subscriberId, "_course_fired.json");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, doc: unknown): Promise<void> {
  await withFsRetry(() => fs.mkdir(path.dirname(file), { recursive: true }));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await withFsRetry(() => fs.writeFile(tmp, JSON.stringify(doc, null, 1), "utf8"));
  await withFsRetry(() => fs.rename(tmp, file));
}

// ── validation ───────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

function int010(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Clean one day's log from untrusted input. Unknown keys are dropped. */
export function sanitizeDayLog(input: Record<string, unknown>): CourseDayLog {
  const out: CourseDayLog = {};
  const b = int010(input.bloating);
  if (b !== undefined) out.bloating = b;
  const m = oneOf(input.meals, ["poor", "okay", "good"] as const);
  if (m) out.meals = m;
  const bw = oneOf(input.bowel, ["none", "easy", "hard", "loose"] as const);
  if (bw) out.bowel = bw;
  const st = int010(input.stress);
  if (st !== undefined) out.stress = st;
  const sl = oneOf(input.sleep, ["poor", "okay", "good"] as const);
  if (sl) out.sleep = sl;
  if (typeof input.listened === "boolean") out.listened = input.listened;
  if (typeof input.note === "string") {
    // Strip control characters (keeps newline and tab) from free text.
    // eslint-disable-next-line no-control-regex -- matching control chars is the point
    const note = input.note.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, MAX_NOTE);
    out.note = note;
  }
  return out;
}

/** Five answers, each 0–10; null if any is missing. */
export function sanitizeScore(input: unknown): Record<CourseScoreId, number> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const out = {} as Record<CourseScoreId, number>;
  for (const q of COURSE_SCORE_QUESTIONS) {
    const v = int010(src[q.id]);
    if (v === undefined) return null;
    out[q.id] = v;
  }
  return out;
}

export function scoreTotal(a: Record<CourseScoreId, number>): number {
  return COURSE_SCORE_QUESTIONS.reduce((s, q) => s + (a[q.id] ?? 0), 0);
}

/** "HH:MM" (00:00–23:59) or null. */
export function sanitizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * The day a write belongs to. The app sends the phone's local date; accept it
 * when it is within a day of the server's idea of today in the listener's
 * timezone (travel, midnight edges), or up to 6 days back (catching up on the
 * week). Anything else → today, so a bad clock cannot scatter the history.
 */
export function acceptLogDate(sent: unknown, todayYmd: string): string {
  if (!isYmd(sent)) return todayYmd;
  const d = (Date.parse(`${sent}T00:00:00Z`) - Date.parse(`${todayYmd}T00:00:00Z`)) / 86_400_000;
  return d <= 1 && d >= -6 ? sent : todayYmd;
}

// ── token → listener ────────────────────────────────────────────────────────

/** Who is listening: a course buyer (their own link), or a programme client
 *  the coach gave the course to in their own app (client-courses.ts). */
export type CourseListener =
  | {
      kind: "buyer";
      sub: GuidedSubscriber;
      course: CourseDef;
      /** The record owner id (course-store paths). */
      ownerId: string;
      startYmd: string;
      tz: string;
    }
  | {
      kind: "client";
      clientId: string;
      course: CourseDef;
      ownerId: string;
      startYmd: string;
      tz: string;
    };

/** Token → an ACTIVE subscriber who owns `slug`, or a client whose record
 *  has the course switched on. Null otherwise.
 *
 *  The client path reads client.yaml directly, by app_token only, and hands
 *  back an owner id that writes ONLY to clients/<id>/course-<slug>.json. It
 *  is not resolveAppToken: nothing here widens what an /api/app-* route may
 *  write. */
export async function resolveCourseToken(token: string, slug = "calm-gut"): Promise<CourseListener | null> {
  if (!token || token.length < 16) return null;
  const course = getCourse(slug);
  if (!course) return null;
  const sub = await resolveGuidedSubscriberByToken(token);
  if (sub) {
    if (sub.status !== "active") return null;
    if (!sub.courses.includes(slug)) return null;
    return { kind: "buyer", sub, course, ownerId: sub.subscriber_id, startYmd: sub.start_date, tz: sub.timezone };
  }
  const client = await findClientByAppToken(token);
  if (!client) return null;
  const startYmd = clientCourseStart(client.doc, slug);
  if (!startYmd) return null;
  const tz = typeof client.doc.timezone === "string" && client.doc.timezone ? client.doc.timezone : "Asia/Kolkata";
  return { kind: "client", clientId: client.id, course, ownerId: clientCourseOwnerId(client.id), startYmd, tz };
}

/** client.yaml whose app_token is `token` (clients/ only, never prospects). */
async function findClientByAppToken(token: string): Promise<{ id: string; doc: Record<string, unknown> } | null> {
  const dir = path.join(getPlansRoot(), "clients");
  let ids: string[];
  try {
    ids = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const id of ids) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, id, "client.yaml"), "utf-8");
    } catch {
      continue;
    }
    // Cheap pre-check before parsing every client's YAML.
    if (!raw.includes(token)) continue;
    try {
      const doc = yaml.load(raw) as Record<string, unknown> | null;
      if (doc && doc.app_token === token) return { id, doc };
    } catch {
      /* unreadable record: not this one */
    }
  }
  return null;
}

// ── read / write ────────────────────────────────────────────────────────────

export async function readCourseRecord(subscriberId: string, slug: string): Promise<CourseRecord> {
  const d = await readJson<Partial<CourseRecord>>(recordFile(subscriberId, slug));
  const base = emptyCourseRecord(slug);
  if (!d || typeof d !== "object") return base;
  return {
    course: slug,
    days: d.days && typeof d.days === "object" ? d.days : {},
    scores: Array.isArray(d.scores) ? d.scores : [],
    listens: Array.isArray(d.listens) ? d.listens : [],
    reminders: {
      daily_time: sanitizeTime(d.reminders?.daily_time),
      unlock: d.reminders?.unlock !== false,
    },
    updated_at: typeof d.updated_at === "string" ? d.updated_at : "",
  };
}

/** Read-modify-write. Single listener per file, low write rate; the atomic
 *  rename keeps a half-written file from ever being read. */
export async function updateCourseRecord(
  subscriberId: string,
  slug: string,
  fn: (r: CourseRecord) => void,
): Promise<CourseRecord> {
  const r = await readCourseRecord(subscriberId, slug);
  fn(r);
  r.updated_at = new Date().toISOString();
  if (r.listens.length > MAX_LISTENS) r.listens = r.listens.slice(-MAX_LISTENS);
  await writeJsonAtomic(recordFile(subscriberId, slug), r);
  return r;
}

/** Merge one day's log (fields not sent are kept). */
export async function saveDayLog(
  subscriberId: string,
  slug: string,
  date: string,
  log: CourseDayLog,
): Promise<CourseRecord> {
  return updateCourseRecord(subscriberId, slug, (r) => {
    r.days[date] = { ...(r.days[date] ?? {}), ...log, updated_at: new Date().toISOString() };
  });
}

/** A track played to ≥ 80%: record the listen and tick "I listened today". */
export async function saveListen(
  subscriberId: string,
  slug: string,
  date: string,
  track: string,
  version: CourseVersion,
): Promise<CourseRecord> {
  return updateCourseRecord(subscriberId, slug, (r) => {
    const at = new Date().toISOString();
    r.listens.push({ date, track, version, at });
    r.days[date] = { ...(r.days[date] ?? {}), listened: true, updated_at: at };
  });
}

/** One score per checkpoint: a retake in the same checkpoint replaces it. */
export async function saveScore(
  subscriberId: string,
  slug: string,
  date: string,
  week: number,
  answers: Record<CourseScoreId, number>,
): Promise<CourseRecord> {
  return updateCourseRecord(subscriberId, slug, (r) => {
    const s: CourseScore = { date, week, answers, total: scoreTotal(answers), at: new Date().toISOString() };
    r.scores = [...r.scores.filter((x) => x.week !== week), s].sort((a, b) => a.date.localeCompare(b.date));
  });
}

export async function saveReminderPrefs(
  subscriberId: string,
  slug: string,
  prefs: CourseReminderPrefs,
): Promise<CourseRecord> {
  return updateCourseRecord(subscriberId, slug, (r) => {
    r.reminders = prefs;
  });
}

/** Consecutive listening days ending today (or yesterday — a grace day, the
 *  same rule as the app's logging streak). */
export function listeningStreak(days: Record<string, CourseDayLog>, todayYmd: string): number {
  const listened = new Set(Object.entries(days).filter(([, d]) => d.listened).map(([k]) => k));
  let t = Date.parse(`${todayYmd}T00:00:00Z`);
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (!listened.has(ymd(t))) t -= 86_400_000;
  let n = 0;
  while (listened.has(ymd(t))) {
    n++;
    t -= 86_400_000;
  }
  return n;
}

// ── reminder fired-state (Mac-written) ──────────────────────────────────────

export async function readCourseFired(subscriberId: string): Promise<Record<string, string>> {
  const d = await readJson<Record<string, string>>(firedFile(subscriberId));
  return d && typeof d === "object" ? d : {};
}

export async function writeCourseFired(subscriberId: string, fired: Record<string, string>): Promise<void> {
  await writeJsonAtomic(firedFile(subscriberId), fired);
}

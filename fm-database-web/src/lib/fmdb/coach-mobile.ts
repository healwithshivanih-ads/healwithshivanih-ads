/**
 * Reader for the coach mobile read-model written by coach-staging-action.py.
 *
 * /m NEVER reads the authoritative ~/fm-plans tree directly. It reads this
 * projection, for two reasons:
 *   1. On Fly the authoritative tree isn't there — that's the whole point of
 *      the projection (the app has to work while the Mac is asleep).
 *   2. The projection is the enforcement point for what leaves the Mac. If a
 *      page could reach past it into client.yaml, the allowlist would be
 *      decorative.
 *
 * Shapes here MIRROR the Python writer. If you add a field there, add it here;
 * the reader is deliberately tolerant (everything optional) so a projection
 * written by an older script version still renders instead of throwing.
 */
import fs from "node:fs";
import path from "node:path";

/** Compact row for the Clients tab. */
export type CoachIndexRow = {
  id: string;
  kind: "client" | "prospect";
  name: string;
  mobile?: string | null;
  email?: string | null;
  engagement_status?: string | null;
  next_contact_date?: string | null;
  last_session?: string | null;
  plan_status?: string | null;
  conditions?: string[];
  /** Count of recent inbound WhatsApp messages — NOT an unread count. */
  recent_whatsapp?: number;
  /** Token for /app/<token> — the client's own companion app. */
  app_token?: string | null;
};

export type CoachSession = {
  id: string;
  date?: string | null;
  kind: string;
  complaints: string;
  coach_notes: string;
  symptoms?: string[];
  requested_labs?: string[];
  five_pillars?: Record<string, unknown> | null;
};

export type CoachCard = {
  id: string;
  kind: "client" | "prospect";
  glance: Record<string, unknown>;
  plan: {
    slug?: string;
    status?: string;
    period_start?: string | null;
    period_weeks?: number | null;
    meal_plan_started_on?: string | null;
    supplement_count?: number;
    practice_count?: number;
    letter_token?: string | null;
  } | null;
  sessions: CoachSession[];
  whatsapp: { count: number; messages: { at?: string | null; text: string }[] };
  staged_at?: string;
};

/** Ids are filesystem path segments — anything outside this charset is
 *  refused rather than sanitised, so a traversal attempt is a miss, not a
 *  silently-rewritten read. Mirrors the guard on somatic practice slugs. */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function coachDir(): string | null {
  const env = process.env.FMDB_COACH_DIR;
  return env && env.length > 0 ? path.resolve(env) : null;
}

/** True when the projection exists on this host. The UI uses this to explain
 *  itself ("not configured") rather than rendering an empty client list, which
 *  would read as "you have no clients". */
export function coachProjectionReady(): boolean {
  const dir = coachDir();
  return !!dir && fs.existsSync(path.join(dir, "index.json"));
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Clients and prospects, as types that cannot be mistaken for each other.
 *
 * There used to be one `loadCoachIndex(): CoachIndexRow[]` returning both,
 * which meant every consumer had to remember to check `kind`. Two screens
 * written in one week did not: the contacts list showed 16 clients and 5
 * prospects in a single A–Z run, and the meal queue would have put a photo
 * from someone who never signed up into a queue about plan adherence.
 *
 * Narrowing `kind` in the type is what stops that recurring. A ProspectRow is
 * not assignable where a ClientRow is expected, so the next surface gets a
 * compile error instead of shipping the same bug — the id cannot carry this
 * (see docs/CLIENT_VS_PROSPECT_SPEC.md; ids are embedded in 32 plan filenames
 * and must stay opaque), so the type does.
 */
export type ClientRow = CoachIndexRow & { kind: "client" };
export type ProspectRow = CoachIndexRow & { kind: "prospect" };

function readIndex(): CoachIndexRow[] {
  const dir = coachDir();
  if (!dir) return [];
  return readJson<CoachIndexRow[]>(path.join(dir, "index.json")) ?? [];
}

/** Split a mixed index. Pure, so the guarantee is testable without a disk. */
export function splitByKind(rows: CoachIndexRow[]): {
  clients: ClientRow[];
  prospects: ProspectRow[];
} {
  const clients: ClientRow[] = [];
  const prospects: ProspectRow[] = [];
  for (const r of rows) {
    // Anything not explicitly a prospect is treated as a client, matching the
    // projection's own default — but a row must SAY prospect to be one, so a
    // missing kind can never quietly hide someone from the roster.
    if (r.kind === "prospect") prospects.push(r as ProspectRow);
    else clients.push({ ...r, kind: "client" });
  }
  return { clients, prospects };
}

/** People who signed up. The default for anything about care. */
export function loadClients(): ClientRow[] {
  return splitByKind(readIndex()).clients;
}

/** People who have not signed up — still worth calling, never clients. */
export function loadProspects(): ProspectRow[] {
  return splitByKind(readIndex()).prospects;
}

/** Both, when a surface genuinely wants both — and has to say so. */
export function loadEveryone(): { clients: ClientRow[]; prospects: ProspectRow[] } {
  return splitByKind(readIndex());
}

export function loadCoachCard(id: string): CoachCard | null {
  const dir = coachDir();
  if (!dir || !SAFE_ID.test(id)) return null;
  const file = path.join(dir, `${id}.json`);
  // Defence in depth: even with a safe-looking id, refuse anything that
  // resolved outside the projection directory.
  if (path.dirname(path.resolve(file)) !== dir) return null;
  return readJson<CoachCard>(file);
}

/** When the projection was last rebuilt — surfaced in the app so a stale copy
 *  (Mac asleep) is visible rather than silently out of date. */
export function coachProjectionStagedAt(): string | null {
  // "Is there a projection at all", not "who is in it" — the raw read is
  // right here; splitting would imply a population this cares about.
  const rows = readIndex();
  if (!rows.length) return null;
  const dir = coachDir();
  if (!dir) return null;
  try {
    return fs.statSync(path.join(dir, "index.json")).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Absolute URL of the client's OWN app — what they see on their phone.
 *
 * Absolute, and built from NEXT_PUBLIC_APP_URL rather than the current
 * request, on purpose: opening the Mac's copy would show a different render of
 * the data than the client actually has in front of them, which defeats the
 * point of looking. Returns null when there is no token or no configured
 * origin, so the caller can omit the control rather than render a dead one.
 */
export function clientAppUrl(token?: string | null): string | null {
  if (!token) return null;
  const origin = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "")
    .trim()
    .replace(/\/$/, "");
  if (!origin) return null;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return null;
  return `${origin}/app/${token}`;
}

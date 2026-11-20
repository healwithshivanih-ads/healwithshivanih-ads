/**
 * WhatsApp messages from numbers that are not on the roster.
 *
 * `/api/whatsapp-webhook` matches every inbound sender against `clients/` and
 * `prospects/`. Anyone else is appended to `~/fm-plans/_whatsapp_unmatched.yaml`
 * "for coach review" — and until Nov 2026 nothing read that file, so a message
 * from a stranger (a body age report buyer tapping the WhatsApp link in the
 * PDF, say) was visible only in the WhatsApp server's own admin Inbox.
 *
 * This module is the reader. It is READ-ONLY towards the sender: it lists the
 * messages and remembers which ones the coach has seen. It never sends,
 * replies or alerts anyone (the coach does not chase people — contact-gate.ts).
 *
 * Two files, on purpose:
 *   - `_whatsapp_unmatched.yaml`       written by the webhook only (append).
 *   - `_whatsapp_unmatched_seen.yaml`  written here only: `{ <message id>: <ISO seen at> }`.
 * Keeping "seen" out of the webhook's file means a mark-seen click can never
 * race an arriving message and lose it.
 *
 * A message's id is a hash of what the webhook wrote (phone + received_at +
 * text), so it is stable across reads and rebuilds without the webhook having
 * to mint one. "Seen" is keyed on that id, never on a timestamp comparison:
 * `received_at` is an en-IN display string ("18/11/2026, 8:17:05 am"), fine to
 * show, too fragile to gate an unread count on.
 */
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { withFsRetry } from "./fs-retry";
import { dumpYaml } from "./yaml-dump";

export const UNMATCHED_FILE_NAME = "_whatsapp_unmatched.yaml";
export const UNMATCHED_SEEN_FILE_NAME = "_whatsapp_unmatched_seen.yaml";

/** An unseen message counts as unread for this many days, then drops off the
 *  count on its own (it stays in the list). Same window as /messages. Without
 *  it, the backlog from before this page existed would sit on the dashboard
 *  forever — no item without an exit. */
export const UNMATCHED_UNREAD_DAYS = 30;

export interface UnmatchedMessage {
  /** Stable id: `m` + 16 hex chars. */
  id: string;
  /** The number as the webhook stored it (digits, country code first). */
  phone: string;
  /** Last 10 digits — the same key `findClientByPhoneAction` matches on. */
  phoneKey: string;
  /** WhatsApp profile name, when the sender has one. */
  name: string | null;
  /** YYYY-MM-DD the webhook wrote the row ("" when missing). */
  date: string;
  /** When it arrived, as the webhook stored it (IST display string). */
  receivedAt: string;
  /** Message text, at most 500 chars (the webhook trims). "" for a bare photo / voice note. */
  text: string;
  seenAt: string | null;
  /** Not seen AND written within UNMATCHED_UNREAD_DAYS. */
  isUnread: boolean;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** YYYY-MM-DD out of whatever YAML handed back (string, or a Date when the
 *  value was written unquoted). "" when it is not a date. */
function asYmd(v: unknown): string {
  const s = asText(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : "";
}

export function unmatchedMessageId(phone: string, receivedAt: string, text: string): string {
  return "m" + createHash("sha1").update(`${phone}\n${receivedAt}\n${text}`).digest("hex").slice(0, 16);
}

export function phoneKeyOf(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Pure: the webhook file's text + the seen map → the list, NEWEST FIRST.
 *
 * The webhook only ever appends, so file order is arrival order and "newest
 * first" is simply the file reversed — no date parsing involved. Tolerant by
 * design: an empty file, a non-list, or a row that is not a mapping yields no
 * rows rather than an error, and a row with neither a number nor any text is
 * dropped (nothing to show).
 */
export function parseUnmatched(
  rawYaml: string,
  seen: Record<string, string>,
  todayYmd: string,
): UnmatchedMessage[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(rawYaml);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: UnmatchedMessage[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const phone = asText(r.phone).trim();
    const text = asText(r.text).trim();
    if (!phone && !text) continue;
    const receivedAt = asText(r.received_at).trim();
    const date = asYmd(r.date);
    const id = unmatchedMessageId(phone, receivedAt, text);
    const seenAt = seen[id] ?? null;
    const name = asText(r.name).trim();
    out.push({
      id,
      phone,
      phoneKey: phoneKeyOf(phone),
      name: name || null,
      date,
      receivedAt,
      text,
      seenAt,
      isUnread: !seenAt && date !== "" && daysBetween(date, todayYmd) <= UNMATCHED_UNREAD_DAYS,
    });
  }
  return out.reverse();
}

export function countUnread(messages: UnmatchedMessage[]): number {
  return messages.filter((m) => m.isUnread).length;
}

// ── files ────────────────────────────────────────────────────────────────────

async function readSeen(): Promise<Record<string, string>> {
  try {
    const raw = await withFsRetry(() => fs.readFile(path.join(getPlansRoot(), UNMATCHED_SEEN_FILE_NAME), "utf-8"));
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const s = asText(v);
      if (s) out[k] = s;
    }
    return out;
  } catch {
    return {}; // no file yet, or unreadable → nothing seen
  }
}

/** Every unmatched message, newest first. A missing or empty file is an empty
 *  list — never an error (the dashboard must not fall over on it). */
export async function loadUnmatchedMessages(now: Date = new Date()): Promise<UnmatchedMessage[]> {
  let raw: string;
  try {
    raw = await withFsRetry(() => fs.readFile(path.join(getPlansRoot(), UNMATCHED_FILE_NAME), "utf-8"));
  } catch {
    return [];
  }
  return parseUnmatched(raw, await readSeen(), now.toISOString().slice(0, 10));
}

/**
 * Mark messages as seen. `ids` must be ids that exist in the webhook file
 * right now — anything else is ignored, so the seen file cannot be stuffed
 * with junk. Returns how many were newly marked.
 */
export async function markUnmatchedSeen(ids: string[], now: Date = new Date()): Promise<number> {
  const known = new Set((await loadUnmatchedMessages(now)).map((m) => m.id));
  const seen = await readSeen();
  let added = 0;
  for (const id of ids) {
    if (!known.has(id) || seen[id]) continue;
    seen[id] = now.toISOString();
    added += 1;
  }
  if (added === 0) return 0;
  // Forget ids whose message is no longer in the webhook file, so this file
  // cannot outgrow the one it describes.
  for (const id of Object.keys(seen)) if (!known.has(id)) delete seen[id];
  const root = getPlansRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, UNMATCHED_SEEN_FILE_NAME), dumpYaml(seen, { sortKeys: true }), "utf-8");
  return added;
}

/** Mark every message from one number as seen (one click per person, not one
 *  per message). `phoneKey` is the last-10-digits key on each row. */
export async function markUnmatchedSenderSeen(phoneKey: string, now: Date = new Date()): Promise<number> {
  if (!phoneKey) return 0;
  const mine = (await loadUnmatchedMessages(now)).filter((m) => m.phoneKey === phoneKey && !m.seenAt);
  return markUnmatchedSeen(mine.map((m) => m.id), now);
}

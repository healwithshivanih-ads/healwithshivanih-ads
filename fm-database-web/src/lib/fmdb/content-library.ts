/**
 * The content library: which video or guide to send someone, given what they
 * care about. Data lives in fm-database/data/_content_library.yaml; the rules
 * for that file are in its header.
 *
 * The one guarantee this module exists for: a link reaches a person ONLY if it
 * is in the library and its `live_from` day has passed. Scheduled YouTube
 * videos are private until they premiere, so sending one early sends a dead
 * link. `unknownLinks` is the matching check at send time.
 *
 * Pure: no I/O. The loader is content-library-store.ts.
 */

import { isConcernId, type ConcernId } from "./concerns";

export type ContentKind = "video" | "guide";
export type ContentStage = "first" | "deeper";

export interface ContentItem {
  id: string;
  kind: ContentKind;
  title: string;
  url: string;
  concerns: ConcernId[];
  /** YYYY-MM-DD the item became public. */
  liveFrom: string;
  /** YYYY-MM-DD after which a seasonal item is no longer sent. */
  until: string | null;
  stage: ContentStage;
  /** One client-facing sentence. */
  line: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The liveFrom of anything not (yet) confirmed live. isLive is false for it. */
export const NEVER = "9999-12-31";

function ymd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && YMD.test(v.trim())) return v.trim();
  return null;
}

/**
 * Parse the YAML document. An entry missing anything a send depends on (an
 * https URL, a live date, a known concern, a line) is DROPPED, with the reason
 * returned so the test can fail on it — an incomplete item must never be
 * picked.
 */
export function parseContentLibrary(raw: unknown): { items: ContentItem[]; problems: string[] } {
  const items: ContentItem[] = [];
  const problems: string[] = [];
  const list = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : null;
  if (!Array.isArray(list)) return { items, problems: ["no `items` list"] };
  const ids = new Set<string>();
  for (const r of list) {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const where = id || JSON.stringify(o).slice(0, 40);
    if (!id) { problems.push(`${where}: no id`); continue; }
    if (ids.has(id)) { problems.push(`${id}: duplicate id`); continue; }
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!/^https:\/\/\S+$/.test(url)) { problems.push(`${id}: url must be https`); continue; }
    // Videos carry NO date: YouTube says when they went public (content-status).
    // Guides may carry the day they became available, used only to tell "new"
    // from "old". Without a date an item stays unresolved — never live — until
    // resolveLiveness gives it one.
    const kindRaw = o.kind === "guide" ? "guide" : "video";
    const liveFrom = ymd(o.live_from) ?? NEVER;
    if (kindRaw === "guide" && liveFrom === NEVER) { problems.push(`${id}: a guide needs live_from`); continue; }
    const rawConcerns = Array.isArray(o.concerns) ? o.concerns : [];
    const bad = rawConcerns.filter((c) => !isConcernId(c));
    if (bad.length) { problems.push(`${id}: unknown concern ${bad.join(", ")}`); continue; }
    const concerns = rawConcerns as ConcernId[];
    if (!concerns.length) { problems.push(`${id}: no concerns`); continue; }
    const line = typeof o.line === "string" ? o.line.trim() : "";
    if (!line) { problems.push(`${id}: no line`); continue; }
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) { problems.push(`${id}: no title`); continue; }
    const kind: ContentKind = kindRaw;
    const stage: ContentStage = o.stage === "deeper" ? "deeper" : "first";
    ids.add(id);
    items.push({ id, kind, title, url, concerns, liveFrom, until: ymd(o.until), stage, line });
  }
  return { items, problems };
}

/** Public today and not yet retired. */
export function isLive(item: ContentItem, today: string): boolean {
  return item.liveFrom <= today && (item.until === null || today <= item.until);
}

export interface PickInput {
  /** Their concerns, most relevant first (activeConcerns order). */
  concerns: readonly ConcernId[];
  today: string;
  /** Item ids already sent to this person. Never repeated. */
  sentIds: readonly string[];
  /** `first` → prefer first-touch items; `deeper` → prefer deeper ones. */
  prefer: ContentStage;
}

/**
 * The single best item for this person today, or null.
 *
 * Order: their first concern before their second; within a concern, the
 * preferred stage first, then videos before guides (a video needs no sign-up),
 * then the newest. Deterministic, so the panel's "would send next" and the
 * draft always agree.
 */
export function pickContent(items: readonly ContentItem[], input: PickInput): ContentItem | null {
  const sent = new Set(input.sentIds);
  for (const concern of input.concerns) {
    const pool = items.filter((i) => i.concerns.includes(concern) && isLive(i, input.today) && !sent.has(i.id));
    if (!pool.length) continue;
    pool.sort((a, b) => {
      const sa = a.stage === input.prefer ? 0 : 1;
      const sb = b.stage === input.prefer ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ka = a.kind === "video" ? 0 : 1;
      const kb = b.kind === "video" ? 0 : 1;
      if (ka !== kb) return ka - kb;
      if (a.liveFrom !== b.liveFrom) return b.liveFrom.localeCompare(a.liveFrom);
      return a.id.localeCompare(b.id);
    });
    return pool[0];
  }
  return null;
}

/**
 * Items that went live in the last `withinDays` days and match one of their
 * concerns — what a "thought of you" note is about. Newest first.
 */
export function newlyLiveFor(
  items: readonly ContentItem[],
  concerns: readonly ConcernId[],
  today: string,
  withinDays: number,
  sentIds: readonly string[],
): ContentItem[] {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - withinDays);
  const fromYmd = from.toISOString().slice(0, 10);
  const sent = new Set(sentIds);
  const want = new Set(concerns);
  return items
    .filter((i) => isLive(i, today) && i.liveFrom >= fromYmd && !sent.has(i.id) && i.concerns.some((c) => want.has(c)))
    .sort((a, b) => b.liveFrom.localeCompare(a.liveFrom) || a.id.localeCompare(b.id));
}

/** The paragraph a follow-up email carries for one item. */
export function contentParagraph(item: ContentItem, lead: string): string {
  return `${lead} ${item.line}\n${item.url}`;
}

const URL_RE = /https?:\/\/[^\s)<>"']+/g;

/**
 * Every URL in a piece of text that is neither a LIVE library item nor under
 * one of the allowed prefixes (e.g. the client's own app link). The send gate
 * refuses an email when this is non-empty.
 */
export function unknownLinks(
  text: string,
  items: readonly ContentItem[],
  today: string,
  allowedPrefixes: readonly string[] = [],
): string[] {
  const live = new Set(items.filter((i) => isLive(i, today)).map((i) => i.url));
  const found = text.match(URL_RE) ?? [];
  return found
    .map((u) => u.replace(/[.,;:!?]+$/, ""))
    .filter((u) => !live.has(u) && !allowedPrefixes.some((p) => p && u.startsWith(p)));
}

// ── liveness from the content-status job ───────────────────────────────────

export interface VideoStatus {
  state: string;
  /** YYYY-MM-DD YouTube made it public. */
  published_on?: string | null;
  /** ISO instant of the last successful check. */
  checked_at: string;
}

export interface GuideStatus {
  ok: boolean;
  checked_at: string;
  /** YYYY-MM-DD the page first answered 200. */
  first_ok_on?: string | null;
}

export interface ContentStatus {
  videos?: Record<string, VideoStatus>;
  guides?: Record<string, GuideStatus>;
  /** Long videos found on the channel that are not in the curated file. */
  auto_items?: unknown[];
}

function freshWithin(iso: string | undefined, today: string, maxDays: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.parse(`${today}T23:59:59Z`) - t <= maxDays * 864e5;
}

/**
 * Give every item the liveFrom the WORLD says it has, not what a file says:
 *
 *   - a video is live only when YouTube's latest answer (≤ maxDays old) is
 *     "public"; its liveFrom is YouTube's own publish date;
 *   - a guide is live only when its page last answered 200 (≤ maxDays old);
 *     its liveFrom stays the file's "available since" date;
 *   - no answer, a stale answer, private, unlisted or upcoming → NEVER.
 *
 * Fails closed: if the job stops running, nothing is sent rather than
 * something dead.
 */
export function resolveLiveness(
  items: readonly ContentItem[],
  status: ContentStatus | null,
  today: string,
  maxDays: number,
  videoIdOf: (url: string) => string | null,
): ContentItem[] {
  return items.map((i) => {
    if (i.kind === "video") {
      const vid = videoIdOf(i.url);
      const s = vid ? status?.videos?.[vid] : undefined;
      const live = s && s.state === "public" && freshWithin(s.checked_at, today, maxDays);
      return { ...i, liveFrom: live ? (s.published_on ?? today) : NEVER };
    }
    const g = status?.guides?.[i.url];
    const live = g && g.ok && freshWithin(g.checked_at, today, maxDays);
    return { ...i, liveFrom: live ? (i.liveFrom !== NEVER ? i.liveFrom : (g.first_ok_on ?? today)) : NEVER };
  });
}

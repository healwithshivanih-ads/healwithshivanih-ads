/**
 * Interest signals on a person's record — what they have shown they care about,
 * where we learned it, and when.
 *
 * Stored at client.yaml#interests (Python: `Client.interests`, a list of
 * `InterestSignal`). APPEND-ONLY with a tombstone: when the coach removes a
 * concern it is marked `dismissed`, not deleted, so a later backfill or
 * re-classification cannot quietly put it back.
 *
 * Pure: no I/O. The read/write half is interests-store.ts.
 */

import { classifyConcerns, isConcernId, type ConcernId } from "./concerns";

export interface InterestSignal {
  concern: ConcernId;
  /** Where it came from: booking_form | discovery_call | coach | lead_source:<x> … */
  source: string;
  /** YYYY-MM-DD we learned it. */
  at: string;
  /** Their own words, when there were any. Coach-facing. */
  detail?: string;
  /** The coach took this concern off. Kept so nothing re-adds it. */
  dismissed?: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DETAIL_MAX = 200;

function asYmd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && YMD.test(v.trim().slice(0, 10))) return v.trim().slice(0, 10);
  return null;
}

/**
 * Read `interests` off a record leniently. Python dumps `at` as an unquoted
 * date, which js-yaml loads as a Date — both shapes are accepted. Entries with
 * an unknown concern id or no date are dropped rather than crashing a panel.
 */
export function parseInterests(raw: unknown): InterestSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: InterestSignal[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (!isConcernId(o.concern)) continue;
    const at = asYmd(o.at);
    if (!at) continue;
    const sig: InterestSignal = {
      concern: o.concern,
      source: typeof o.source === "string" && o.source.trim() ? o.source.trim() : "unknown",
      at,
    };
    if (typeof o.detail === "string" && o.detail.trim()) sig.detail = o.detail.trim();
    if (o.dismissed === true) sig.dismissed = true;
    out.push(sig);
  }
  return out;
}

function key(s: Pick<InterestSignal, "concern" | "source" | "detail">): string {
  return `${s.concern}|${s.source}|${(s.detail ?? "").toLowerCase()}`;
}

/**
 * Add new signals to existing ones. A signal identical in concern + source +
 * detail is not added twice, and a concern the coach DISMISSED is never
 * re-added from any automatic source (only `coach` may bring it back).
 */
export function mergeInterests(
  existing: readonly InterestSignal[],
  incoming: readonly InterestSignal[],
): { merged: InterestSignal[]; added: InterestSignal[] } {
  const merged = existing.map((s) => ({ ...s }));
  const seen = new Set(merged.map(key));
  const added: InterestSignal[] = [];
  for (const s of incoming) {
    const dismissed = merged.some((m) => m.concern === s.concern && m.dismissed);
    if (dismissed && s.source !== "coach") continue;
    if (s.source === "coach" && dismissed) {
      // The coach re-adding a concern lifts the tombstone.
      for (const m of merged) if (m.concern === s.concern) delete m.dismissed;
    }
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    const clean: InterestSignal = { concern: s.concern, source: s.source, at: s.at };
    if (s.detail) clean.detail = s.detail.slice(0, DETAIL_MAX);
    merged.push(clean);
    added.push(clean);
  }
  return { merged, added };
}

/** Mark every signal for a concern dismissed (the coach took it off). */
export function dismissConcern(existing: readonly InterestSignal[], concern: ConcernId): InterestSignal[] {
  return existing.map((s) => (s.concern === concern ? { ...s, dismissed: true } : { ...s }));
}

/**
 * The live concerns, most recently signalled first. Dismissed concerns are
 * left out entirely.
 */
export function activeConcerns(signals: readonly InterestSignal[]): ConcernId[] {
  const dismissed = new Set(signals.filter((s) => s.dismissed).map((s) => s.concern));
  const latest = new Map<ConcernId, string>();
  for (const s of signals) {
    if (dismissed.has(s.concern)) continue;
    const prev = latest.get(s.concern);
    if (!prev || s.at > prev) latest.set(s.concern, s.at);
  }
  return [...latest.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([c]) => c);
}

/** The newest date any live signal was recorded, or null. */
export function lastInterestAt(signals: readonly InterestSignal[]): string | null {
  let best: string | null = null;
  for (const s of signals) if (!s.dismissed && (best === null || s.at > best)) best = s.at;
  return best;
}

/** One signal per concern found in a piece of text, all from one source. */
export function signalsFromText(
  text: string | null | undefined,
  source: string,
  at: string,
  detail?: string | null,
): InterestSignal[] {
  const d = (detail ?? "").replace(/\s+/g, " ").trim();
  return classifyConcerns(text).map((concern) => ({
    concern,
    source,
    at,
    ...(d ? { detail: d.slice(0, DETAIL_MAX) } : {}),
  }));
}

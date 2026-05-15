/**
 * Inbound WhatsApp message parser — recognises start-date confirmations
 * and "supplements arrived" signals, returns a structured intent the
 * webhook can act on.
 *
 * Pure helper — no async, no fs, no I/O. Lives outside `"use server"` so
 * it can be imported from the api route + tested deterministically.
 *
 * SUPPORTED FORMATS:
 *
 *   Start-date confirmations:
 *     "✅ Start: 2026-05-19"
 *     "📅 Start: 2026-05-19"
 *     "START: 2026-05-19"
 *     "start 2026-05-19"
 *     "I'll start on 2026-05-19"
 *     "Starting 19 May 2026"
 *     "Start 19/5/26"  (DD/MM/YY — Indian convention)
 *     "Start 19/05/2026"
 *
 *   Supplement-arrived signals:
 *     "supplements arrived"
 *     "supplements have arrived"
 *     "supps arrived"
 *     "got my supplements"
 *     "supplements are here"
 *
 * The parser is intentionally generous on input but strict on output —
 * we return null on ambiguity. The webhook routes ambiguous messages to
 * the existing free-form quick_note path so the coach can review.
 */

export type StartDateIntent =
  | { kind: "meal_start_date"; date: string }      // YYYY-MM-DD
  | { kind: "supplements_arrived"; date: string }  // YYYY-MM-DD (today)
  | null;

// ── Date pattern recognisers ────────────────────────────────────────────────

// ISO: 2026-05-19
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;

// DD/MM/YYYY or DD/MM/YY (Indian convention — DD first)
const DMY_DATE = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/;

// "19 May 2026", "19th May 2026", "19 May", "May 19", "May 19 2026"
const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
const TEXTUAL_DATE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b(?:\s+(\d{2,4}))?/i;
const TEXTUAL_DATE_RHS = /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+(\d{2,4}))?/i;

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function expandYear(y: number): number {
  // Two-digit year → 20XX (Indian clients won't be sending 19XX dates here)
  if (y < 100) return 2000 + y;
  return y;
}

function isoFromYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > 2099) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function extractDate(text: string): string | null {
  // Try ISO first (least ambiguous)
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return isoFromYmd(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10));
  }
  // DD/MM/YYYY (Indian convention)
  const dmy = DMY_DATE.exec(text);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = expandYear(parseInt(y, 10));
    return isoFromYmd(year, parseInt(m, 10), parseInt(d, 10));
  }
  // Textual "19 May 2026" — fallback for "Starting 19 May"
  const tx = TEXTUAL_DATE.exec(text);
  if (tx) {
    const [, d, monthWord, yRaw] = tx;
    const m = MONTHS[monthWord.toLowerCase()];
    if (m) {
      const y = yRaw ? expandYear(parseInt(yRaw, 10)) : new Date().getFullYear();
      return isoFromYmd(y, m, parseInt(d, 10));
    }
  }
  // Textual "May 19 2026" — US-style fallback
  const txr = TEXTUAL_DATE_RHS.exec(text);
  if (txr) {
    const [, monthWord, d, yRaw] = txr;
    const m = MONTHS[monthWord.toLowerCase()];
    if (m) {
      const y = yRaw ? expandYear(parseInt(yRaw, 10)) : new Date().getFullYear();
      return isoFromYmd(y, m, parseInt(d, 10));
    }
  }
  return null;
}

// ── Intent recognisers ──────────────────────────────────────────────────────

const START_PREFIX = /^\s*(?:✅|📅)?\s*start(?:ing)?\s*[:\-]?\s*/i;
const START_VERB_PHRASE = /\b(?:i(?:'|')?ll\s+start(?:\s+on)?|starting(?:\s+on)?|start(?:\s+on)?)\b/i;

const SUPPLEMENTS_ARRIVED = /\b(?:supp(?:lement)?s?\s+(?:have\s+)?arrived|got\s+(?:my\s+)?supp(?:lement)?s?|supp(?:lement)?s?\s+(?:are\s+)?here|received\s+(?:my\s+)?supp(?:lement)?s?)\b/i;

export function parseInboundStartDateIntent(rawText: string): StartDateIntent {
  if (!rawText) return null;
  const text = rawText.trim();

  // ── Supplements arrived (no date — uses today) ──
  if (SUPPLEMENTS_ARRIVED.test(text)) {
    const today = new Date().toISOString().slice(0, 10);
    return { kind: "supplements_arrived", date: today };
  }

  // ── Start-date confirmation ──
  // Require either an explicit "START:" prefix OR a verb phrase like
  // "I'll start on" — refuses to interpret bare dates so we don't
  // false-positive on a client saying "had a flare-up on 2026-05-19".
  const hasStartPrefix = START_PREFIX.test(text);
  const hasStartVerb = START_VERB_PHRASE.test(text);
  if (!hasStartPrefix && !hasStartVerb) return null;

  const date = extractDate(text);
  if (!date) return null;

  // Sanity: the date should be in a plausible window — within 60 days
  // either side of today. Catches typos like 2027 instead of 2026.
  const now = Date.now();
  const ts = Date.parse(date + "T00:00:00");
  if (isNaN(ts)) return null;
  const diffDays = Math.abs(ts - now) / (1000 * 60 * 60 * 24);
  if (diffDays > 60) return null;

  return { kind: "meal_start_date", date };
}

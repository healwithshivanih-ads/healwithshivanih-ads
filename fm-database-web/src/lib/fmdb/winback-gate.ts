/**
 * The gate a win-back email must pass before it can be approved.
 *
 * This is check-renewal-letter.mjs's ruleset, moved to where it can actually
 * refuse something. That script is a CLI the coach runs by hand against a draft
 * file; these drafts are approved with a button, so the same rules have to live
 * in the request path or they are advisory. A REFUSE blocks the send.
 *
 * The rules are not hypothetical — each is something that has happened, or came
 * within one click of happening, on a real renewal letter:
 *   - a number nobody can source, in a letter to someone who tracks their own
 *   - a price that was estimated rather than confirmed
 *   - an unfilled placeholder, which passes every other check because it holds
 *     no digits to source and no malformed number to reject
 *   - the specific supplement being held back, named — giving away the offer
 *   - a letter that never asks for anything
 *
 * Pure: no I/O, no clock. The caller supplies the sourceable figures.
 */

import { PRICE_PLACEHOLDER } from "./winback-email";

export interface WinbackGateInput {
  body: string;
  /** The client's display name — the letter must address them. */
  name: string;
  /**
   * Every number that appears anywhere in the deterministic briefing, as bare
   * tokens. Built by the caller from renewal-brief.py's JSON.
   */
  sourceNumbers: ReadonlySet<string>;
  /** Prices the coach has actually confirmed, or that come from a constant. */
  allowedPrices: readonly number[];
  /** Recorded weights in kg, as strings exactly as stored. */
  weightValues: ReadonlySet<string>;
}

export interface WinbackGateResult {
  ok: boolean;
  refuse: string[];
  warn: string[];
}

/**
 * Figures small enough to read as prose rather than as data.
 *
 * "your 12 weeks", "the 3 things we changed". Mirrors the same list in
 * check-renewal-letter.mjs. Note that kg figures are checked separately and are
 * NEVER exempted by this list — see below.
 */
const PROSE_NUMBERS = /^(1|2|3|4|5|6|7|8|9|10|11|12|20|30)$/;

/**
 * Number scanner.
 *
 * The lookbehind must exclude a comma and a full stop as well as word
 * characters, or the scan restarts INSIDE a formatted number: "₹85,000" yielded
 * a phantom "000" that matched no price and no briefing entry, and refused a
 * perfectly good letter. A gate that cries wolf gets switched off.
 */
const NUMBER_SCAN = /(?<![\w₹,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w,.]\d)/g;

const PLACEHOLDER_SCAN = /<<[^>]*>>|\{\{[^}]*\}\}|\bTBC\b|\bTODO\b|\bXXX+\b|\[insert[^\]]*\]/gi;

/** Supplements typically held back as the reason to continue. Naming one while
 *  describing something withheld hands over the offer. */
const HELD_BACK = ["NAC", "N-acetyl", "acetylcysteine", "berberine", "inositol", "ashwagandha"];

/** Shorthand a client should not have to decode. Warned, not refused. */
const CLINICAL_JARGON = ["HOMA-IR", "hsCRP", "TPO Ab", "TgAb", "ApoB", "Lp(a)", "eGFR", "fT3", "fT4"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function checkWinbackEmail(input: WinbackGateInput): WinbackGateResult {
  const { body } = input;
  const refuse: string[] = [];
  const warn: string[] = [];

  // ── an unfilled template must never reach a client ───────────────────────
  if (body.includes(PRICE_PLACEHOLDER)) {
    refuse.push(
      "the price has not been filled in — enter what this client should be quoted, or use the maintenance-only touch",
    );
  }
  for (const m of body.matchAll(PLACEHOLDER_SCAN)) {
    refuse.push(`unfilled placeholder "${m[0]}" — fill it or cut it`);
  }

  // ── prices must be deliberate ────────────────────────────────────────────
  const allowed = new Set(input.allowedPrices.map((p) => String(p)));
  const prices = [...body.matchAll(/(?:₹|Rs\.?\s?)([\d,]+)/g)].map((m) => m[1]);
  for (const p of prices) {
    if (!/^\d{1,3}(,\d{3})+$|^\d{4,}$/.test(p)) {
      refuse.push(`price "${p}" is malformed`);
      continue;
    }
    if (!allowed.has(p.replace(/,/g, ""))) {
      refuse.push(
        `price "₹${p}" is not one you have confirmed — enter it in the price box so it is recorded, or remove it`,
      );
    }
  }
  if (/\bRs\.?\s?\d/.test(body)) {
    warn.push("uses 'Rs' — house style is ₹");
  }

  // ── every other number must be sourceable ────────────────────────────────
  // Membership is by TOKEN, not substring: "6" is a substring of "cl-006",
  // "week 6" and every date in the briefing, so a substring test waves through
  // exactly the figures that matter — a weight, a percentage, a score.
  const priceTokens = new Set(prices);
  for (const m of body.matchAll(NUMBER_SCAN)) {
    const n = m[1];
    if (priceTokens.has(n)) continue;
    if (PROSE_NUMBERS.test(n)) continue;
    const bare = n.replace(/,/g, "");
    if (!input.sourceNumbers.has(bare) && !input.sourceNumbers.has(n)) {
      refuse.push(`"${n}" appears in the email but nowhere in the briefing — source it or cut it`);
    }
  }

  // ── weights are never prose ──────────────────────────────────────────────
  // A weight in kg is the one figure the client has been checking themselves
  // all along, so the small-number exemption above must not reach it. Checked
  // against the weight series specifically, never against any number in the
  // briefing — "6" is a legitimate briefing token, so a generic membership test
  // waves "you've lost 6 kg" straight through.
  for (const m of body.matchAll(/(\d+(?:\.\d+)?)\s?kgs?\b/gi)) {
    if (input.weightValues.size === 0) {
      refuse.push(
        `"${m[1]} kg" — the briefing holds no weight measurements at all, so this cannot be sourced`,
      );
    } else if (!input.weightValues.has(m[1])) {
      refuse.push(
        `"${m[1]} kg" is not among the recorded weights (${[...input.weightValues].join(", ")})`,
      );
    }
  }

  // ── the held-back supplement must stay unnamed ───────────────────────────
  for (const s of HELD_BACK) {
    if (
      new RegExp(`\\b${escapeRe(s)}\\b`, "i").test(body) &&
      /held back|kept back|left .* out/i.test(body)
    ) {
      refuse.push(`names "${s}" while describing something held back — that gives away the offer`);
    }
  }

  // ── recipient ────────────────────────────────────────────────────────────
  const fn = (input.name.trim().split(/\s+/)[0] || "").toLowerCase();
  if (fn && !body.toLowerCase().includes(fn)) {
    refuse.push(`the email never addresses ${input.name.trim().split(/\s+/)[0]} by name`);
  }

  // ── a letter with no ask is a newsletter ─────────────────────────────────
  if (!/call me|give me a call|let me know|shall we|reply|tell me/i.test(body)) {
    refuse.push("no call to action — the email never asks for anything");
  }

  // ── voice rules that are warnings, not blocks ────────────────────────────
  if (/I want to be straight with you/i.test(body)) {
    warn.push(`"I want to be straight with you" reads as confrontation — wrong register`);
  }
  if (/opened it \d+ of \d+|logged in \d+ times|opened the app \d+/i.test(body)) {
    refuse.push("quotes app-usage statistics — that reads as surveillance");
  }
  for (const j of CLINICAL_JARGON) {
    const inList = new RegExp(`^\\s*[-•]\\s*.*${escapeRe(j)}`, "mi").test(body);
    if (!inList && new RegExp(escapeRe(j), "i").test(body)) {
      warn.push(`"${j}" appears outside a test list — plain English reads better in prose`);
    }
  }

  return { ok: refuse.length === 0, refuse, warn };
}

/** Collect every numeric token in a briefing payload, for `sourceNumbers`. */
export function briefingNumbers(brief: unknown): Set<string> {
  const text = JSON.stringify(brief ?? {});
  return new Set([...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
}

#!/usr/bin/env node
/**
 * Deterministic gate on a renewal letter, before anyone sees it.
 *
 * The letter is authored in chat rather than by an API call, which saves the
 * credits but removes the schema that a tool-use call would have enforced.
 * This is that schema. It is not advisory: a REFUSE means the letter does not
 * go out.
 *
 * What it is actually guarding against, all of which has happened:
 *   - a number nobody can source, in a letter to someone who tracks their own
 *   - a price that was estimated rather than confirmed
 *   - the specific supplement being held back, named — giving away the offer
 *   - clinical shorthand leaking into text a client reads
 *   - a household member's renewal colliding with this one
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [clientId, draftPath] = process.argv.slice(2);
if (!clientId || !draftPath) {
  console.error("usage: check-renewal-letter.mjs <client_id> <draft-file>");
  process.exit(2);
}

const letter = fs.readFileSync(draftPath, "utf8");
const brief = JSON.parse(
  execFileSync(
    path.join(process.env.HOME, "code/healwithshivanih-ads/fm-database/.venv/bin/python"),
    [path.join(import.meta.dirname, "renewal-brief.py"), clientId],
    { encoding: "utf8" },
  ),
);

const refuse = [];
const warn = [];

// ── every number must be sourceable ─────────────────────────────────────────
// Prices are excluded: they come from the coach, not the briefing, and are
// checked separately below.
const briefText = JSON.stringify(brief);
// Membership must be by TOKEN, not substring. "6" is a substring of "cl-006",
// "week 6" and every date in the briefing, so a substring test waves through
// exactly the figures that matter — a weight, a percentage, a score.
const briefNumbers = new Set(
  [...briefText.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]),
);
const sourced = (n) => briefNumbers.has(String(n).replace(/,/g, "")) || briefNumbers.has(String(n));
// The lookbehind must exclude a comma and a full stop as well as word
// characters, or the scanner restarts INSIDE a formatted number: "₹85,000"
// yielded a phantom "000" that matched no price and no briefing entry, and
// refused a perfectly good letter. A gate that cries wolf gets switched off.
const numbers = [...letter.matchAll(/(?<![\w₹,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w,.]\d)/g)]
  .map((m) => m[1])
  .filter((n) => !/^(1|2|3|4|5|6|7|8|9|10|11|12|20|30)$/.test(n)); // small counts read as prose
for (const n of new Set(numbers)) {
  const bare = n.replace(/,/g, "");
  const isPrice = new RegExp(`(₹|Rs\\.?\\s?)${n}`).test(letter);
  if (isPrice) continue;
  if (!sourced(bare) && !sourced(n)) {
    refuse.push(`"${n}" appears in the letter but nowhere in the briefing — source it or cut it`);
  }
}

// ── an unfilled template must never reach a client ──────────────────────────
// The price placeholder passed every other check, because it contains no
// digits to source and no malformed number to reject. This is the one thing
// that would have gone out looking obviously automated.
for (const m of letter.matchAll(/<<[^>]*>>|\{\{[^}]*\}\}|\bTBC\b|\bTODO\b|\bXXX+\b|\[insert[^\]]*\]/gi)) {
  refuse.push(`unfilled placeholder "${m[0]}" — fill it or cut it`);
}

// ── prices must be deliberate ───────────────────────────────────────────────
const prices = [...letter.matchAll(/(?:₹|Rs\.?\s?)([\d,]+)/g)].map((m) => m[1]);
if (!prices.length) warn.push("no price in the letter — intended?");
for (const p of prices) {
  if (!/^\d{1,3}(,\d{3})+$|^\d{4,}$/.test(p)) refuse.push(`price "${p}" is malformed`);
}

// ── the held-back supplement must stay unnamed ──────────────────────────────
for (const s of ["NAC", "N-acetyl", "acetylcysteine", "berberine", "inositol", "ashwagandha"]) {
  if (new RegExp(`\\b${s}\\b`, "i").test(letter) && /held back|kept back|left .* out/i.test(letter)) {
    refuse.push(`names "${s}" while describing something held back — that gives away the offer`);
  }
}

// ── clinical shorthand a client should not have to decode ───────────────────
for (const j of ["HOMA-IR", "hsCRP", "TPO Ab", "TgAb", "ApoB", "Lp(a)", "eGFR", "fT3", "fT4"]) {
  // Allowed inside an explicit list of tests to book; refused in prose.
  const inList = new RegExp(`^\\s*[-•]\\s*.*${j.replace(/[()]/g, "\\$&")}`, "mi").test(letter);
  if (!inList && new RegExp(j.replace(/[()]/g, "\\$&"), "i").test(letter)) {
    warn.push(`"${j}" appears outside a test list — plain English reads better in prose`);
  }
}

// ── recipient ───────────────────────────────────────────────────────────────
if (brief.email && !letter.toLowerCase().includes(brief.name.split(" ")[0].toLowerCase())) {
  refuse.push(`letter never addresses ${brief.name.split(" ")[0]} by name`);
}

// ── household collision ─────────────────────────────────────────────────────
if ((brief.household_also_renewing || []).length) {
  warn.push(
    `household also renewing: ${brief.household_also_renewing.join(", ")} — confirm sequencing with the coach before sending`,
  );
}

// ── a letter with no ask is a newsletter ────────────────────────────────────
if (!/call me|give me a call|let me know|shall we|reply/i.test(letter)) {
  refuse.push("no call to action — the letter never asks for anything");
}

// ── honesty about progress ──────────────────────────────────────────────────
// A weight in kg is never "prose", however small the number: it is the one
// figure the client has been checking themselves all along, and the small-
// number exclusion above would otherwise wave "you've lost 6 kg" straight
// through.
// Checked against the WEIGHT SERIES, never against any number in the
// briefing: "6" is a legitimate token (week 6, a client id), so a generic
// membership test waves "you've lost 6 kg" straight through. If there is no
// weight series at all, no kg figure is defensible.
const weightVals = new Set((brief.weights || []).map((w) => String(w.weight_kg)));
for (const m of letter.matchAll(/(\d+(?:\.\d+)?)\s?kgs?\b/gi)) {
  if (!weightVals.size) {
    refuse.push(`"${m[1]} kg" — the briefing holds no weight measurements at all, so this cannot be sourced`);
  } else if (!weightVals.has(m[1])) {
    refuse.push(`"${m[1]} kg" is not among the recorded weights (${[...weightVals].join(", ")})`);
  }
}
if (/lost \d|lost weight|weight (?:has|is) (?:come off|down)|down \d+\s?kg/i.test(letter) &&
    !/weight_kg|starting_weight/.test(briefText)) {
  warn.push("claims weight loss — the briefing carries no weight series to support it");
}

const out = (label, items) => items.forEach((i) => console.log(`  ${label} ${i}`));
console.log(`\nRenewal letter check — ${brief.name} (${clientId})`);
out("REFUSE:", refuse);
out("warn:  ", warn);
if (!refuse.length && !warn.length) console.log("  clean");
console.log(refuse.length ? `\n✗ ${refuse.length} blocking issue(s) — do not send\n` : `\n✓ passes\n`);
process.exit(refuse.length ? 1 : 0);

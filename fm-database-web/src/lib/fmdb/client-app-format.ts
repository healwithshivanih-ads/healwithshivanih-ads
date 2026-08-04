/**
 * Pure formatting + classification helpers for the client app.
 *
 * Extracted verbatim from client-app.ts (which had grown past 4,600 lines —
 * Codex audit 2026-06-26, finding #6) so the bug-prone string logic here is
 * unit-testable in isolation. Every function is pure: string/number/boolean
 * in, string/number/boolean out. No fs, no module state, no app types.
 */

// Diet classification — the ONE place that decides veg vs non-veg. Critical:
// a bare /vegetarian/ test matches inside "non-vegetarian", so non-veg clients
// were being misclassified as vegetarian (wrong protein list, wrong chip).
// Always check non-veg FIRST and gate the veg test on it.
export function isNonVegPref(pref: string): boolean {
  return /non.?veg|pescatar|\bfish\b|chicken|mutton|prawn|seafood|\bmeat\b|omnivore/i.test(pref);
}
export function isVegetarianPref(pref: string): boolean {
  return !isNonVegPref(pref) && /vegetarian|vegan|jain|eggetarian|\bveg\b/i.test(pref);
}

export function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function humanize(slug: string): string {
  return (slug || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function firstSentence(text: string): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

const DOSE_QTY_RE =
  /\b\d+(?:[.,\-–/]\d+)?\s?(?:ml|mg|mcg|µg|g|IU|drops?|tsp|tbsp|teaspoons?|tablespoons?|capsules?|caps?|tablets?|tabs?|pills?|scoops?|sachets?|billion(?:\s?CFU)?)\b/i;

export function shortDose(dose: string): string {
  const d = dose.replace(/\s+/g, " ").trim();
  if (!d) return "";
  // A real client dose is short. When the coach has stuffed a titration
  // schedule or brand note into the dose field — e.g. deepti's iron:
  // "TONOFERON LIQUID (Glenmark …) — 7.5 ml ALTERNATE DAYS … push to 15 ml
  // daily (~33 mg)" — pull just the leading dose quantity (mobile audit
  // 2026-06-13). Triggered by length or coach-speak so normal ranges
  // ("300-400mg", "1-2 capsules") pass through untouched.
  const qty = d.match(DOSE_QTY_RE);
  if (qty && (d.length > 40 || /\b(?:alternate days?|if\b|push to|increase to|week \d|FORM SWAP|OTC|pharmac|client reported|titrat|ALTERNATE)/i.test(d)))
    return qty[0].replace(/\s+/g, " ").trim();
  const cut = d.split(/(?<=mg|mcg|g|IU)\b/i)[0];
  const out = (cut && cut.length >= 4 ? cut : d).trim();
  return out.length > 44 ? (qty ? qty[0].trim() : `${out.slice(0, 42).trim()}…`) : out;
}

// The end-of-day cue, defined ONCE because it is tested in three places
// (timingRank's pinned-late check, timingRank's fallthrough, and shortTiming)
// and those copies silently drifted. All three tested
// /bedtime|before sleep|at night|\bnight\b/ — which never matched "before bed",
// the phrasing coaches actually write. Magnesium glycinate prescribed for sleep
// therefore fell past every branch to the unknown-default rank (25) and rendered
// in the client app's MORNING slot, next to breakfast (2026-07-26).
// \bbed\b, never a bare /bed/: "bedside", "bedroom" and "embedded" must not fire.
// \bsleep (open-ended) keeps "before sleeping" matching, as it did before, and
// keeps this in step with the letter generator's bare "sleep" keyword.
const BEDTIME_CUE = /bedtime|\bbed\b|\bsleep|\bnight(?:ly|s)?\b|\bretiring\b/;

/**
 * Chronological rank for a supplement's timing — the order it's actually
 * taken through the day. Multi-dose items ("morning and evening") anchor at
 * their EARLIEST dose. The user-facing rule this enforces: morning
 * empty-stomach (10) sorts before morning-with-breakfast (20) before
 * mid-morning (30) before lunch (40) before afternoon (50) before dinner
 * (60) before bedtime (70); as-needed (100) always last.
 */
export function timingRank(timing: string, dose: string, emptyStomach: boolean, asNeeded: boolean): number {
  if (asNeeded) return 100;
  // The TIMING field is the coach's explicit statement of when to take it; `dose`
  // is titration prose that merely MENTIONS times. Scanning both together let the
  // dose overrule the instruction: cl-007's magnesium is timed "Bedtime, with a
  // full glass of water" but its dose reads "…to one comfortable Bristol 3-4 stool
  // each morning" — that stray "morning" cancelled the bedtime pin and filed a
  // sleep supplement under Morning on the client's phone. So resolve on `timing`
  // alone first, and only widen to the dose when timing says nothing definite
  // (rank 25 is this function's "I could not tell" default).
  // Within the timing field the dose time is stated in the LEADING clause; what
  // follows an em-dash / full stop / semicolon is the coach explaining why, and
  // that explanation routinely names OTHER times as reference points. Read on:
  //   "Early afternoon — at least 4 hours after your morning Thyronorm"
  //   "Evening with dinner or at bedtime. Bedtime keeps it clear of the morning …"
  // Both are afternoon/evening doses whose rationale says "morning", and both were
  // filed under Morning — putting cl-013's iron next to the levothyroxine the note
  // exists to keep it 4 h away from. So try the leading clause first, then the
  // whole timing field, and only then widen to the dose prose.
  for (const text of [leadingClause(timing), timing, `${timing} ${dose}`]) {
    if (!text.trim()) continue;
    const r = rankTimingText(` ${text.toLowerCase()} `, emptyStomach);
    if (r !== UNKNOWN_TIMING_RANK) return r;
  }
  return UNKNOWN_TIMING_RANK;
}

/** Rank a single already-lowercased, space-padded timing string. Split out of
 *  `timingRank` so the timing field can be resolved on its own before the dose
 *  is allowed to contribute — see the note there. */
/** The dose-time clause of a timing string: everything before the first em-dash,
 *  full stop or semicolon. The coach's rationale lives after that boundary and
 *  names other times as reference points ("…4 hours after your morning Thyronorm"),
 *  which must not out-vote the dose time itself. */
function leadingClause(timing: string): string {
  const head = (timing || "").split(/\s+[—–]\s+|[.;]/)[0] ?? "";
  // Drop parentheticals: a bracket qualifies the dose, it never states a second
  // one. "With dinner (… pair with bedtime magnesium)" is a dinner dose whose
  // note happens to name another bottle's bedtime.
  return head.replace(/\([^)]*\)/g, " ");
}

/** A bare clock hour, when no worded cue matched. The parser had no clock reading
 *  at all, so a deliberately-timed "Around 3 pm" iron dose (moved off breakfast to
 *  clear tea/coffee and other minerals) landed in the breakfast band. */
function rankClockHour(t: string): number {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (!m) return UNKNOWN_TIMING_RANK;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm") h += 12;
  if (h < 11) return 20;   // morning
  if (h < 15) return 40;   // around lunch
  if (h < 18) return 50;   // afternoon
  if (h < 21) return 60;   // evening / dinner
  return 70;               // late — bedtime
}

const UNKNOWN_TIMING_RANK = 25;

/** Two time cues joined by "and" / "then" / "&" / "+" are TWO doses, and the item
 *  is anchored at the EARLIER one so the earlier dose is not lost off the card.
 *  A bare comma is NOT a joiner and neither is "or":
 *    "with dinner and before bed"   → two doses, anchor at dinner
 *    "in the evening, before bed"   → one dose; "evening" only qualifies "bed"
 *    "Evening, with dinner or at bedtime" → one dose, a pick-one — the coach
 *      ruled 2026-08-04 that the sleep-ward option wins (see the test file). */
const DOSE_JOINER = /\band\b|\bthen\b|&|\+/;

function rankTimingText(t: string, emptyStomach: boolean): number {
  // An item pinned to ONE late time belongs at that time. An earlier cue only
  // displaces it when the earlier cue is a SEPARATE dose — i.e. there is a
  // joiner. Without one the earlier word is a qualifier, not a second dose.
  // The evening-ward words were missing from this guard entirely, so
  // "with dinner and before bed" answered Bedtime and the dinner dose simply
  // disappeared from the client's card. Conversely "empty stomach" used to
  // count unconditionally, which sent an explicit "before bed, empty stomach"
  // to rank 10 — the app's MORNING group, for a bedtime dose.
  const earlierWorded =
    /morning|breakfast|\blunch\b|midday|\bnoon\b|before meal|before breakfast|empty stomach|on waking|upon waking|first thing|mid.?morning|\bdinner\b|\bsupper\b|\bevening\b|\bafternoon\b/;
  const hasEarlierDose = DOSE_JOINER.test(t) && earlierWorded.test(t);
  if (BEDTIME_CUE.test(t) && !hasEarlierDose) return 70;
  if (/\bafternoon\b/.test(t) && !/morning|breakfast|before breakfast|empty stomach|on waking|first thing/.test(t)) return 50;
  // first thing / empty stomach on waking → start of the day, UNLESS the dose
  // is explicitly a later between-meal (e.g. "mid-morning, empty stomach")
  if (emptyStomach || /before breakfast|on waking|upon waking|first thing|empty stomach|on an empty/.test(t)) {
    if (/mid.?morning|between breakfast and lunch/.test(t)) return 30;
    if (/\bafternoon\b/.test(t)) return 50;
    return 10;
  }
  // "between A and B" bounds ONE window — the earlier meal is not a dose, so
  // this must be read before the plain breakfast/lunch cues below or
  // "between breakfast and lunch" files as a breakfast dose. The gap sits at
  // the END of the window, one band ahead of the later anchor.
  const window = /between\s+(breakfast|lunch|dinner)\s+and\s+(breakfast|lunch|dinner)\b/.exec(t);
  if (window) {
    const band: Record<string, number> = { breakfast: 20, lunch: 40, dinner: 60 };
    return Math.max(band[window[1]], band[window[2]]) - 10;
  }
  if (/\bbreakfast\b|\bmorning\b/.test(t) && !/mid.?morning|between breakfast and lunch/.test(t)) return 20;
  if (/before\s+(?:a|the|each|your|main)?\s*meals?\b|before food|after\s+(?:a|the|your)?\s*meals?\b|with or after\s+(?:a|the)?\s*meal/.test(t)) return 45;
  if (/mid.?morning|between breakfast and lunch|after breakfast|between meals/.test(t)) return 30;
  if (/\blunch\b|midday|\bnoon\b/.test(t)) return 40;
  if (/\bafternoon\b/.test(t)) return 50;
  if (/\bdinner\b|evening meal|with evening|supper|\bevening\b/.test(t)) return 60;
  if (BEDTIME_CUE.test(t)) return 70;
  if (/with meals|with food|with a meal|largest meal|main meal|fat.?containing|fatty meal/.test(t)) return 45;
  const clock = rankClockHour(t);
  if (clock !== UNKNOWN_TIMING_RANK) return clock;
  return 25; // unknown → treat as a morning/first-meal item
}

/** Collapse the fine chronological rank into the app's 3 display groups. */
export function slotFromRank(rank: number): "Morning" | "With meals" | "Bedtime" {
  if (rank >= 70) return "Bedtime";
  if (rank >= 40) return "With meals";
  return "Morning";
}

export function shortTiming(timing: string): string {
  const t = ` ${timing.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ")} `;
  if (/empty stomach|on an empty/.test(t)) return "Empty stomach";
  if (/before breakfast|just before breakfast/.test(t)) return "Before breakfast";
  if (/with breakfast|morning.{0,8}breakfast|breakfast/.test(t) && !/before breakfast/.test(t)) return "With breakfast";
  if (/mid.?morning|between breakfast and lunch/.test(t)) return "Mid-morning";
  if (/before meal|before each meal|before main meal|before food/.test(t)) return "Before meals";
  if (/between meals/.test(t)) return "Between meals";
  if (/with lunch/.test(t)) return "With lunch";
  if (/\blunch\b|midday|\bnoon\b/.test(t)) return "Midday";
  if (/mid.?afternoon|early afternoon|\bafternoon\b/.test(t)) return "Afternoon";
  if (/with dinner|with evening meal|with evening|evening meal/.test(t)) return "With dinner";
  if (/largest meal|main meal|biggest meal|fat.?containing|with a fat|with meals|with food|with a meal/.test(t)) return "With a meal";
  if (BEDTIME_CUE.test(t)) return "Bedtime";
  if (/\bmorning\b/.test(t)) return "Morning";
  if (/\bevening\b/.test(t)) return "Evening";
  // explicit clock time → keep just the time as the token ("around 3 pm" → "3 pm")
  const clock = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m|p\.?m)\b/);
  if (clock) return `${clock[1]}${clock[2] ? ":" + clock[2] : ""} ${clock[3].replace(/\./g, "").toLowerCase()}`;
  // no meal/clock anchor — a whole-day window ("any time of day", "as convenient")
  if (/any ?time|anytime|any time of day|as convenient|whenever|throughout the day/.test(t)) return "Anytime";
  // fallback: the first clause, cleaned + capped
  const first = timing.replace(/\([^)]*\)/g, "").split(/[,;]/)[0].trim();
  if (!first) return "With food";
  const s = first.charAt(0).toUpperCase() + first.slice(1);
  return s.length > 30 ? `${s.slice(0, 28).trim()}…` : s;
}

// Twice-daily clarity: shortTiming() collapses "morning and evening" → "Morning",
// hiding the second dose. When the timing explicitly names two times (joined by
// "and" / "&" / "+"), show BOTH — "Morning & evening", "With lunch & dinner" — so
// a twice-a-day capsule reads clearly on the daily tab. Single-phrase ranges
// ("between breakfast and lunch") are left to shortTiming.
/** A clause anchors a real dose-time (meal, clock time, part of day) — as
 *  opposed to a descriptive tail like "tasteless and clear" or "with water". */
function isTimePhrase(clause: string): boolean {
  const t = ` ${clause.toLowerCase()} `;
  // Shares BEDTIME_CUE rather than restating the late-day words: this list
  // omitted "bed", so "morning and before bed" failed the every()-check below
  // and collapsed to just "Morning" — hiding the bedtime dose entirely.
  if (BEDTIME_CUE.test(t)) return true;
  return /\b(breakfast|lunch|dinner|supper|morning|evening|afternoon|midday|noon|night|bedtime|meal|meals|waking|\d{1,2}\s*(?:a\.?m|p\.?m))\b/.test(
    t,
  );
}

export function displayTiming(timing: string): string {
  const base = shortTiming(timing);
  const lc = timing.toLowerCase();
  if (!/\b(and|&|\+)\b/.test(lc) || /between/.test(lc)) return base;
  const halves = timing.split(/\s*(?:&|\+|\band\b)\s*/i).map((h) => h.trim()).filter(Boolean);
  // Only treat this as a twice-daily "X & Y" when BOTH halves name an actual
  // time — otherwise a descriptive clause ("... tasteless and clear") would be
  // mis-split into a garbage second label. Fall back to the single base token.
  if (halves.length < 2 || !halves.every(isTimePhrase)) return base;
  const labels: string[] = [];
  for (const h of halves) {
    const lab = shortTiming(h);
    if (lab && !labels.includes(lab)) labels.push(lab);
  }
  if (labels.length < 2) return base;
  return labels.map((l, i) => (i === 0 ? l : l.toLowerCase())).join(" & ");
}

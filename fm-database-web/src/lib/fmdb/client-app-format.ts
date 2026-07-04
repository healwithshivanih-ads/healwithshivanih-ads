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
  const t = ` ${`${timing} ${dose}`.toLowerCase()} `;
  // an item pinned to ONE late time (and no earlier cue) belongs at that time
  const earlier = /morning|breakfast|\blunch\b|midday|\bnoon\b|before meal|before breakfast|empty stomach|on waking|upon waking|first thing|mid.?morning/;
  if (/bedtime|before sleep|at night|\bnight\b/.test(t) && !earlier.test(t)) return 70;
  if (/\bafternoon\b/.test(t) && !/morning|breakfast|before breakfast|empty stomach|on waking|first thing/.test(t)) return 50;
  // first thing / empty stomach on waking → start of the day, UNLESS the dose
  // is explicitly a later between-meal (e.g. "mid-morning, empty stomach")
  if (emptyStomach || /before breakfast|on waking|upon waking|first thing|empty stomach|on an empty/.test(t)) {
    if (/mid.?morning|between breakfast and lunch/.test(t)) return 30;
    if (/\bafternoon\b/.test(t)) return 50;
    return 10;
  }
  if (/before meal|before each meal|before main meal|before food/.test(t)) return 14;
  if (/\bbreakfast\b|\bmorning\b/.test(t) && !/mid.?morning/.test(t)) return 20;
  if (/mid.?morning|between breakfast and lunch|after breakfast|between meals/.test(t)) return 30;
  if (/\blunch\b|midday|\bnoon\b/.test(t)) return 40;
  if (/\bafternoon\b/.test(t)) return 50;
  if (/\bdinner\b|evening meal|with evening|supper|\bevening\b/.test(t)) return 60;
  if (/bedtime|before sleep|at night|\bnight\b/.test(t)) return 70;
  if (/with meals|with food|with a meal|largest meal|main meal|fat.?containing|fatty meal/.test(t)) return 45;
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
  if (/bedtime|before sleep|at night|\bnight\b/.test(t)) return "Bedtime";
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

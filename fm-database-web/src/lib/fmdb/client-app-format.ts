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
// (TIMING_CUES below, shortTiming, and isTimePhrase) and those copies silently
// drifted. All three tested
// /bedtime|before sleep|at night|\bnight\b/ — which never matched "before bed",
// the phrasing coaches actually write. Magnesium glycinate prescribed for sleep
// therefore fell past every branch to the unknown-default rank (25) and rendered
// in the client app's MORNING slot, next to breakfast (2026-07-26).
// \bbed\b, never a bare /bed/: "bedside", "bedroom" and "embedded" must not fire.
// \bsleep (open-ended) keeps "before sleeping" matching, as it did before, and
// keeps this in step with the letter generator's bare "sleep" keyword.
const BEDTIME_CUE = /bedtime|\bbed\b|\bsleep|\bnight(?:ly|s)?\b|\bretiring\b/;

/**
 * The seven canonical times of day a supplement can be assigned to. Every
 * surface that buckets supplements by time uses these indices, then applies its
 * own labels/emoji/colours — the PARSE is shared, the presentation is not.
 * Matches _TIMING_SLOTS in scripts/render-client-letter.py index-for-index.
 */
export type DaySlot = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Every dose-time cue, ordered MOST-SPECIFIC-FIRST. A cue that matches blanks
// the characters it consumed, so a broader cue further down the list can never
// re-read the same words as a second, separate dose ("mid-morning" must not
// also register the bare-morning slot). `rank` is the fine chronological sort
// key documented on timingRank(); `slot` is the coarse DaySlot the cue names.
const TIMING_CUES: ReadonlyArray<{ re: RegExp; rank: number; slot: DaySlot }> = [
  // "in the evening before bed" is ONE dose described twice over — the
  // part-of-day word qualifies the bed cue, it is not an extra evening dose.
  // A joiner between them ("evening AND before bed") fails this pattern and so
  // stays two doses, which is the distinction that matters clinically.
  {
    re: /\b(?:early |late |mid[-\s]?)?(?:evening|afternoon|night)\b[\s,;—-]*(?:just |right |immediately )?before\s+(?:bed(?:time)?|sleep\w*)/g,
    rank: 70,
    slot: 6,
  },
  // "30 min before breakfast" → taken fasted, THEN the client eats.
  { re: /\bbefore\s+breakfast\b/g, rank: 10, slot: 0 },
  // "Between X and Y" is ONE window whose midpoint is the dose time — the two
  // meal names bound it, they are not two doses. Consuming both names is what
  // stops the minimum-of-all-cues rule below reading the opening meal as the
  // answer. Midpoints match _routine_slots() in render-client-letter.py.
  { re: /\bmid[-\s]?morning\b|\bbetween\s+breakfast\s+and\s+lunch\b/g, rank: 30, slot: 2 },
  {
    re: /\bbetween\s+lunch\s+and\s+dinner\b|\bbetween\s+breakfast\s+and\s+dinner\b|\bmid[-\s]?afternoon\b|\bearly\s+afternoon\b|\bafternoon\b/g,
    rank: 50,
    slot: 4,
  },
  { re: /\bon\s+waking\b|\bupon\s+waking\b|\bfirst\s+thing\b/g, rank: 10, slot: 0 },
  { re: /\bbreakfast\b|\bmorning\b/g, rank: 20, slot: 1 },
  // NB: bare \bnoon\b never fires inside "afternoon" (no word boundary), and
  // "afternoon" has already been consumed above regardless.
  { re: /\blunch\b|\bmidday\b|\bnoon\b/g, rank: 40, slot: 3 },
  { re: /\bdinner\b|\bsupper\b|\bevening\b/g, rank: 60, slot: 5 },
  { re: new RegExp(BEDTIME_CUE.source, "g"), rank: 70, slot: 6 },
];

interface Cue {
  rank: number;
  slot: DaySlot;
  at: number;
}

/** Sort rank for each DaySlot — the coarse slot's position in the day. */
const SLOT_RANK: Record<DaySlot, number> = { 0: 10, 1: 20, 2: 30, 3: 40, 4: 50, 5: 60, 6: 70 };

// An explicit clock time ("around 3 pm", "7:45am", "10:00 pm"). _TIMING_SLOTS
// spells out one keyword per hour it happens to have thought of ("8 am", "3 pm",
// "9 pm", …), which silently defaults the hours it missed — 8 pm and 11 pm land
// at With Breakfast there. Deriving the slot from the hour covers every hour and
// agrees with that list on all of the hours it does name.
const CLOCK_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m|p\.?m)\b/g;

function slotForHour(h24: number): DaySlot {
  if (h24 <= 6) return 0;
  if (h24 <= 9) return 1;
  if (h24 <= 11) return 2;
  if (h24 <= 13) return 3;
  if (h24 <= 16) return 4;
  if (h24 <= 19) return 5;
  return 6;
}

/** EVERY dose-time cue in the string (see TIMING_CUES), with where it was found. */
function timingCues(t: string): Cue[] {
  let rest = t;
  const found: Cue[] = [];
  const consume = (i: number, len: number) => {
    // Blank what a cue consumed, in place, so the string keeps its original
    // indices while broader cues below can no longer see the same words.
    rest = `${rest.slice(0, i)}${" ".repeat(len)}${rest.slice(i + len)}`;
  };
  for (const { re, rank, slot } of TIMING_CUES) {
    for (const h of [...rest.matchAll(re)]) {
      const i = h.index ?? 0;
      found.push({ rank, slot, at: i });
      consume(i, h[0].length);
    }
  }
  for (const h of [...rest.matchAll(CLOCK_RE)]) {
    const hour12 = Number(h[1]);
    if (hour12 < 1 || hour12 > 12) continue;
    const pm = h[3].startsWith("p");
    const h24 = hour12 === 12 ? (pm ? 12 : 0) : pm ? hour12 + 12 : hour12;
    const slot = slotForHour(h24);
    found.push({ rank: SLOT_RANK[slot], slot, at: h.index ?? 0 });
    consume(h.index ?? 0, h[0].length);
  }
  return found;
}

/** Pick the one cue that decides the dose time, or null if the text names none. */
function winningCue(t: string): Cue | null {
  const cues = timingCues(t);
  if (!cues.length) return null;
  // "X or Y" / "X / Y" is one dose the client may take at either time, not two
  // doses — so take the FIRST-MENTIONED cue (the coach's primary suggestion)
  // rather than the earliest clock slot. Mirrors the same rule in
  // _routine_slots(); without it "Bedtime (with or after dinner)" would rank as
  // a dinner dose. Otherwise the EARLIEST dose wins (see timingRank).
  if (cues.length > 1 && /\bor\b|\s\/\s/.test(t)) return cues.reduce((a, b) => (b.at < a.at ? b : a));
  return cues.reduce((a, b) => (b.rank < a.rank ? b : a));
}

/**
 * The ONE parse of a coach's free-text timing. Returns the fine `rank` (sort
 * order through the day), the coarse `slot` (which of the 7 day buckets), and
 * two flags that tell a caller how much the text actually committed to:
 *
 *   · `namesTime` — the text named a time of day (a meal, a clock time, a
 *     fasted window, a between-meals gap). Only then is `slot` a real claim.
 *   · `matched`   — the text gave us anything at all to go on, including a
 *     how-to-take-it qualifier ("with food") that implies no particular time.
 *
 * A surface with an "Anytime" / "Timing not set" bucket must branch on
 * `namesTime`: "with a fat-containing meal" says nothing about WHEN, so filing
 * it under With Breakfast invents a meal the coach never specified.
 *
 * Every timing-bucketing surface funnels through here. There used to be five
 * separate copies of this logic (this file, FmSupplementGrid, reminders-derive,
 * plan-editor, the reference view) and they disagreed in ways clients could see:
 * the grid's naive substring match put "Afternoon" under With Lunch (because
 * "afternoon" contains "noon") and "5 g amla powder" under With Breakfast
 * (because " amla" contains " am") — the exact traps the Python parser fixed
 * with word boundaries in 2026-05-29 and that copy never received.
 */
interface ResolvedTiming {
  rank: number;
  slot: DaySlot;
  matched: boolean;
  namesTime: boolean;
}

function resolveTiming(timing: string, dose: string, emptyStomach = false): ResolvedTiming {
  // Underscores become spaces: a raw enum value ("with_breakfast") reaches this
  // field from the take_with_food picker, and "_" is a word character — so
  // \bbreakfast\b would not fire and the dose fell into the "not set" bucket.
  const full = ` ${`${timing} ${dose}`.toLowerCase().replace(/_/g, " ")} `;
  // The PRIMARY timing is the first clause. Everything after a caveat delimiter
  // (em/en dash, period, semicolon, open paren) is usually a SEPARATION rule —
  // "Bedtime — at least 4 h after your MORNING dose", "With dinner (keep clear
  // of the MORNING levothyroxine)" — whose own time words must NOT decide the
  // bucket, or an evening supplement lands in the morning. Slot on the primary
  // clause; fall back to the whole string only when it carries no cue at all.
  // Ported from reminders-derive.ts, which was the only copy that got this right.
  const primary = full.split(/\s[—–-]\s|[.;(]/)[0];
  const cue = winningCue(primary) ?? winningCue(full);
  // "Empty stomach" names a condition, not a clock time. It sets the time only
  // when nothing else does, and refines the bare morning slot down to the
  // pre-breakfast one (the 10-sorts-before-20 promise on timingRank). It must
  // NOT drag a later named anchor to the top of the day: "before bed, empty
  // stomach" is a bedtime dose, and used to rank 10 → the app's Morning group.
  const fasted =
    emptyStomach || /empty stomach|on an empty|before breakfast|on waking|upon waking|first thing/.test(full);
  // A fasted window IS a time of day — "on an empty stomach" means first thing,
  // away from food, and _TIMING_SLOTS agrees (slot 0, Early Morning).
  if (fasted && (cue === null || cue.rank === 20)) return { rank: 10, slot: 0, matched: true, namesTime: true };
  // "Between meals … morning and evening" means the GAP after breakfast, not
  // breakfast itself — so between-meals promotes a bare morning cue to
  // mid-morning. Same exception _parse_routine_pos() carries.
  if (cue?.rank === 20 && /between meals?\b/.test(full))
    return { rank: 30, slot: 2, matched: true, namesTime: true };
  if (cue) return { rank: cue.rank, slot: cue.slot, matched: true, namesTime: true };
  // No cue named a time. "Between meals" still describes a window (the gap after
  // breakfast — slot 2, as in _TIMING_SLOTS), but the with-food qualifiers below
  // only say HOW to take the dose. They get a slot so surfaces that must place
  // every row still can, with namesTime false so surfaces that have an
  // "Anytime" bucket can decline to invent a meal the coach never named.
  if (/between meals?\b/.test(full)) return { rank: 30, slot: 2, matched: true, namesTime: true };
  if (/before meal|before each meal|before main meal|before food/.test(full))
    return { rank: 14, slot: 1, matched: true, namesTime: false };
  if (/with meals|with food|with a meal|largest meal|main meal|fat.?containing|fatty meal/.test(full))
    return { rank: 45, slot: 1, matched: true, namesTime: false };
  // Unknown → a morning/first-meal item for ranking, but nothing was named.
  return { rank: 25, slot: 1, matched: false, namesTime: false };
}

/**
 * Which of the 7 canonical day slots this timing names. THE shared entry point
 * for any surface that groups supplements by time of day — do not re-parse the
 * timing string locally. Branch on `namesTime` (not `matched`) wherever the UI
 * has an "Anytime" / "Timing not set" bucket; see ResolvedTiming above.
 */
export function timingSlot(
  timing: string | undefined,
  dose = "",
): { slot: DaySlot; matched: boolean; namesTime: boolean } {
  const { slot, matched, namesTime } = resolveTiming(timing ?? "", dose);
  return { slot, matched, namesTime };
}

/**
 * Chronological rank for a supplement's timing — the order it's actually
 * taken through the day. Multi-dose items ("morning and evening") anchor at
 * their EARLIEST dose. The user-facing rule this enforces: morning
 * empty-stomach (10) sorts before morning-with-breakfast (20) before
 * mid-morning (30) before lunch (40) before afternoon (50) before dinner
 * (60) before bedtime (70); as-needed (100) always last.
 *
 * Implemented by collecting every cue and taking the minimum — the same shape
 * as _parse_routine_pos() in scripts/render-client-letter.py, which returns
 * every matching slot. (Letters are retired; that file's name is legacy — it is
 * still live as the app-menu / Daily Routine renderer, imported by
 * generate-app-menu.py, so the client sees both surfaces and they must agree.)
 * The previous shape was an ordered if-chain guarded by a
 * boolean "is there an earlier cue?" regex that listed only morning/lunch
 * words: "with dinner and before bed" therefore returned 70, so the app showed
 * the item under Bedtime alone and the dinner dose vanished (2026-07-26).
 * Adding dinner/evening to that guard is NOT the fix — it would drop
 * "in the evening before bed" from 70 to 60, i.e. a bedtime supplement shown
 * at dinner, the same clinical failure pointing the other way. Collecting all
 * of the cues removes the ordering-sensitivity that made both possible.
 */
export function timingRank(timing: string, dose: string, emptyStomach: boolean, asNeeded: boolean): number {
  if (asNeeded) return 100;
  return resolveTiming(timing, dose, emptyStomach).rank;
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

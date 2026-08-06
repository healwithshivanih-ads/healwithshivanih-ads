/**
 * When in the day a remedy belongs — the ONE parser, shared by the app timeline
 * and the reminder deriver.
 *
 * WHY THIS EXISTS. A remedy's timing was being read in three different places
 * with three different ad-hoc tests: `beforeBreakfast` on the payload, and two
 * regexes on the Today screen (`/bed/i` for bedtime drinks, `/between/i` for
 * sips). Everything else fell through to nowhere, which is how a remedy that
 * needs to be taken an hour after dinner ended up written into the dinner slot
 * as though it were the meal.
 *
 * THE SLOTS ARE DERIVED FROM THE DATA, not invented. Across the 13 remedies
 * actually prescribed on this roster the timings cluster into six places, and
 * two of them (mid-morning, mid-afternoon) already exist as menu slots. The
 * four that had nowhere to live — on waking, after lunch, after dinner, bedtime
 * — are exactly the ones with no meal attached.
 *
 * A REMEDY CAN BELONG TO SEVERAL SLOTS, which is why this returns a list. The
 * most-prescribed remedy on the roster (CCF tea, 9 clients) reads "between
 * meals (mid-morning, mid-afternoon, evening)", and showing it once at an
 * arbitrary one of those would be a worse answer than showing it at each.
 *
 * MATCH ON BOUNDARIES, NEVER BARE SUBSTRINGS. `\bbed\b` and not `/bed/`, or
 * "bedside" fires. This is the same family of trap that put a bedtime magnesium
 * dose in a client's morning.
 */

/** Ordered by when they happen — the array order IS the day order. */
export const REMEDY_SLOTS = [
  "on_waking",
  "mid_morning",
  "after_lunch",
  "mid_afternoon",
  "after_dinner",
  "bedtime",
] as const;

export type RemedySlot = (typeof REMEDY_SLOTS)[number];

/** Client-facing label for each slot. Kept here so the app and any future
 *  surface cannot drift into two different wordings for the same moment. */
export const REMEDY_SLOT_LABEL: Record<RemedySlot, string> = {
  on_waking: "On waking",
  mid_morning: "Mid-morning",
  after_lunch: "After lunch",
  mid_afternoon: "Mid-afternoon",
  after_dinner: "After dinner",
  bedtime: "Before bed",
};

/**
 * Clauses the timing explicitly rules OUT.
 *
 * Real and present in the catalogue: hibiscus tea reads "mid-morning or
 * afternoon; avoid right at bedtime due to mild diuretic effect". A matcher
 * that scans the whole string slots it at bedtime — the one time the entry
 * names in order to forbid it. Same shape as a negation guard reading "no
 * history of falls" as a falls history.
 */
const NEGATION = /\b(?:avoid|not|never|don'?t|do not|except)\b[^.;]*/gi;

function positiveText(when: string): string {
  return (when || "").toLowerCase().replace(NEGATION, " ");
}

/**
 * A phrase that means "TAKE IT in the morning" — not merely the word.
 *
 * Triphala reads "works overnight to mobilize the bowel for morning
 * evacuation": that names the outcome, and a bare-word match put a bedtime
 * churan on the waking slot as well. Used BOTH to place a remedy on waking and
 * to decide whether a bedtime remedy also has a morning dose, so the two can
 * never disagree.
 */
const MORNING_DOSE_SRC =
  "\\b(?:in the morning|each morning|every morning|morning and (?:night|bed)|on waking|on rising|first thing)\\b";
const MORNING_DOSE = new RegExp(MORNING_DOSE_SRC);

/** Each slot and the phrases that put a remedy in it. Order within the list is
 *  irrelevant; the ORDER OF THE CHECKS below is what resolves overlaps. */
const SLOT_CUES: [RemedySlot, RegExp][] = [
  ["on_waking", new RegExp(`\\b(?:empty stomach|before breakfast|pre-?breakfast)\\b|${MORNING_DOSE_SRC}`)],
  [
    "bedtime",
    /\b(?:bed|bedtime|night|nightly|before sleep|last thing)\b/,
  ],
  [
    "after_lunch",
    /\bafter\b[^.;]*\b(?:lunch|midday meal)\b|\b(?:after|following)\b[^.;]*\bmeals?\b/,
  ],
  [
    "after_dinner",
    /\bafter\b[^.;]*\b(?:dinner|supper|evening meal|last meal)\b|\b(?:after|following)\b[^.;]*\bmeals?\b/,
  ],
  [
    "mid_morning",
    /\b(?:mid-?morning|between meals|mid-?day)\b/,
  ],
  [
    "mid_afternoon",
    // "evening" means the time of day — but "the evening MEAL" is dinner, and
    // matching it here put an after-dinner remedy in the afternoon as well.
    /\b(?:mid-?afternoon|afternoon|between meals)\b|\bevening\b(?!\s+meal)/,
  ],
];

/**
 * Every slot a remedy belongs to, in day order. Empty when the timing says
 * nothing placeable — the caller decides what to do with that (the app shows it
 * under "anytime" rather than guessing a time and being wrong).
 *
 * BEDTIME WINS OVER "AFTER DINNER" when both are named, because that is what
 * the entries mean: triphala reads "Bedtime, empty stomach (at least 2 hours
 * after dinner)" — the 2-hours-after-dinner is a spacing rule, not a second
 * occasion. Ghee-milk reads "At bedtime, after the last meal of the day", which
 * is one moment described twice.
 */
export function remedySlots(when: string): RemedySlot[] {
  const text = positiveText(when);
  if (!text.trim()) return [];

  const hit = new Set<RemedySlot>();
  for (const [slot, re] of SLOT_CUES) if (re.test(text)) hit.add(slot);

  // A timing that names bedtime is ONE occasion, even when it also describes
  // its distance from the last meal or the state to take it in.
  //
  // Triphala reads "Bedtime, empty stomach (at least 2 hours after dinner)":
  // the empty stomach is a CONDITION and the 2-hours-after-dinner is a spacing
  // rule — neither is a second occasion. Without this it lands on waking AND at
  // bedtime, and the client does it twice.
  if (hit.has("bedtime")) {
    hit.delete("after_dinner");
    hit.delete("after_lunch");
    hit.delete("mid_afternoon");
    // ...unless the entry genuinely prescribes a morning dose as well.
    if (!MORNING_DOSE.test(text)) hit.delete("on_waking");
  }

  return REMEDY_SLOTS.filter((s) => hit.has(s));
}

/** True when the remedy has a placeable time at all. */
export function hasRemedySlot(when: string): boolean {
  return remedySlots(when).length > 0;
}

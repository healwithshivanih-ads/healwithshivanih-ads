/**
 * What KIND of thing a plan practice is, as far as the client app is concerned.
 *
 * A plan's `lifestyle_practices` mixes two different animals under one list:
 *
 *   - things you DO, at a moment — a walk after lunch, 4-7-8 breathing before
 *     bed, ten minutes of morning sunlight. These have a completion event, so a
 *     tick means something;
 *   - standing RULES — "Keep coffee to one, before noon", "Vegetables first,
 *     then protein, then carbs", "Go strictly gluten-free". These are never
 *     finished. There is nothing to tick, and asking for a tick every day turns
 *     a rule she is keeping into a box she is failing.
 *
 * The app used to render both as daily checkboxes. Measured on Nazneen
 * (cl-022): across 46 logged days she ticked her supplements 176/309 and her
 * on-waking drinks 92/92 — and her practices 0/414, eight of nine being rules.
 * Her weekly check-ins said "Keeping up" for every one of them. The rules were
 * working; the checkbox was the thing failing. Across the roster roughly a third
 * of all practices are rules.
 *
 * So each practice is classified:
 *
 *   daily      — tick it today; counts toward today's ring
 *   weekly     — N times a week (strength, BP checks); shown on its days, never
 *                counted against a day it was not due
 *   as_needed  — a tool for a moment (EFT, a reset); lives in Practices, never
 *                a daily tick
 *   guideline  — a standing rule; shown once, as guidance, and asked about in
 *                the WEEKLY check-in, which is the right granularity for it
 *
 * This is a heuristic over free text, so the coach can override it with
 * `app_kind` on the practice. The rules below were written against all 142
 * practices on the live roster (2026-10-22) and are pinned by
 * practice-kind.test.ts — change one and the roster fixture says what moved.
 */

export type PracticeKind = "daily" | "weekly" | "as_needed" | "guideline";

/** Where in the day the practice lives. Mirrors the supplement / remedy clock
 *  (client-app-format.ts timingRank: 10 waking … 70 bedtime) so one timeline
 *  can hold all three. */
export type DayPart = "waking" | "morning" | "meals" | "midday" | "evening" | "bedtime" | "anytime";

export interface PracticeKindResult {
  kind: PracticeKind;
  part: DayPart;
  /** weekly only: how many times a week, when stated */
  perWeek?: number;
  /** weekly only: the days it falls on (0 = Sunday … 6 = Saturday), when named */
  days?: number[];
}

const APP_KINDS: readonly PracticeKind[] = ["daily", "weekly", "as_needed", "guideline"];

/** A coach override, when it is a valid kind. Anything else is ignored. */
export function parseAppKind(v: unknown): PracticeKind | null {
  return typeof v === "string" && (APP_KINDS as readonly string[]).includes(v) ? (v as PracticeKind) : null;
}

// ── weekly cadence ──────────────────────────────────────────────────────────

const PER_WEEK_RE =
  /(\d+|once|twice|two|three|four|five)\s*(?:-\s*\d+\s*)?(?:x|×|times|sessions?|days?)?\s*(?:\/|per|a|each|in a)?\s*(?:week|wk)\b|\b(once|twice) weekly\b|\b(\d)x weekly\b/i;
const WORD_NUM: Record<string, number> = { once: 1, twice: 2, two: 2, three: 3, four: 4, five: 5 };
const DAY_NAMES: [RegExp, number][] = [
  [/\bsun(day)?\b/i, 0],
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

function perWeekOf(text: string): number | undefined {
  const m = text.match(PER_WEEK_RE);
  if (!m) return undefined;
  const raw = (m[1] || m[2] || m[3] || "").toLowerCase();
  const n = WORD_NUM[raw] ?? parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 7 ? n : undefined;
}

/** Named days only from a CADENCE that reads like a day list ("Mon/Wed/Fri"),
 *  never from prose — "a Sunday-night reset" is not a schedule. */
function daysOf(cadence: string): number[] | undefined {
  if (!/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:[/,&]|and)\s*(?:mon|tue|wed|thu|fri|sat|sun)/i.test(cadence)) {
    return undefined;
  }
  const days = DAY_NAMES.filter(([re]) => re.test(cadence)).map(([, d]) => d);
  return days.length ? days : undefined;
}

// ── as needed ───────────────────────────────────────────────────────────────

const AS_NEEDED_RE =
  /\bas[\s-]*needed\b|\bwhenever needed\b|\bwhen needed\b|\bas required\b|\bprn\b|\bin the moment\b|\bwhen (?:the |things |it )?\w+ (?:rises|tighten|tightens|spikes|hits)\b|\bwhen things tighten\b|\bwhen the irritation rises\b|\bafter a stressful moment\b|around your period/i;
/** "as needed, AND once daily" is a daily practice that can also be used ad hoc. */
const ALSO_DAILY_RE = /\b(?:and|plus|\+)\s*(?:once|twice)?\s*(?:a\s*)?da(?:y|ily)\b/i;

// ── guidelines ──────────────────────────────────────────────────────────────

/** A name that OPENS with a rule verb is a rule, whatever else it mentions —
 *  "Hold the yoga, keep dinner before 5.30pm" names yoga and is not yoga. */
const RULE_OPENER_RE =
  /^\s*(?:stop|avoid|cut(?:ting)?(?: back| down)?|no|keep|hold|limit|reduce|go (?:strictly )?\w+-free|go strictly|maintain|don'?t|never|only|swap|switch|name the|eat slowly|chew|most drinks|alcohol|eno\b)/i;

/** Phrases that mark a rule anywhere in the text. */
const RULE_RE = new RegExp(
  [
    String.raw`\bevery (?:main )?meal\b`,
    String.raw`\beach (?:main )?meal\b`,
    String.raw`\bat every\b`,
    String.raw`\bevery lunch\b`,
    String.raw`\b(?:first|1st),? (?:then|protein|vegetables)`,
    String.raw`\bfirst, then\b`,
    String.raw`\bsequencing\b`,
    String.raw`\bprotein[- ](?:first|anchored)\b`,
    String.raw`\b(?:gluten|dairy|sugar)[- ]free\b`,
    String.raw`\bfast(?:ing)?\b`,
    String.raw`\bsleep \d`,
    String.raw`\bsleep on your\b`,
    String.raw`\b(?:meal|tablet|thyroid)[- ]timing\b`,
    String.raw`\btiming\b.*\b(?:empty stomach|away from)\b`,
    String.raw`\bsame time every day\b`,
    String.raw`\bpairing\b`,
    String.raw`\bseparation\b`,
    String.raw`\bfront[- ]load\b`,
    String.raw`\bmodification\b`,
    String.raw`\binstead of\b`,
    String.raw`\bbase\b`,
    String.raw`\b(?:smart|friendly) eating\b`,
    String.raw`\b(?:before|by) \d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)\b`,
    String.raw`\bno screens?\b`,
    String.raw`\bscreens? (?:off|down)\b`,
    String.raw`\b(?:lights?|bedtime|sleep[- ]wake|sleep) (?:out|anchor|schedule)\b`,
    String.raw`\bdim lights\b`,
    String.raw`\bconsistent (?:sleep|timing)\b`,
    String.raw`\bposture\b`,
    String.raw`\b\d+(?:\.\d+)?\s*(?:litres?|liters?|l)\b.*\b(?:water|fluids?)\b`,
    String.raw`\b(?:water|fluids?)\b.*\bcounted\b`,
    String.raw`\btrial\b`,
    String.raw`\bthen a clear\b`,
    String.raw`\bquit date\b`,
  ].join("|"),
  "i",
);

/** Unmistakable DOING — a completion event exists. Checked after the rule
 *  opener but BEFORE the rule phrases, because "10-minute walk after every
 *  meal" carries "every meal" and is a walk. */
const ACTION_RE =
  /\bwalk(?:ing|s)?\b|\bbreath(?:ing|s|work)?\b|\bbreaths\b|\bpranayama\b|\b4-?7-?8\b|\byoga\b|\bstrength(?:ening)?\b|\bresistance\b|\bexercise\b|\bmovement session\b|\bworkout\b|\bsun(?:light| exposure)\b|\bdaylight\b|\bjournal(?:l?ing)?\b|\bgratitude\b|\babhyanga\b|\bmassage\b|\bnasya\b|\bspray\b|\bcompress\b|\bcastor oil\b|\btapping\b|\beft\b|\bstretch|\brelease\b|\bmouth[- ]tap(?:e|ing)\b|\bregulation\b|\bactivation\b|\bstress[- ](?:reduction|downshift)\b|\bwind[- ]down\b|\britual\b|\bgrounding\b|\bblood[- ]pressure\b|\bbp check\b|\bpack the\b|\btriphala\b|\bseed mix\b|\btea\b|\blemon water\b|\belectrolytes?\b|\bcheck\b/i;

// ── time of day ─────────────────────────────────────────────────────────────

/** Same cue order as client-app.ts practiceTimeRank, so the timeline and the
 *  Plan tab sort a practice to the same moment. */
export function partOfDay(name: string, cadence: string): DayPart {
  const t = `${name} ${cadence}`.toLowerCase();
  // A named meal beats everything: "post-lunch walk (not in direct sunlight)"
  // is a lunchtime walk, not a sunrise one.
  if (/post-?lunch|after lunch/.test(t) && !/after lunch and|lunch and (?:after )?dinner/.test(t)) return "midday";
  if (/post-?dinner|after dinner/.test(t) && !/lunch/.test(t)) return "evening";
  if (/wak(e|ing)|on rising|first thing|sunrise|sunlight|morning sun|daylight/.test(t)) return "waking";
  if (/\bmorning\b|\bam\b|a\.m\.|before (?:your )?(?:morning )?shower|commute/.test(t)) return "morning";
  if (/post-?meal|after (each |every |both )?(?:main )?meals?|after lunch|after dinner|with meals|with food|before (?:each )?meals?/.test(t))
    return "meals";
  if (/midday|noon|lunch|afternoon/.test(t)) return "midday";
  if (/night|bed|bedtime|sleep|lights out|nightly|\bscreens?\b|digital|wind-?down|before sleep|\bpm\b|p\.m\./.test(t))
    return "bedtime";
  if (/evening|sunset|journal|after work|the night before/.test(t)) return "evening";
  return "anytime";
}

/**
 * Classify one practice.
 *
 * Order matters and each step is there for a real entry:
 *   1. a coach override always wins;
 *   2. a guided session (somatic / exercise) is always something you do —
 *      the app opens a player for it;
 *   3. a rule OPENER ("Keep…", "Stop…", "Hold the yoga…") is a guideline;
 *   4. as-needed, unless it is also "once daily";
 *   5. a weekly cadence → weekly;
 *   6. an action word → daily (before rule phrases: a walk after every meal);
 *   7. a rule phrase → guideline;
 *   8. otherwise daily — the old behaviour, so nothing silently disappears.
 */
export function classifyPracticeKind(
  name: string,
  cadence = "",
  opts: { override?: unknown; guided?: boolean } = {},
): PracticeKindResult {
  const n = name || "";
  const c = cadence || "";
  const text = `${n} ${c}`;
  const part = partOfDay(n, c);

  const weekly = (): PracticeKindResult => {
    const perWeek = perWeekOf(text);
    const days = daysOf(c);
    return {
      kind: "weekly",
      part,
      ...(perWeek ? { perWeek } : days ? { perWeek: days.length } : {}),
      ...(days ? { days } : {}),
    };
  };

  const override = parseAppKind(opts.override);
  if (override === "weekly") return weekly();
  if (override) return { kind: override, part };

  const isWeekly = () =>
    !!perWeekOf(text) || !!daysOf(c) || /\bweekly\b|\ba few days a week\b|\bon non-consecutive days\b/i.test(c);

  if (opts.guided) return isWeekly() ? weekly() : { kind: "daily", part };
  if (RULE_OPENER_RE.test(n)) return { kind: "guideline", part };
  if (AS_NEEDED_RE.test(text) && !ALSO_DAILY_RE.test(c)) return { kind: "as_needed", part };
  if (isWeekly()) return weekly();
  if (ACTION_RE.test(n)) return { kind: "daily", part };
  if (RULE_RE.test(text)) return { kind: "guideline", part };
  return { kind: "daily", part };
}

/** Is a weekly practice due today? A practice with named days is due on those
 *  days; one with only a count ("3× a week") is offered every day and the
 *  client picks — it never counts against the day either way. */
export function weeklyDueToday(r: PracticeKindResult, dow: number): boolean {
  if (r.kind !== "weekly") return false;
  return r.days ? r.days.includes(dow) : true;
}

// ── supplements taken less than daily ─────────────────────────────────────

export interface SupplementCadence {
  /** "weekly" = once a week; "alternate" = every other day / named days */
  cadence: "weekly" | "alternate";
  /** named days (0 = Sunday), when the dose names a day list ("Mon/Wed/Fri") */
  days?: number[];
}

/**
 * A supplement that is NOT taken every day — "60,000 IU sachet once weekly",
 * "7.5 ml alternate days (Mon/Wed/Fri)". Shown as a daily tick, a weekly D3
 * made a fully-ticked day impossible, and a client kept reporting it as "still
 * taking" long after the course ended.
 *
 * Any mention of a DAILY dose keeps it daily — "60,000 IU daily ×4 days, then
 * weekly" and "alternate-day or daily per tolerance" are both read the old way,
 * because guessing which phase someone is in is worse than a tick too many.
 */
export function supplementCadence(dose: string, timing: string): SupplementCadence | null {
  const text = `${dose || ""} ${timing || ""}`;
  if (/\bdaily\b|\ba day\b|\bper day\b|\/\s*day\b|\beach day\b|\bevery day\b|\bnightly\b|\btwice a day\b/i.test(text)) return null;
  const days = daysOf(text);
  if (/\balternate[- ]days?\b|\bevery other day\b/i.test(text)) return { cadence: "alternate", ...(days ? { days } : {}) };
  if (/\bonce (?:a )?week(?:ly)?\b|\bweekly\b|\bper week\b|\ba week\b/i.test(text)) return { cadence: "weekly", ...(days ? { days } : {}) };
  return null;
}

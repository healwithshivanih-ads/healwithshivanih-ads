/**
 * Plan ⇆ client-payload parity checks.
 *
 * Every guard we had validated DATA (is this plan well-formed? is this recipe
 * real?). None compared what the PLAN PROMISES against what the client's phone
 * actually CARRIES. All five client-facing defects shipped in the week of
 * 2026-07-26 lived in exactly that gap, and the coach was the only detector —
 * after the client had already seen it:
 *
 *   - a supplement timed "Before Bed" rendered in the MORNING group (the
 *     bedtime cue matched "bedtime" but not "before bed");
 *   - fenugreek ("methi") resolved its Reorder button to an FM Nutrition
 *     SELENIUM product, because "methi" is a substring of "seleno_methionine".
 *
 * The three families below are deliberately built so they cannot be satisfied
 * by the code they check:
 *
 *   PRESENCE  — plan YAML vs built payload. Different code paths by
 *               construction; nothing here re-derives the payload.
 *   PLACEMENT — the expected slot comes from CURATED_TIMING_SLOT, a hand-written
 *               table of unambiguous coach phrases and where a human says they
 *               belong. It must NEVER call timingRank/slotFromRank: an
 *               expectation computed by the parser under test can't fail when
 *               the parser is wrong. A phrase naming several times resolves to
 *               the earliest of them THROUGH that same table; a phrase naming
 *               no time is reported unspecified (nothing to verify); anything
 *               else the table cannot read is reported unclassified, never
 *               guessed.
 *   TARGET    — a buy link must plausibly BE the item. Asserted on the OUTPUT
 *               (resolved product name vs item name, whole-word), independent
 *               of pickLinkEntry's scoring, which is the thing that was wrong.
 *
 * Pure: no fs, no server-only, no clock. The caller supplies the plan dict, the
 * payload, and (for TARGET) a url → product-name lookup.
 */

import type { ClientAppData } from "./client-app";

export type ParityFamily = "presence" | "placement" | "target";

/** error = a client is seeing something wrong right now. warn = a legitimate
 *  coach-side suppression could explain it, so a human must look. info =
 *  bookkeeping (a timing phrase we could not classify, or one that states no
 *  time at all), never a defect. */
export type ParitySeverity = "error" | "warn" | "info";

export interface ParityFinding {
  family: ParityFamily;
  severity: ParitySeverity;
  /** stable machine code — the sweep groups on this */
  code: string;
  /** the prescribed thing this is about (supplement name, dish, remedy slug) */
  item: string;
  /** where in the payload/plan to look ("week 2 · Wed · Lunch") */
  where?: string;
  expected?: string;
  actual?: string;
  detail: string;
}

/** Only the payload fields parity reads. Structurally a ClientAppData, so the
 *  compiler still binds this to the real contract, but nothing at runtime
 *  imports the server-only builder. */
export type ParityAppData = Pick<
  ClientAppData,
  | "supplements"
  | "allSupplements"
  | "weekMenus"
  | "practices"
  | "remedies"
  | "client"
  | "seedCycling"
  | "periodCare"
  | "breathwork"
  | "eft"
  | "sleep"
  | "mindBody"
>;

export interface ParityOpts {
  /** Resolve a buy URL to the catalogue product's display name(s) — a few URLs
   *  are published under two names for the same bottle, and any of them naming
   *  the item is enough. Return null for a URL the catalogue doesn't own
   *  (per-plan coach override, search fallback): not assertable, so skipped.
   *  Omit the whole callback to skip the TARGET family. */
  productNameForUrl?: (url: string) => string | string[] | null;
  /** The client record (client.yaml). Only the `mindbody_<technique>` drip
   *  overrides are read: a technique the coach set to `locked` is SUPPOSED to
   *  be absent from the payload, and warning about it is a false alarm. Omit
   *  it and every missing drippable practice warns, as it did before. */
  client?: Dict | null;
}

type Dict = Record<string, unknown>;

// ───────────────────────── ground truth: timing → slot ─────────────────────
//
// Hand-written from the clinical meaning of each phrase, NOT from the parser.
// The app collapses the day into three groups the client sees — Morning /
// With meals / Bedtime — so each entry answers: "a coach wrote this on the
// plan; which of those three headings must the client find it under?"
//
// Two reading rules make the answers consistent, and both are statements about
// the coach's words, not about any code:
//
//   MEAL ANCHOR, NO TIME OF DAY → "With meals". The middle group is literally
//     the meal group, so a dose defined only by its relation to food — with,
//     just before, or just after "a meal" / "meals" / "food" — belongs there
//     whichever side of the plate it falls on. (Naming BREAKFAST is different:
//     that is a time of day, and it reads Morning.)
//   TWO OR MORE ANCHORS → the EARLIEST of them, resolved by expectedSlotFor
//     from the single-anchor entries here. Never hand-written per combination.
//
// Membership rule: only phrases where the answer is beyond argument. A phrase
// that names no time at all ("anytime", "away from tea/coffee") is listed in
// TIMING_NO_TIME_STATED instead; a genuinely two-sided one ("between meals" —
// mid-morning or mid-afternoon, no way to choose) is deliberately ABSENT and
// gets reported unclassified rather than silently guessed. Every string below
// is a real coach phrase from the live corpus (surveyed 2026-07-27), or a bare
// anchor that multi-anchor phrases in it resolve through, normalised by
// normTiming().
export const CURATED_TIMING_SLOT: Record<string, "Morning" | "With meals" | "Bedtime"> = {
  // ── Bedtime: the last thing before sleep. "before bed" is first on this
  //    list on purpose — it is the exact phrase that shipped in Morning.
  "before bed": "Bedtime",
  "at bedtime": "Bedtime",
  bedtime: "Bedtime",
  "bedtime, with a full glass of water": "Bedtime",
  "bedtime, 30 minutes before sleep": "Bedtime",
  "before sleep": "Bedtime",
  "at night": "Bedtime",
  nightly: "Bedtime",
  "on retiring": "Bedtime",

  // ── Morning: on waking, or anchored to breakfast / the first half of the day.
  "with breakfast": "Morning",
  "morning with breakfast": "Morning",
  "morning, with breakfast": "Morning",
  "with or just before breakfast": "Morning",
  breakfast: "Morning",
  morning: "Morning",
  "in the morning": "Morning",
  "first thing in the morning": "Morning",
  "on waking": "Morning",
  "on waking, empty stomach": "Morning",
  "on an empty stomach": "Morning",
  "on empty stomach": "Morning",
  "morning on empty stomach": "Morning",
  "empty stomach": "Morning",
  "before breakfast": "Morning",
  "30 minutes before breakfast": "Morning",
  "30 min before breakfast on empty stomach": "Morning",
  "mid-morning": "Morning",
  "mid morning": "Morning",
  // The window between the first two meals IS mid-morning — one span, one time.
  "between breakfast and lunch": "Morning",
  "morning only": "Morning",
  // The shake is the vehicle, not a second time: the dose is the morning one.
  "morning with protein shake": "Morning",
  // Two anchors inside one bracket (mid-morning + afternoon); the earliest is
  // mid-morning, and this as-needed calmer is found in the morning routine.
  "daytime (mid-morning + a tense afternoon)": "Morning",
  // Taken before her MORNING movement session — the exercise names the hour.
  "~30-60 min before her morning yoga / physio / movement": "Morning",

  // ── With meals: anchored to a meal that is not breakfast, or to "a meal"
  //    with no time given. (The group is literally named for this case.)
  "with lunch": "With meals",
  "with dinner": "With meals",
  "with the evening meal": "With meals",
  "with evening meal": "With meals",
  "with a meal": "With meals",
  "with meals": "With meals",
  "with food": "With meals",
  "with the largest meal of the day": "With meals",
  "with largest meal of the day": "With meals",
  "with the main/largest meal": "With meals",
  "with the two largest meals": "With meals",
  "with a fat-containing meal": "With meals",
  "with lunch or dinner": "With meals",
  "30 min before dinner": "With meals",
  "~30 min before dinner": "With meals",
  lunch: "With meals",
  dinner: "With meals",

  // Before / after the plate. Same group as "with": the meal is the anchor and
  // no hour is named, so the client finds it where their meals are. Berberine
  // "before meals" is a dose at EVERY meal — filing it under Morning would read
  // as one dose at breakfast.
  "before food": "With meals",
  "before meals": "With meals",
  "before a meal": "With meals",
  "15-20 min before a meal": "With meals",
  "~20 min before meals": "With meals",
  "after a meal": "With meals",
  "with or after a meal": "With meals",

  // Evening and afternoon: neither is waking-time, and neither is the last
  // thing before sleep (that is what Bedtime means here) — they are the middle
  // of the client's day, alongside lunch and dinner.
  evening: "With meals",
  afternoon: "With meals",
  "mid-afternoon": "With meals",
  "early afternoon": "With meals",
  "around 3 pm": "With meals",

  // Long coach phrases whose ONE stated dose-time is unmistakable, kept verbatim
  // because their trailing prose mentions other times that belong to something
  // else (another medicine, another supplement, a second optional meal).
  // "…(lunch or dinner)" / "…(lunch + dinner)": both options are the meal group,
  // so the alternative cannot change the answer.
  "with a fat-containing meal (lunch or dinner)": "With meals",
  "with main meals (lunch + dinner)": "With meals",
  "once weekly, sunday lunch (fixed day), with fat-containing meal": "With meals",
  "~30 min before dinner (± lunch once tolerated), always with a full glass of water": "With meals",
  // The bracket is the rationale for an evening dose and names the BEDTIME
  // MAGNESIUM it is paired with — a different bottle, not this one's time.
  "with dinner (evening dose to lower upper-normal cortisol + pair with bedtime magnesium)": "With meals",
  // Iron. The only dose-time stated is "early afternoon"; the morning mentioned
  // is the client's THYRONORM, the thing this dose must stay 4 h away from.
  "early afternoon - at least 4 hours after your morning thyronorm (iron and levothyroxine block each other). pair with a vitamin-c food (amla, lemon, tomato); keep away from tea/coffee":
    "With meals",
  // Same evening-or-bedtime choice as "Evening, with dinner or at bedtime"
  // above → the earlier option, dinner. The second sentence is the reason for
  // the LATER option and names her morning levothyroxine, not this dose.
  // Earliest-anchor would say dinner → With meals, but the coach's OWN second
  // sentence states WHY bedtime is the intended one ("keeps it well clear of the
  // morning Thyronorm"): the later option is the clinical point, not a tie. Read
  // it as the coach's stated preference.
  "evening with dinner or at bedtime. bedtime keeps it well clear of the morning thyronorm (minerals must be ≥4 h from levothyroxine)":
    "Bedtime",
};

// ─────────────────── ground truth: phrases that state no time ──────────────
//
// The coach deliberately left the hour open ("anytime"), or wrote only an
// interaction rule ("away from tea/coffee; pair with vitamin C") that says what
// to keep it apart from and nothing about when. There is no right group to
// assert, so these are NOT a coverage gap — they are excluded from the
// denominator and reported separately from phrases we simply could not read.
// Hand-listed, exact, normalised: an unfamiliar phrase falls through to
// "unclassified", which is the safe direction.
export const TIMING_NO_TIME_STATED: ReadonlySet<string> = new Set([
  "any time of day - simplest stirred into the morning protein shake",
  "anytime - preferably post-workout on training days",
  "once daily in plain water at any time of day; tasteless and clear",
  "away from tea/coffee",
  "away from tea/coffee/calcium; pair with vitamin c",
  "with vitamin c, away from tea/coffee/dairy",
]);

/** True when the plan states no dose time for this item — either nothing at all
 *  or one of the deliberately open phrases above. Placement is unverifiable and
 *  that is the coach's choice, not a gap in this table. */
/** Phrases with TWO defensible readings, deliberately left unverified.
 *
 *  "evening, with dinner or at bedtime" (magnesium glycinate, cl-004 + cl-006):
 *  earliest-anchor reads dinner → With meals, which is the documented contract and
 *  what the multi-anchor rule would return. The app reads Bedtime, which is the
 *  clinical point for magnesium glycinate. The client takes it in the evening under
 *  either reading, so NEITHER is a client-visible defect — and encoding either as
 *  ground truth manufactures a false error that trains the coach to ignore the sweep.
 *  Refusing is the honest answer; a wrong ground truth is worse than 2 points of
 *  coverage. Reinstate a reading only if the coach adjudicates the phrase. */
const TIMING_AMBIGUOUS_BY_DESIGN = new Set(["evening, with dinner or at bedtime"]);

export function timingIsAmbiguousByDesign(timing: string): boolean {
  return TIMING_AMBIGUOUS_BY_DESIGN.has(normTiming(timing));
}

export function timingStatesNoTime(rawTiming: string): boolean {
  const t = normTiming(rawTiming);
  return !t || TIMING_NO_TIME_STATED.has(t);
}

// ───────────────────────── ground truth: product synonyms ──────────────────
//
// A correct buy link does not always share a word with the plan's name for the
// item — "Vitamin D3" is sold as "Cholecalciferol", "methi" as "Fenugreek".
// These are hand-written equivalences (clinical naming, not code), so a right
// answer isn't reported as wrong. Each line is bidirectional: any token on the
// line satisfies any other token on the line.
export const PRODUCT_SYNONYMS: string[][] = [
  ["methi", "fenugreek"],
  ["d3", "d2", "cholecalciferol", "calcidiol", "calcitriol"],
  ["b12", "methylcobalamin", "cyanocobalamin", "cobalamin"],
  ["b6", "p5p", "pyridoxine", "pyridoxal"],
  ["b9", "folate", "methylfolate", "mthf", "folic"],
  ["b1", "thiamine", "benfotiamine"],
  ["b2", "riboflavin"],
  ["b3", "niacin", "niacinamide", "nicotinamide"],
  ["b5", "pantothenic", "pantothenate"],
  ["b7", "biotin"],
  ["c", "ascorbic", "ascorbate"],
  ["e", "tocopherol", "tocotrienol"],
  ["k2", "menaquinone", "mk7"],
  ["omega", "epa", "dha", "fish", "algae", "krill"],
  ["glycinate", "bisglycinate"],
  ["magnesium", "mag"],
  ["ashwagandha", "withania", "ksm"],
  ["turmeric", "curcumin", "haldi"],
  ["amla", "gooseberry"],
  ["tulsi", "basil"],
  ["brahmi", "bacopa"],
  ["triphala", "haritaki", "amalaki", "bibhitaki"],
  ["giloy", "guduchi", "tinospora"],
  ["shatavari", "asparagus"],
  ["jatamansi", "nardostachys"],
  ["probiotic", "lactobacillus", "bifidobacterium", "saccharomyces", "bacillus", "spore"],
  ["coq10", "ubiquinol", "ubiquinone", "coenzyme"],
  ["nac", "acetylcysteine", "cysteine"],
  ["glutamine", "gln"],
  ["zinc", "picolinate"],
  ["selenium", "selenomethionine"],
  ["iron", "ferrous", "bisglycinate", "ferritin", "fe"],
  ["inositol", "myo"],
  ["berberine", "berberis"],
  ["thistle", "silymarin", "silybum"],
  ["psyllium", "isabgol"],
  ["theanine", "suntheanine"],
  ["melatonin", "circadin"],
  ["collagen", "peptides"],
  ["whey", "protein"],
];

/** Words that carry no identity — a product and an item sharing only these is
 *  not evidence they are the same thing. "vitamin" is here on purpose: every
 *  vitamin bottle says it, so it must never be what makes D3 look like B12.
 *  Stored singularised (see identityTokens). */
const GENERIC_PRODUCT_TOKENS = new Set([
  "the", "and", "with", "for", "plus", "pack", "combo", "value", "new",
  "supplement", "capsule", "cap", "tablet", "tab", "softgel", "veg",
  "vegetarian", "vegan", "powder", "liquid", "drop", "sachet", "syrup",
  "oil", "extract", "vitamin",
  // NB "complex" is NOT here: "B Complex" is the identity of the product.
  "formula", "blend", "support", "care", "health", "daily", "pure",
  "organic", "natural", "premium", "advanced", "ultra", "high", "potency",
  "strength", "elemental", "chelated", "buffered", "sustained", "release",
  "mg", "mcg", "iu", "gm", "gram", "ml", "billion", "cfu", "count",
  "india", "iherb", "amazon", "vitaone", "fmnutrition", "now", "food",
  "nutrition", "lab", "life", "healthkart", "nutrabay", "brand",
]);

// ─────────────────────────────── small helpers ─────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function arr(v: unknown): Dict[] {
  return Array.isArray(v) ? (v as Dict[]) : [];
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

/** Normalise a coach timing phrase for table lookup: lowercase, collapse
 *  whitespace, drop wrapping/trailing punctuation. Nothing semantic — a
 *  semantic normaliser would be a second parser to get wrong. */
export function normTiming(raw: string): string {
  return str(raw)
    .toLowerCase()
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/_/g, " ") // "with_breakfast" — a drafter writes the enum form
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();
}

/**
 * Time-of-day families a phrase mentions. Deliberately a tiny hand list of
 * unmistakable cue words, and it never answers "which group" — it only decides
 * whether a clause SAYS something about when, so an unrecognised clause that
 * does can block a guess instead of being ignored.
 */
const ANCHOR_CUES: [string, RegExp][] = [
  ["morning", /\bmorning\b|\bbreakfast\b|\bwaking\b|empty stomach/],
  ["midday", /\blunch\b|\bmidday\b|\bnoon\b/],
  ["afternoon", /\bafternoon\b/],
  ["evening", /\bdinner\b|\bevening\b|\bsupper\b/],
  ["bedtime", /\bbedtime\b|before bed\b|\bnight\b|\bsleep\b|\bretiring\b/],
];

function anchorFamilies(t: string): Set<string> {
  const out = new Set<string>();
  for (const [fam, re] of ANCHOR_CUES) if (re.test(t)) out.add(fam);
  return out;
}

/** The three groups in the order the client's day actually runs — a fact about
 *  the day, stated by hand. Used to pick the earliest of several anchors. */
const SLOT_ORDER = ["Morning", "With meals", "Bedtime"] as const;
type Slot = (typeof SLOT_ORDER)[number];

/**
 * Does this clause say nothing at all about when to take the dose? "once
 * daily", "chew, do not swallow whole", "keep 2h from tea/coffee" — inert
 * detail that cannot move the earliest anchor, so the rest of the phrase can
 * still be resolved around it.
 *
 * A clause naming a time of day, a MEAL, or a clock hour is NOT inert: it is an
 * anchor, and if the curated table does not recognise it we must refuse rather
 * than quietly leave a real dose-time out of the earliest-anchor calculation.
 */
function statesNoDoseTime(clause: string): boolean {
  return (
    anchorFamilies(clause).size === 0 &&
    !/\b(meal|meals|food|snack)\b/.test(clause) &&
    !/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m)\b/.test(clause)
  );
}

/** Split a phrase into the clauses a coach joined together, at the top level
 *  only: text inside brackets is one unit, because a bracket is a qualifier on
 *  the clause it follows ("Bedtime (with or after dinner)"), not a separate
 *  dose. Hyphen-dash separators count; "/" does not (it joins alternatives
 *  inside one clause: "tea/coffee", "yoga / physio"). */
function splitAnchorClauses(t: string): string[] {
  const brackets: string[] = [];
  const masked = t.replace(/\([^)]*\)/g, (m) => `{${brackets.push(m) - 1}}`);
  return masked
    .split(/\s*(?:[,;]|\band\/or\b|\band\b|\bor\b|\+|&)\s*|\s-\s/)
    .map((c) => normTiming(c.replace(/\{(\d+)\}/g, (_, i) => brackets[Number(i)])))
    .filter(Boolean);
}

/**
 * The group a single clause names, from the CURATED table only — never the
 * parser. Two lookups:
 *   1. the whole clause;
 *   2. its leading part, when the coach appended detail ("With lunch (largest
 *      carb meal)", "Bedtime, with a full glass of water"). The lead only
 *      counts when the trailing detail introduces no time-of-day the lead
 *      doesn't already name — otherwise "with food (morning)" would be read as
 *      a meal item when the coach said morning.
 */
function curatedSlotFor(clause: string): Slot | null {
  const direct = CURATED_TIMING_SLOT[clause];
  if (direct) return direct;
  const lead = normTiming(clause.split(/\s*[(;,]|\s-\s/)[0]);
  if (!lead || lead === clause) return null;
  const famLead = anchorFamilies(lead);
  for (const f of anchorFamilies(clause)) if (!famLead.has(f)) return null;
  return CURATED_TIMING_SLOT[lead] ?? null;
}

/**
 * The slot a coach phrase must land in, or null when this phrase has no single
 * unambiguous answer.
 *
 * Resolution order, all of it grounded in CURATED_TIMING_SLOT:
 *   1. the whole phrase;
 *   2. multi-anchor — split at the coach's own conjunctions, look EACH clause
 *      up, and take the EARLIEST group named. A twice-daily item is found where
 *      its first dose falls ("morning and before bed" → Morning); an either/or
 *      item is found at the earlier option, because that may well be the one
 *      the client takes. Refused unless every clause either resolves or says
 *      nothing about time at all, so one unreadable dose-time can never be
 *      silently dropped from the calculation;
 *   3. the single-clause lead reading (see curatedSlotFor).
 */
export function expectedSlotFor(rawTiming: string): Slot | null {
  if (timingIsAmbiguousByDesign(rawTiming)) return null;
  const full = normTiming(rawTiming);
  if (!full || timingStatesNoTime(full)) return null;
  const direct = CURATED_TIMING_SLOT[full];
  if (direct) return direct;
  const clauses = splitAnchorClauses(full);
  if (clauses.length > 1) {
    const found: Slot[] = [];
    let unreadableAnchor = false;
    for (const c of clauses) {
      const slot = curatedSlotFor(c);
      if (slot) found.push(slot);
      else if (!statesNoDoseTime(c)) {
        unreadableAnchor = true;
        break;
      }
    }
    if (!unreadableAnchor && found.length)
      return SLOT_ORDER.find((s) => found.includes(s)) ?? null;
  }
  return curatedSlotFor(full);
}

/** Vitamin letters — a lone "B" or "D" on a label IS the product's identity,
 *  so these survive the length-2 cut that drops other single characters. */
const VITAMIN_LETTERS = new Set(["a", "b", "c", "d", "e", "k"]);

/**
 * Identity tokens of a name: alphanumeric words, generic retail noise and bare
 * numbers dropped.
 *
 * Two normalisations, both from how supplement labels are actually written —
 * neither loosens what "same substance" means:
 *   - vitamin letter + number is one token however it's punctuated, so the
 *     plan's "B12" meets the label's "Methyl B-12";
 *   - a trailing plural "s" is dropped, so "Probiotics" meets "Probiotic".
 */
export function identityTokens(name: string): string[] {
  return str(name)
    .toLowerCase()
    .replace(/\b([abcdek])[\s-]?(\d{1,2})\b/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .filter(
      (t) =>
        (t.length >= 2 || VITAMIN_LETTERS.has(t)) &&
        !/^\d+$/.test(t) &&
        !GENERIC_PRODUCT_TOKENS.has(t),
    );
}

// Indexed through identityTokens so the synonym table and the names being
// compared are normalised identically (plurals, vitamin letter+number).
const SYNONYM_INDEX: Map<string, number[]> = (() => {
  const m = new Map<string, number[]>();
  PRODUCT_SYNONYMS.forEach((group, gi) => {
    for (const w of group)
      for (const k of identityTokens(w)) m.set(k, [...(m.get(k) ?? []), gi]);
  });
  return m;
})();

function synonymGroups(tokens: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of tokens) for (const gi of SYNONYM_INDEX.get(t) ?? []) out.add(gi);
  return out;
}

/** Do these two names name the same thing? True on a shared identity token, or
 *  on a shared hand-curated synonym group. */
export function namesShareIdentity(itemName: string, productName: string): boolean {
  const a = identityTokens(itemName);
  const b = identityTokens(productName);
  if (!a.length || !b.length) return false;
  const bs = new Set(b);
  if (a.some((t) => bs.has(t))) return true;
  const ga = synonymGroups(a);
  if (!ga.size) return false;
  for (const gi of synonymGroups(b)) if (ga.has(gi)) return true;
  return false;
}

/** Loose word-level overlap for matching a PLAN item to its PAYLOAD row (the
 *  payload renames things for the client: brand stripped, slug humanised). Not
 *  a correctness assertion — only a join key, so it is deliberately generous. */
function sharesWord(a: string, b: string): boolean {
  const ta = new Set(identityTokens(a).filter((t) => t.length >= 3));
  return identityTokens(b).some((t) => t.length >= 3 && ta.has(t));
}

/** Letters+digits only — for comparing two strings that should be the same
 *  text modulo punctuation/spacing (slot names, dish cells). */
function squash(s: string): string {
  return str(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Every word of `part` also a word of `whole`?
 *
 *  Asserts a rendered component really came out of its dish WITHOUT re-running
 *  the splitter. Deliberately word-set, not substring: the splitter lifts the
 *  portion out of the MIDDLE of a component ("lime juice (1 tsp) pre-meal shot"
 *  → title "lime juice pre-meal shot"), so a contiguous-substring test flags
 *  every correctly-parsed dish. Word-set still catches the failure that
 *  matters — a component naming a food the dish never contained. */
function wordsSubsetOf(part: string, whole: string): boolean {
  const hay = new Set(str(whole).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const words = str(part).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => hay.has(w));
}

function add(list: ParityFinding[], f: ParityFinding): void {
  list.push(f);
}

// ────────────────────────────────── PRESENCE ───────────────────────────────

/** What the client should see TODAY for a supplement, from the plan's own
 *  phase fields. Hand-derived from the prescribing meaning ("you take it from
 *  its start week until the course ends"), not from the builder. */
function expectedPhase(
  startWeek: number,
  durationWeeks: number,
  currentWeek: number,
): "current" | "future" | "finished" {
  if (durationWeeks > 0 && currentWeek >= startWeek + durationWeeks) return "finished";
  return currentWeek >= startWeek ? "current" : "future";
}

function checkSupplementPresence(plan: Dict, app: ParityAppData, out: ParityFinding[]): void {
  const protocol = arr(plan.supplement_protocol);
  const week = Number(app.client?.week) || 0;
  protocol.forEach((p, i) => {
    const slug = str(p.supplement_slug);
    const label = str(p.display_name) || slug || `#${i + 1}`;
    const id = `s-${slug || i}`;
    const inAll =
      app.allSupplements.find((s) => s.id === id) ??
      app.allSupplements.find((s) => sharesWord(s.name, str(p.display_name) || slug));
    if (!inAll) {
      add(out, {
        family: "presence",
        severity: "error",
        code: "supplement-missing",
        item: label,
        expected: "present in allSupplements",
        actual: "absent",
        detail: `Plan prescribes ${label} but it is nowhere in the client payload.`,
      });
      return;
    }
    const phase = expectedPhase(Number(p.start_week) || 1, Number(p.duration_weeks) || 0, week);
    const inToday = app.supplements.some((s) => s.id === inAll.id);
    if (phase === "current" && !inToday) {
      add(out, {
        family: "presence",
        severity: "error",
        code: "supplement-not-in-today",
        item: label,
        expected: `in today's routine (week ${week}, starts week ${p.start_week ?? 1})`,
        actual: `status "${inAll.status ?? "?"}"`,
        detail: `${label} is live this week but is missing from the client's daily supplements.`,
      });
    }
    if (phase !== "current" && inToday) {
      add(out, {
        family: "presence",
        severity: "error",
        code: "supplement-leaked-into-today",
        item: label,
        expected: phase === "future" ? "not started yet" : "course finished",
        actual: "shown in today's routine",
        detail: `${label} (${phase}) is being shown as a supplement to take today.`,
      });
    }
  });
}

function checkMenuPresence(plan: Dict, app: ParityAppData, out: ParityFinding[]): void {
  const menu = (plan.app_menu ?? {}) as Dict;
  const weeks = arr(menu.weeks);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const w of weeks) {
    const wkNo = Number(w.week) || 1;
    const payloadWeek = app.weekMenus.find((m) => m.week === wkNo);
    const days = arr(w.days);
    if (!payloadWeek) {
      if (days.some((d) => arr(d.slots).some((s) => str(s.dish).trim())))
        add(out, {
          family: "presence",
          severity: "error",
          code: "menu-week-missing",
          item: `week ${wkNo}`,
          expected: `week ${wkNo} in weekMenus`,
          actual: `weeks present: ${app.weekMenus.map((m) => m.week).join(", ") || "none"}`,
          detail: `The plan authors a menu for week ${wkNo} but the app carries no such week.`,
        });
      continue;
    }
    days.forEach((d, di) => {
      const payloadDay = payloadWeek.days[di];
      for (const s of arr(d.slots)) {
        const dish = str(s.dish).trim();
        const slotName = str(s.slot).trim();
        if (!dish) continue;
        // The builder drops bedtime rows on purpose — a bedtime drink belongs
        // to the supplement/remedy surfaces, not the meal grid.
        if (/bedtime/i.test(slotName)) continue;
        const where = `week ${wkNo} · ${DOW[di] ?? `day ${di + 1}`} · ${slotName}`;
        const row = payloadDay?.slots.find(
          (x) => squash(x.slot) === squash(slotName.replace(/\s*\([^)]*\)\s*$/, "")),
        );
        if (!row) {
          add(out, {
            family: "presence",
            severity: "error",
            code: "menu-slot-missing",
            item: dish,
            where,
            expected: `${slotName} on the client's menu`,
            actual: payloadDay ? payloadDay.slots.map((x) => x.slot).join(", ") || "no slots" : "day absent",
            detail: `The plan feeds this client "${dish}" at ${where}; the app shows no such slot.`,
          });
          continue;
        }
        if (squash(row.dish) !== squash(dish)) {
          add(out, {
            family: "presence",
            severity: "error",
            code: "menu-dish-altered",
            item: dish,
            where,
            expected: dish,
            actual: row.dish,
            detail: `The dish the client sees at ${where} is not the dish the plan prescribes.`,
          });
        }
        const comps = row.components ?? [];
        if (!comps.length) {
          add(out, {
            family: "presence",
            severity: "error",
            code: "menu-components-empty",
            item: dish,
            where,
            expected: "≥1 component",
            actual: "none",
            detail: `The dish at ${where} renders with no components — the client sees an empty card.`,
          });
        }
        for (const c of comps) {
          if (!squash(c.title)) continue;
          if (!wordsSubsetOf(c.title, dish))
            add(out, {
              family: "presence",
              severity: "error",
              code: "menu-component-foreign",
              item: c.title,
              where,
              expected: `a part of "${dish}"`,
              actual: c.title,
              detail: `Component "${c.title}" shown at ${where} names food the prescribed dish does not contain.`,
            });
        }
      }
    });
  }
}

/** A drink/practice can legitimately be routed OFF the practices list — the
 *  builder moves CCF tea to remedies, seed cycling to its own computed card,
 *  ginger-for-cramps to the cycle-timed card, and guided techniques to
 *  breathwork/eft/sleep. Presence therefore means "accounted for ANYWHERE the
 *  client can see it", not "in practices[]". */
function practiceAccountedFor(name: string, app: ParityAppData): boolean {
  if (app.practices.some((p) => sharesWord(p.name, name))) return true;
  if (app.remedies.some((r) => sharesWord(r.name, name) || sharesWord(r.also ?? "", name))) return true;
  if (/seed.?cycl/i.test(name) && app.seedCycling) return true;
  if (/ginger/i.test(name) && /cramp|period|menstru/i.test(name) && app.periodCare) return true;
  if (/breath|pranayam/i.test(name) && app.breathwork) return true;
  if (/tapping|\beft\b/i.test(name) && (app.eft || app.mindBody)) return true;
  if (/sleep|wind.?down/i.test(name) && (app.sleep || app.mindBody)) return true;
  return false;
}

/** The two guided techniques the mind-body drip can hide deliberately, and the
 *  coach's own words for each. The override lives on the client as
 *  `mindbody_<key>`: set to `locked` it suppresses the card, the checklist row
 *  AND the "unlocks soon" nudge, so the practice is legitimately invisible.
 *  Without the client record we cannot tell locked from lost — hence warn. */
const DRIPPABLE_TECHNIQUES: { key: "eft" | "sleep"; matches: RegExp }[] = [
  { key: "eft", matches: /tapping|\beft\b/i },
  { key: "sleep", matches: /wind.?down|sleep routine|sleep hygiene/i },
];

function checkPracticePresence(
  plan: Dict,
  app: ParityAppData,
  client: Dict | null | undefined,
  out: ParityFinding[],
): void {
  for (const p of arr(plan.lifestyle_practices)) {
    const name = str(p.name).trim();
    if (!name) continue;
    if (practiceAccountedFor(name, app)) continue;
    const tech = DRIPPABLE_TECHNIQUES.find((t) => t.matches.test(name));
    // Coach-locked: the client is meant not to see this yet. Nothing to report.
    if (tech && str(client?.[`mindbody_${tech.key}`]).trim().toLowerCase() === "locked") continue;
    const drippable = Boolean(tech);
    add(out, {
      family: "presence",
      severity: drippable ? "warn" : "error",
      code: drippable ? "practice-missing-drippable" : "practice-missing",
      item: name,
      expected: "on the client's practices list (or its own card)",
      actual: "absent",
      detail: drippable
        ? `Practice "${name}" is prescribed but nowhere in the payload — legitimate only if the coach locked this mind-body technique.`
        : `Practice "${name}" is prescribed but the client never sees it.`,
    });
  }
}

function checkRemedyPresence(plan: Dict, app: ParityAppData, out: ParityFinding[]): void {
  const nutrition = (plan.nutrition ?? {}) as Dict;
  const ayur = (plan.ayurveda ?? {}) as Dict;
  const slugs = [...new Set([...strArr(nutrition.home_remedies), ...strArr(ayur.remedies)])];
  for (const slug of slugs) {
    if (app.remedies.some((r) => r.slug === slug)) continue;
    add(out, {
      family: "presence",
      severity: "error",
      code: "remedy-missing",
      item: slug,
      expected: "an assigned remedy card",
      actual: `remedies: ${app.remedies.map((r) => r.slug).join(", ") || "none"}`,
      detail: `Plan assigns remedy "${slug}" but the client payload has no such remedy (usually a slug the catalogue no longer has).`,
    });
  }
}

// ────────────────────────────────── PLACEMENT ──────────────────────────────

function checkPlacement(plan: Dict, app: ParityAppData, out: ParityFinding[]): void {
  // one info line per distinct phrase per client, whichever kind it is
  const seenTimingPhrase = new Set<string>();
  arr(plan.supplement_protocol).forEach((p, i) => {
    const slug = str(p.supplement_slug);
    const label = str(p.display_name) || slug || `#${i + 1}`;
    const raw = str(p.timing);
    const key = normTiming(raw);
    const row =
      app.allSupplements.find((s) => s.id === `s-${slug || i}`) ??
      app.allSupplements.find((s) => sharesWord(s.name, str(p.display_name) || slug));
    if (!row) return; // PRESENCE already reported it
    // No time stated at all: the coach left it open on purpose, so there is no
    // group to be right or wrong about. Reported apart from the phrases we
    // simply could not read, and left out of the coverage denominator.
    if (timingStatesNoTime(raw)) {
      const openKey = key || "(blank)";
      if (!seenTimingPhrase.has(openKey)) {
        seenTimingPhrase.add(openKey);
        add(out, {
          family: "placement",
          severity: "info",
          code: "timing-unspecified",
          item: label,
          actual: row.slot,
          detail: raw.trim()
            ? `Timing "${raw}" states no time of day — the coach left it open, so placement is not assertable.`
            : `${label} carries no timing at all in the plan — placement is not assertable.`,
        });
      }
      return;
    }
    const expected = expectedSlotFor(raw);
    if (!expected) {
      if (key && !seenTimingPhrase.has(key)) {
        seenTimingPhrase.add(key);
        add(out, {
          family: "placement",
          severity: "info",
          code: "timing-unclassified",
          item: label,
          actual: row.slot,
          detail: `Timing "${raw}" is not in the curated table — placement unverified. Add it there if the right group is unambiguous.`,
        });
      }
      return;
    }
    if (row.slot !== expected)
      add(out, {
        family: "placement",
        severity: "error",
        code: "slot-mismatch",
        item: label,
        expected,
        actual: row.slot,
        detail: `Coach wrote "${raw}" — the client must find ${label} under ${expected}, but the app files it under ${row.slot}.`,
      });
  });
}

// ──────────────────────────────────── TARGET ───────────────────────────────

function checkTarget(app: ParityAppData, opts: ParityOpts, out: ParityFinding[]): void {
  const lookup = opts.productNameForUrl;
  if (!lookup) return;
  const items: { name: string; url: string; kind: string }[] = [
    ...app.allSupplements.filter((s) => s.buyUrl).map((s) => ({ name: s.name, url: s.buyUrl!, kind: "supplement" })),
    ...app.remedies.filter((r) => r.buyUrl).map((r) => ({ name: r.name, url: r.buyUrl!, kind: "remedy" })),
  ];
  for (const it of items) {
    const resolved = lookup(it.url);
    const names = (typeof resolved === "string" ? [resolved] : resolved ?? []).filter(Boolean);
    if (!names.length) continue; // not a catalogue product (coach override / search) — nothing to assert
    if (names.some((n) => namesShareIdentity(it.name, n))) continue;
    add(out, {
      family: "target",
      severity: "error",
      code: "buy-link-mismatch",
      item: it.name,
      expected: `a product that IS ${it.name}`,
      actual: names.join(" / "),
      detail: `The ${it.kind} "${it.name}" links the client to "${names.join(" / ")}" — the names share no word and no known synonym, so this is very likely the wrong bottle.`,
    });
  }
}

// ─────────────────────────────────── entry ─────────────────────────────────

/**
 * Compare what the plan promises against what the client's app payload
 * carries. Returns every discrepancy; an empty array means parity.
 */
export function checkPlanAppParity(
  plan: Dict,
  app: ParityAppData,
  opts: ParityOpts = {},
): ParityFinding[] {
  const out: ParityFinding[] = [];
  checkSupplementPresence(plan, app, out);
  checkMenuPresence(plan, app, out);
  checkPracticePresence(plan, app, opts.client, out);
  checkRemedyPresence(plan, app, out);
  checkPlacement(plan, app, out);
  checkTarget(app, opts, out);
  return out;
}

export function countBySeverity(findings: ParityFinding[]): Record<ParitySeverity, number> {
  const c: Record<ParitySeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

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
 *               the parser is wrong. Phrases absent from the table are reported
 *               unclassified, never guessed.
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
 *  coverage bookkeeping (an unclassified timing phrase), never a defect. */
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
}

type Dict = Record<string, unknown>;

// ───────────────────────── ground truth: timing → slot ─────────────────────
//
// Hand-written from the clinical meaning of each phrase, NOT from the parser.
// The app collapses the day into three groups the client sees — Morning /
// With meals / Bedtime — so each entry answers: "a coach wrote this on the
// plan; which of those three headings must the client find it under?"
//
// Membership rule: only phrases where the answer is beyond argument. Anything
// with two anchors ("morning and/or bedtime"), no anchor ("anytime", "away
// from tea/coffee") or a genuinely ambiguous one ("between meals", "before
// food") is deliberately ABSENT — it gets reported unclassified instead of
// silently guessed. Every string below is a real coach phrase from the live
// corpus (surveyed 2026-07-26), normalised by normTiming().
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
  "empty stomach": "Morning",
  "before breakfast": "Morning",
  "30 minutes before breakfast": "Morning",
  "mid-morning": "Morning",
  "mid morning": "Morning",

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
  "with a fat-containing meal": "With meals",
  "with lunch or dinner": "With meals",
  "30 min before dinner": "With meals",
  "~30 min before dinner": "With meals",
  lunch: "With meals",
};

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
 * unmistakable cue words — it is used only to REFUSE to classify, never to
 * classify: two families in one phrase ("morning on empty stomach and at
 * bedtime") means the phrase has no single answer and must stay unverified.
 */
const ANCHOR_CUES: [string, RegExp][] = [
  ["morning", /\bmorning\b|\bbreakfast\b|\bwaking\b|empty stomach/],
  ["midday", /\blunch\b|\bmidday\b|\bnoon\b/],
  ["evening", /\bdinner\b|\bevening\b|\bsupper\b/],
  ["bedtime", /\bbedtime\b|before bed\b|\bnight\b|\bsleep\b|\bretiring\b/],
];

function anchorFamilies(t: string): Set<string> {
  const out = new Set<string>();
  for (const [fam, re] of ANCHOR_CUES) if (re.test(t)) out.add(fam);
  return out;
}

/**
 * The slot a coach phrase must land in, or null when this phrase has no
 * single unambiguous answer.
 *
 * Two lookups, both against the CURATED table — never against the parser:
 *   1. the whole phrase;
 *   2. its leading clause, when the coach appended detail
 *      ("With lunch (largest carb meal)", "Bedtime, with a full glass of
 *      water"). The lead only counts when the trailing detail introduces no
 *      time-of-day the lead doesn't already name — otherwise "with food
 *      (morning)" would be read as a meal item when the coach said morning.
 *
 * Anything mentioning two times of day is refused outright: the app shows one
 * group per supplement, so there is no single correct answer to assert.
 */
export function expectedSlotFor(rawTiming: string): "Morning" | "With meals" | "Bedtime" | null {
  const full = normTiming(rawTiming);
  if (!full) return null;
  const famFull = anchorFamilies(full);
  if (famFull.size > 1) return null;
  if (CURATED_TIMING_SLOT[full]) return CURATED_TIMING_SLOT[full];
  const lead = normTiming(full.split(/\s*[(;,]|\s-\s/)[0]);
  if (!lead || lead === full) return null;
  const famLead = anchorFamilies(lead);
  for (const f of famFull) if (!famLead.has(f)) return null;
  return CURATED_TIMING_SLOT[lead] ?? null;
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

/** The two guided techniques the mind-body drip can hide deliberately (coach
 *  sets mindbody_<tech> = locked, and then even the "unlocks soon" nudge is
 *  suppressed). Absence of these is a warn, not an error. */
const DRIPPABLE = /tapping|\beft\b|wind.?down|sleep routine|sleep hygiene/i;

function checkPracticePresence(plan: Dict, app: ParityAppData, out: ParityFinding[]): void {
  for (const p of arr(plan.lifestyle_practices)) {
    const name = str(p.name).trim();
    if (!name) continue;
    if (practiceAccountedFor(name, app)) continue;
    const drippable = DRIPPABLE.test(name);
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
  const seenUnclassified = new Set<string>();
  arr(plan.supplement_protocol).forEach((p, i) => {
    const slug = str(p.supplement_slug);
    const label = str(p.display_name) || slug || `#${i + 1}`;
    const raw = str(p.timing);
    const key = normTiming(raw);
    const row =
      app.allSupplements.find((s) => s.id === `s-${slug || i}`) ??
      app.allSupplements.find((s) => sharesWord(s.name, str(p.display_name) || slug));
    if (!row) return; // PRESENCE already reported it
    const expected = expectedSlotFor(raw);
    if (!expected) {
      if (key && !seenUnclassified.has(key)) {
        seenUnclassified.add(key);
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
  checkPracticePresence(plan, app, out);
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

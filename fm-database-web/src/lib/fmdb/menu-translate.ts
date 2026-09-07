/**
 * menu-translate.ts — deterministic, zero-cost translation of a client's weekly
 * menu into a target language for the printable "kitchen sheet" (a page the
 * client prints and hands to the household cook / domestic help).
 *
 * WHY DETERMINISTIC, NOT AI. The client app at /app/<token> reads YAML off disk
 * and renders — it cannot shell out to Python and must never make a live AI call
 * per view (cost + latency). An Indian menu barely needs "translation" anyway: it
 * needs TRANSLITERATION plus a small glossary. "Jowar roti (2) + Dal tadka
 * (1 katori)" for a cook is "ज्वार रोटी (2) + दाल तड़का (1 कटोरी)". The dish names
 * are already Indian; only the recipe STEPS are English prose that genuinely need
 * translating, and those are authored once per recipe in chat at $0 and stored on
 * the recipe YAML. So this module COMPOSES the translated menu from:
 *   1. a per-language glossary (slot labels, day names, units/portions, and a
 *      terms map of common foods + dish names), and
 *   2. the recipe pack's own pre-authored Hindi names.
 *
 * HONESTY OVER COVERAGE. A component only renders in the target language when it
 * FULLY resolves — every non-connective word is accounted for. A half-translated
 * dish is worse than a clean English one, so anything unresolved keeps its English
 * text and is COUNTED, so the sheet can say "N items shown in English" rather than
 * silently dropping or garbling. This mirrors dish-components' "every word must be
 * accounted for" rule.
 *
 * Pure (no fs, no server-only) so the composer and its tests share it. The loader
 * (kitchen-sheet.ts) reads the glossary + app data and calls in here.
 */

import { recipeLibKey } from "./dish-components";
import type { AppWeekMenu, AppRecipe } from "./client-app";

/** A field carried in both languages so the sheet can print them side by side —
 *  the client (who reads English) can cross-check what the cook reads. `hi` is
 *  absent when the term did not fully resolve. */
export interface Bilingual {
  en: string;
  hi?: string;
}

export interface TranslatedComponent {
  title: Bilingual;
  portion?: Bilingual;
}
export interface TranslatedSlot {
  slot: Bilingual;
  components: TranslatedComponent[];
}
export interface TranslatedDay {
  dow: Bilingual;
  dateLabel?: string;
  slots: TranslatedSlot[];
}
export interface TranslatedWeek {
  week: number;
  current: boolean;
  days: TranslatedDay[];
}

export interface TranslatedRecipe {
  title: Bilingual;
  serves?: string;
  time?: string;
  ingredients: { en: string; hi?: string }[];
  method: { en: string; hi?: string }[];
  tip?: string;
  imageUrl?: string;
  imageCredit?: string;
}

/** How much of the menu resolved — drives the honest "N shown in English" note. */
export interface Coverage {
  components: number;
  translated: number;
}

/** The parsed, normalized glossary for one language. All keys are lowercased. */
export interface Glossary {
  lang: string;
  langName: string;
  slots: Record<string, string>;
  units: Record<string, string>;
  days: Record<string, string>;
  ui: Record<string, string>;
  /** foods + dish names, longest-phrase-matched. */
  terms: Record<string, string>;
}

type RawGlossary = {
  _meta?: { lang?: string; name?: string };
  slots?: Record<string, unknown>;
  units?: Record<string, unknown>;
  days?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  terms?: Record<string, unknown>;
};

const lc = (s: string) => s.toLowerCase().trim();
const normMap = (m: Record<string, unknown> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    const val = typeof v === "string" ? v.trim() : "";
    if (val) out[lc(k)] = val;
  }
  return out;
};

/** Turn a raw parsed YAML glossary into the typed, normalized shape. */
export function normalizeGlossary(raw: RawGlossary | null | undefined): Glossary {
  return {
    lang: raw?._meta?.lang ?? "hi",
    langName: raw?._meta?.name ?? "हिंदी",
    slots: normMap(raw?.slots),
    units: normMap(raw?.units),
    days: normMap(raw?.days),
    ui: normMap(raw?.ui),
    terms: normMap(raw?.terms),
  };
}

/** Connective / filler words that carry no food meaning: skipped when matching a
 *  title, never a reason to fail. Prep words that DO carry meaning (roasted,
 *  steamed…) live in the glossary `terms` instead so they translate. */
const SKIPPABLE = new Set([
  "with", "and", "the", "for", "or", "of", "a", "an", "in", "to", "on", "at",
  "style", "homemade", "home", "fresh", "plain", "light", "simple", "everyday",
  "seasonal", "healthy", "healing", "detox", "cleansing", "served", "warm", "hot",
  "cold", "some", "little", "bit", "your", "our", "special",
  // texture / preparation descriptors a cook doesn't need spelled out — skipping
  // them lets the core food noun resolve ("soft wheat roti" → "गेहूँ रोटी").
  "soft", "peeled", "cooked", "room", "temperature", "well", "cut", "chopped",
  "grated", "split", "whole", "sliced", "diced", "raw", "fine", "finely",
]);

/** Build the merged name→hi index the composer matches dish titles against: the
 *  glossary `terms` plus every pack recipe's pre-authored Hindi name (keyed by
 *  its English title). Recipe names win over glossary terms on a key collision —
 *  the recipe is the more specific answer. Returns the map plus the longest
 *  phrase length in it (for longest-phrase matching). */
export function buildTermIndex(
  glossary: Glossary,
  recipes: AppRecipe[],
): { index: Record<string, string>; maxWords: number } {
  const index: Record<string, string> = { ...glossary.terms };
  for (const r of recipes) {
    const hiName = r.translations?.[glossary.lang]?.name;
    if (!hiName) continue;
    const key = recipeLibKey(r.title);
    if (key) index[key] = hiName.trim();
  }
  let maxWords = 1;
  for (const k of Object.keys(index)) {
    const n = k.split(" ").length;
    if (n > maxWords) maxWords = n;
  }
  return { index, maxWords };
}

/**
 * Translate a clean component title (portion already lifted off it). Returns the
 * target-language string only when EVERY non-skippable word is accounted for by
 * a term in the index; otherwise undefined (caller keeps the English + counts it
 * as untranslated). Longest-phrase-first so "mixed vegetables" beats "mixed" +
 * "vegetables".
 */
export function translateTitle(
  title: string,
  index: Record<string, string>,
  maxWords: number,
): string | undefined {
  const key = recipeLibKey(title);
  if (!key) return undefined;
  if (index[key]) return index[key]; // whole-title hit (incl. recipe names)

  const toks = key.split(" ").filter(Boolean);
  const pieces: string[] = [];
  let matchedFood = false;
  for (let i = 0; i < toks.length; ) {
    let span = 0;
    for (let n = Math.min(maxWords, toks.length - i); n >= 1; n--) {
      const phrase = toks.slice(i, i + n).join(" ");
      if (index[phrase]) {
        pieces.push(index[phrase]);
        span = n;
        matchedFood = true;
        break;
      }
    }
    if (span) {
      i += span;
      continue;
    }
    if (SKIPPABLE.has(toks[i]) || toks[i].length < 2) {
      i++;
      continue;
    }
    return undefined; // an unaccounted-for word — refuse rather than garble
  }
  return matchedFood ? pieces.join(" ") : undefined;
}

const NUMERIC_RE = /^[\d½¼¾⅓⅔⅕⅖⅗⅘.,\-–/x×]+$/;

/**
 * Translate a portion string ("2 katori", "½ cup", "1 glass buttermilk"). Numbers
 * and fractions pass through; units and foods translate via the glossary; unknown
 * tokens are kept verbatim. Best-effort by design — portions are short and low
 * risk, and a leftover English word beside a number is harmless.
 */
export function translatePortion(portion: string, glossary: Glossary): string {
  const parts = portion.trim().split(/\s+/).filter(Boolean);
  return parts
    .map((p) => {
      if (NUMERIC_RE.test(p)) return p;
      const k = lc(p.replace(/[^a-z½¼¾]/gi, ""));
      return glossary.units[k] ?? glossary.terms[k] ?? p;
    })
    .join(" ");
}

/** Slot label ("Breakfast", "Mid-morning", "Evening snack") → target language.
 *  Hyphens folded to spaces so "Mid-morning" keys as "mid morning". */
export function translateSlot(label: string, glossary: Glossary): string | undefined {
  return glossary.slots[lc(label).replace(/-/g, " ").replace(/\s+/g, " ")];
}

export function translateDay(dow: string, glossary: Glossary): string | undefined {
  return glossary.days[lc(dow)];
}

/** Translate one week's menu. `week.days[].slots[].components` are already split
 *  by the app; we only translate. Returns the bilingual week + a coverage tally. */
export function translateWeek(
  week: AppWeekMenu,
  glossary: Glossary,
  index: Record<string, string>,
  maxWords: number,
  cov: Coverage,
): TranslatedWeek {
  return {
    week: week.week,
    current: week.current,
    days: week.days.map((day) => ({
      dow: { en: day.dow, hi: translateDay(day.dow, glossary) },
      dateLabel: day.dateLabel,
      slots: day.slots.map((slot) => {
        const comps = slot.components ?? [{ title: slot.dish }];
        return {
          slot: { en: slot.slot, hi: translateSlot(slot.slot, glossary) },
          components: comps.map((c) => {
            cov.components += 1;
            const hi = translateTitle(c.title, index, maxWords);
            if (hi) cov.translated += 1;
            return {
              title: { en: c.title, hi },
              portion: c.portion
                ? { en: c.portion, hi: translatePortion(c.portion, glossary) }
                : undefined,
            };
          }),
        };
      }),
    })),
  };
}

/** Translate one recipe using its pre-authored language block (from the recipe
 *  YAML). Ingredients/method fall back to English line-for-line when a language
 *  block is missing or shorter — the English is always shown alongside. */
export function translateRecipe(recipe: AppRecipe, glossary: Glossary): TranslatedRecipe {
  const t = recipe.translations?.[glossary.lang];
  const hiName = t?.name ?? translateTitle(recipe.title, { ...glossary.terms }, phraseMax(glossary.terms));
  return {
    title: { en: recipe.title, hi: hiName || undefined },
    serves: recipe.serves,
    time: recipe.time,
    ingredients: recipe.ingredients.map((en, i) => ({ en, hi: t?.ingredients?.[i] })),
    method: recipe.method.map((en, i) => ({ en, hi: t?.method?.[i] })),
    tip: recipe.tip,
    imageUrl: recipe.imageUrl,
    imageCredit: recipe.imageCredit,
  };
}

function phraseMax(terms: Record<string, string>): number {
  let m = 1;
  for (const k of Object.keys(terms)) {
    const n = k.split(" ").length;
    if (n > m) m = n;
  }
  return m;
}

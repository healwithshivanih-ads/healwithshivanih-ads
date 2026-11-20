/**
 * Grams of protein, carbs, fat and fibre on the client's menu — pure, no I/O.
 *
 * WHY (coach, 20 Nov 2026, docs/client-app-redesign/BUILD-PLAN.md "Nutrients
 * and daily targets"): the new app shows these four in grams on every dish it
 * suggests, and the day's menu total. Calories are not shown.
 *
 * HONESTY RULES
 *  - A number comes only from a library recipe's own figures
 *    (nutrients_per_serving, computed from its ingredients), and only when
 *    that computation covered at least MIN_COVERAGE of the recipe by weight.
 *    A component with no such recipe gets no number — never the rough
 *    fallback table a coach screen may use.
 *  - Garnish, tempering, water and supplements count as nothing, not as
 *    missing.
 *  - A meal or day with any missing component is marked `complete: false`;
 *    the screen then says "about" and names nothing as missed.
 */

export interface Macros {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

export interface MealMacros extends Macros {
  /** every counted component had a recipe figure */
  complete: boolean;
}

/** Below this, a recipe's figures leave out too much of it to show. */
export const MIN_COVERAGE = 90;

export const MACRO_KEYS = ["protein_g", "carbs_g", "fat_g", "fibre_g"] as const;

/** A recipe's per-serving macros, or null when they are missing or too thin. */
export function macrosFromServing(per: Record<string, unknown> | null | undefined, coveragePct: unknown): Macros | null {
  if (!per || typeof per !== "object") return null;
  const cov = Number(coveragePct);
  if (!Number.isFinite(cov) || cov < MIN_COVERAGE) return null;
  const out = {} as Macros;
  for (const k of MACRO_KEYS) {
    const v = Number((per as Record<string, unknown>)[k]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

export type MacroLookup = (component: string) => Macros | null;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name → macros, longest recipe name first so "coconut curd" beats "curd".
 *  Same matching as the calorie lookup (calorie-estimate.ts), so a dish gets
 *  its grams from the recipe its calories already come from. */
export function buildMacroLookup(recipes: { title: string; aliases?: string[]; macros?: Macros }[]): MacroLookup {
  const idx: { name: string; m: Macros }[] = [];
  for (const r of recipes) {
    if (!r.macros) continue;
    for (const n of [r.title, ...(r.aliases ?? [])]) {
      const name = norm(n || "");
      if (name.length >= 5) idx.push({ name, m: r.macros });
    }
  }
  idx.sort((a, b) => b.name.length - a.name.length);
  return (component: string) => {
    const c = norm(component);
    if (c.length < 5) return null;
    for (const e of idx) if (c === e.name || ` ${c} `.includes(` ${e.name} `)) return e.m;
    return null;
  };
}

/** Components that carry no meaningful macros: supplements, water, garnish
 *  and tempering. Counted as zero, never as missing — but only when EVERY word
 *  is one of these, so "moong dal with ginger" is still a dish. */
const NOTHING_WORD =
  /^(magnesium|glycinate|capsules?|tablets?|supplements?|probiotics?|omega|vitamins?|sublingual|water|warm|plain|lemon|lime|ginger|garlic|coriander|cilantro|mint|curry|leaf|leaves|hing|asafoetida|turmeric|haldi|cumin|mustard|seeds?|jeera|tempering|tadka|garnish|herbs?|spices?|masala|rock|black|salt|pepper|chill?ies|chill?i|to|taste|pinch|squeeze|drizzle|sprinkle|seasoning|fresh|few|a|of|and|with|some|crushed|chopped|grated|juice|slice|slices|clove|cloves|sprig|sprigs)$/;

export function isNothing(component: string): boolean {
  const words = norm(component).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => NOTHING_WORD.test(w));
}

/** One menu cell ("A + B + C") → its macros. null when nothing in it has a
 *  figure (the screen then shows no numbers for that meal). */
export function mealMacros(cell: string, lookup: MacroLookup): MealMacros | null {
  const sum: Macros = { protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  let found = 0;
  let missing = 0;
  for (const raw of (cell || "").split(/\s*\+\s*/)) {
    const c = raw.trim();
    if (!c) continue;
    const m = lookup(c);
    if (m) {
      found += 1;
      for (const k of MACRO_KEYS) sum[k] += m[k];
    } else if (!isNothing(c)) {
      missing += 1;
    }
  }
  if (!found) return null;
  return { ...roundMacros(sum), complete: missing === 0 };
}

export function roundMacros(m: Macros): Macros {
  return {
    protein_g: Math.round(m.protein_g),
    carbs_g: Math.round(m.carbs_g),
    fat_g: Math.round(m.fat_g),
    fibre_g: Math.round(m.fibre_g),
  };
}

/** The day's menu total. `complete` only when every meal was complete AND
 *  every meal had numbers. */
export function dayMacros(meals: { macros?: MealMacros | null }[]): MealMacros | null {
  const sum: Macros = { protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  let any = false;
  let complete = true;
  for (const m of meals) {
    if (!m.macros) {
      complete = false;
      continue;
    }
    any = true;
    if (!m.macros.complete) complete = false;
    for (const k of MACRO_KEYS) sum[k] += m.macros[k];
  }
  return any ? { ...roundMacros(sum), complete } : null;
}

/** "Protein 18 g · Carbs 42 g · Fat 9 g · Fibre 6 g" */
export function gramsLine(m: Macros): string {
  return `Protein ${m.protein_g} g · Carbs ${m.carbs_g} g · Fat ${m.fat_g} g · Fibre ${m.fibre_g} g`;
}

/** One meal's line; "About:" in front when part of it has no figure. */
export function macroLine(m: MealMacros): string {
  return m.complete ? gramsLine(m) : `About: ${gramsLine(m)}`;
}

/** The coach's per-client switch (client.yaml#app_nutrients). Set → that.
 *  Unset → on, except for a "gentle" client (anxiety, SSRI/benzo or
 *  eating-disorder signal; food-diary-balance.ts diaryGentle), who never sees
 *  grams unless the coach turns them on. */
export function nutrientsShown(client: Record<string, unknown> | null | undefined, gentle: boolean): boolean {
  const v = (client as { app_nutrients?: unknown } | null)?.app_nutrients;
  if (typeof v === "boolean") return v;
  return !gentle;
}

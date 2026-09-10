/**
 * Re-derive a recipe's nutrients after ingredients have been taken OUT of it.
 *
 * A per-client adaptation (recipe-adapt.ts) removes the foods that client
 * avoids. Left alone, the recipe keeps the catalogue's stored figures, so an
 * aloo sabzi shown without its potato still reported the potato's calories.
 * Small for a tempering onion; not small for potato, beetroot or paneer.
 *
 * ── Why this is not a second copy of the engine ────────────────────────────
 *
 * The Python engine (scripts/nutrients_lib.py) computes totals as a plain
 * LINEAR SUM over ingredient lines:
 *
 *     totals[k] = Σ  per_100g[key][k] × grams × factor / 100
 *
 * so it now records what each line contributed — `nutrient_lines: [{i, key, g}]`
 * with `factor` already folded into `g`. Removing a line is then exact
 * subtraction, and everything hard stays on the Python side: ingredient
 * normalisation, the alias index, quantity parsing, cup/piece densities, the
 * strained-drink and cooked-volume rules. None of that is reimplemented here.
 * This module multiplies and adds.
 *
 * The thresholds live in the shared table's `_meta`, read by both sides, and
 * `recipe-nutrients.test.ts` replays every recipe in the library through this
 * code with nothing removed and asserts it reproduces the stored block exactly.
 * If the two ever diverge, that test fails rather than a client's calorie count
 * quietly drifting.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "@/lib/fmdb/paths";

/** One ingredient line's contribution, as recorded by the Python engine. */
export interface NutrientLine {
  /** index into the recipe's `ingredients` */
  i: number;
  /** ingredient-table key, or null when the line matched nothing */
  key: string | null;
  /** grams of the ingredient — the mass coverage is measured against */
  g: number;
  /** nutrient factor when the engine discounted this line (a strained drink's
   *  spices, a cooked-volume legume). Absent means 1. Mass and nutrients use
   *  different grams, which is exactly the trap this field exists to avoid. */
  f?: number;
}

export interface RecomputedNutrients {
  perServing: Record<string, number>;
  coveragePct: number;
  richIn: string[];
}

interface TableEntry {
  per_100g?: Record<string, number>;
  /** Spellings this ingredient answers to. The single matching surface for
   *  ingredient identity across the codebase — food-cautions.ts reads them
   *  from here rather than keeping a second list. */
  aliases?: string[];
}
interface Threshold {
  field: string;
  min: number;
}
export interface LoadedTable {
  entries: Record<string, TableEntry>;
  nutrientKeys: string[];
  thresholds: Record<string, Threshold>;
  lowCoveragePct: number;
}

/**
 * Every catalogue food NAMED in a text, one key per MENTION.
 *
 * Mirrors `NutrientTable.match_all` in scripts/nutrients_lib.py; the two are
 * pinned together by food-cautions.test.ts.
 *
 * The nutrient engine asks a different question of the same index: "which food
 * IS this line?" — one key, longest alias wins, because an ingredient line is
 * exactly one food and counting it twice would double its calories. A safety
 * screen has to surface EVERY food a text names, or a dish naming two
 * cautioned foods reports only one of them.
 *
 * Longest-wins still applies PER MENTION and that half is load-bearing:
 * "foxtail millet" must resolve to `millet-foxtail` and never also to
 * `millet-generic`, because foxtail is deliberately uncautioned for goitrogens
 * (see _food_cautions.yaml) and re-flagging it would take away the millet that
 * is the safe substitute. A longest-first alternation scanned with matchAll
 * gives exactly that: non-overlapping matches, most specific name per mention.
 */
export interface FoodMatcher {
  foodsIn(text: string): Set<string>;
}

let matcherCache: Promise<FoodMatcher> | undefined;

export function loadFoodMatcher(): Promise<FoodMatcher> {
  matcherCache ??= (async () => {
    const table = await loadNutrientTable();
    const aliasIndex = new Map<string, string>();
    for (const [key, spec] of Object.entries(table?.entries ?? {})) {
      const own = key.replace(/-/g, " ");
      if (!aliasIndex.has(own)) aliasIndex.set(own, key);
      for (const a of spec.aliases ?? []) {
        const s = String(a).toLowerCase();
        if (!aliasIndex.has(s)) aliasIndex.set(s, key);
      }
    }
    // Terms under 4 characters are skipped — the shortest alias for `chicken`
    // is "leg", which would fire on "drumstick leaves". Same guard both sides.
    //
    // Aliases naming MORE THAN ONE food are skipped too. The table carries 27
    // of them, pasted in from ingredient lines: `kale` has the literal alias
    // "kale, swiss chard leaves". Being the longest thing that matches, such an
    // alias claims the whole span and the second food inside it never surfaces.
    // The test is structural rather than a blocklist — a real compound name
    // ("sweet potato") never contains a comma or a standalone and/or, and a
    // rule like "contains another key's alias" would wrongly drop that one.
    // Mirrors NutrientTable._MULTI_FOOD_ALIAS in scripts/nutrients_lib.py.
    const multiFood = /,|\b(?:and|or|plus)\b/;
    const usable = [...aliasIndex.keys()]
      .filter((a) => a.length >= 4 && !multiFood.test(a))
      .sort((a, b) => b.length - a.length);
    const scanner = usable.length
      ? new RegExp(
          `(?<![a-z])(${usable.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:e?s)?(?![a-z])`,
          "g",
        )
      : null;
    return {
      foodsIn(text: string): Set<string> {
        const out = new Set<string>();
        const s = String(text ?? "").toLowerCase();
        if (!s.trim() || !scanner) return out;
        const exact = aliasIndex.get(s);
        if (exact) out.add(exact);
        for (const m of s.matchAll(scanner)) {
          const k = aliasIndex.get(m[1]);
          if (k) out.add(k);
        }
        return out;
      },
    };
  })();
  return matcherCache;
}

/** Test seam — the matcher caches the compiled alternation for the process. */
export function __resetFoodMatcher(): void {
  matcherCache = undefined;
}

let cached: Promise<LoadedTable | null> | undefined;

/** The ingredient table, read once. Server-side only — this is the same file
 *  the Python engine reads, not a generated copy. */
export function loadNutrientTable(): Promise<LoadedTable | null> {
  cached ??= (async () => {
    try {
      const file = path.join(getCataloguePath(), "_ingredient_nutrients.yaml");
      const doc = yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>;
      if (!doc || typeof doc !== "object") return null;
      const meta = (doc._meta ?? {}) as Record<string, unknown>;
      const entries: Record<string, TableEntry> = {};
      for (const [k, v] of Object.entries(doc)) {
        if (k === "_meta" || !v || typeof v !== "object") continue;
        entries[k] = v as TableEntry;
      }
      const thresholds: Record<string, Threshold> = {};
      for (const [tag, t] of Object.entries(
        (meta.rich_in_thresholds ?? {}) as Record<string, { field?: string; min?: number }>,
      )) {
        if (t?.field && typeof t.min === "number") thresholds[tag] = { field: t.field, min: t.min };
      }
      const nutrientKeys = Array.isArray(meta.nutrient_keys)
        ? (meta.nutrient_keys as string[])
        : [];
      if (!nutrientKeys.length || !Object.keys(thresholds).length) return null;
      return {
        entries,
        nutrientKeys,
        thresholds,
        lowCoveragePct: typeof meta.low_coverage_pct === "number" ? meta.low_coverage_pct : 70,
      };
    } catch {
      return null; // no table → callers keep the stored figures
    }
  })();
  return cached;
}

/**
 * Python's `round()`, reproduced.
 *
 * Two traps, both hit while getting the replay test to pass over the real
 * library:
 *
 *   1. Do NOT scale by 10^d and round the product. `0.05 * 10` is exactly `0.5`
 *      as a double, so a value Python correctly rounds UP (0.05 is stored a hair
 *      ABOVE five hundredths) looks like an exact tie here and rounds down.
 *      `toFixed` rounds the number's own decimal expansion, which is what Python
 *      does.
 *   2. `toFixed` breaks true ties AWAY from zero; Python breaks them to EVEN. A
 *      true tie needs the value to be exactly representable — .5 at 0dp, .25 or
 *      .75 at 1dp — which is rare but real, so it is handled explicitly.
 */
function pyRound(v: number, digits: 0 | 1 = 0): number {
  const tieScale = digits === 0 ? 2 : 4; // .5 → k/2 · .25/.75 → k/4
  const scaled = v * tieScale;
  if (Number.isInteger(scaled) && Math.abs(scaled % 2) === 1) {
    const f = 10 ** digits;
    const lo = Math.floor(v * f);
    return (lo % 2 === 0 ? lo : lo + 1) / f;
  }
  return Number(v.toFixed(digits));
}

/** Mirrors the engine's final rounding: 1dp under 100, whole numbers above. */
const roundPerServing = (v: number) => (v < 100 ? pyRound(v, 1) : pyRound(v));

/**
 * Recompute a recipe's nutrient block with `removed` ingredient indices left out.
 *
 * Returns null when the recipe has no recorded per-line data (a letter-pack
 * recipe, or one written before the backfill) — the caller then keeps whatever
 * it had, which is the same behaviour as before this existed.
 */
export async function recomputeWithout(
  lines: NutrientLine[] | undefined,
  servings: number | undefined,
  removed: number[],
): Promise<RecomputedNutrients | null> {
  return recomputeWithoutSync(await loadNutrientTable(), lines, servings, removed);
}

/** The same, against an already-loaded table — so a per-request adapter that
 *  runs over hundreds of recipes stays synchronous and reads the file once. */
export function recomputeWithoutSync(
  table: LoadedTable | null,
  lines: NutrientLine[] | undefined,
  servings: number | undefined,
  removed: number[],
): RecomputedNutrients | null {
  if (!table || !lines?.length || !servings || servings <= 0) return null;

  const drop = new Set(removed);
  const totals: Record<string, number> = Object.fromEntries(table.nutrientKeys.map((k) => [k, 0]));
  let matchedMass = 0;
  let totalMass = 0;

  for (const line of lines) {
    if (drop.has(line.i)) continue;
    // A zero-gram line is a carrier (water, broth) — the engine keeps those out
    // of BOTH the nutrient sum and the coverage denominator, and storing g: 0
    // is what reproduces that here without a second special case.
    totalMass += line.g;
    if (line.key) {
      matchedMass += line.g;
      const per100 = table.entries[line.key]?.per_100g ?? {};
      const f = line.f ?? 1;
      // Same association as the engine — `per100 * g * f / 100` left to right.
      // Regrouping it as `per100 * (g * f)` changes the last bits of the double
      // and tips 1dp values onto the wrong side of a rounding boundary.
      for (const k of table.nutrientKeys) totals[k] += (((per100[k] ?? 0) * line.g) * f) / 100;
    }
  }

  const perServing: Record<string, number> = {};
  for (const k of table.nutrientKeys) perServing[k] = roundPerServing(totals[k] / servings);

  const coveragePct = totalMass > 0 ? pyRound((100 * matchedMass) / totalMass, 1) : 0;
  const richIn: string[] = [];
  if (coveragePct >= table.lowCoveragePct)
    for (const [tag, t] of Object.entries(table.thresholds))
      if ((perServing[t.field] ?? 0) >= t.min) richIn.push(tag);

  return { perServing, coveragePct, richIn };
}

/**
 * Grams for the plain foods on a menu that have no recipe — curd, almonds,
 * seeds, fruit, milk, paneer, an egg (coach, 20 Nov 2026: "make sure stuff
 * like almonds and curd etc are counted"). Pure.
 *
 * The figures are the ingredient table's own per-100 g values (IFCT-based,
 * the same table every recipe is computed from), times the weight of the
 * portion the menu names. Only when BOTH the food and its portion are known:
 * "Curd (1/2 cup)" counts, "Curd" with no portion does not.
 */
import { menuPortion } from "./recipe-portion";
import type { Macros } from "./meal-macros";

interface Entry {
  category?: string;
  aliases?: string[];
  per_100g?: Record<string, number>;
}

/** Categories a menu serves as a food of its own. Spices, herbs, oils as a
 *  drizzle and condiments are garnish (meal-macros isNothing) — not here. */
const COUNTED = new Set(["dairy", "nut_seed", "dried_fruit", "fruit", "protein", "vegetable", "leafy", "grain", "dal_legume"]);

/** Grams in ONE piece, for foods a menu counts in pieces. */
const PIECE_G: Record<string, number> = {
  almonds: 1.2,
  walnuts: 2.5,
  cashews: 1.5,
  pistachios: 0.7,
  peanuts: 0.6,
  dates: 8,
  "figs-dried": 8,
  raisins: 0.5,
  egg: 50,
  banana: 100,
  apple: 150,
  orange: 130,
  kiwi: 75,
  guava: 100,
  pear: 150,
  amla: 30,
};
const PIECE_BY_CATEGORY: Record<string, number> = { fruit: 100, nut_seed: 1.5, dried_fruit: 5 };
/** One cup / katori. Leaves and raw veg are light; dairy and cooked dense. */
const BOWL_G: Record<string, number> = { dairy: 150, leafy: 40, vegetable: 100, fruit: 120, nut_seed: 120, grain: 150, dal_legume: 150 };
const GLASS_G = 200;
const TBSP_G: Record<string, number> = { nut_seed: 9, dairy: 15, dried_fruit: 10 };

/** Drinks where the named food is only a splash: "tea with milk". */
const DILUTED = /\b(tea|chai|coffee|kahwa|kadha|water|infusion|decoction)\b/;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PlainLookup = (title: string, portion: string | undefined) => Macros | null;

export function buildPlainFoodLookup(entries: Record<string, Entry> | null | undefined): PlainLookup {
  const idx: { alias: string; key: string; e: Entry }[] = [];
  for (const [key, e] of Object.entries(entries ?? {})) {
    if (!e || !COUNTED.has(e.category ?? "") || !e.per_100g) continue;
    for (const a of [key.replace(/-/g, " "), ...(e.aliases ?? [])]) {
      const alias = norm(a);
      if (alias.length >= 3) idx.push({ alias, key, e });
    }
  }
  idx.sort((a, b) => b.alias.length - a.alias.length);
  return (title, portion) => {
    const t = norm(title);
    if (!t || DILUTED.test(t)) return null;
    const hit = idx.find((x) => ` ${t} `.includes(` ${x.alias} `));
    if (!hit) return null;
    const p = menuPortion(portion);
    if (!p) return null;
    const cat = hit.e.category ?? "";
    let grams: number | null = null;
    if (p.unit === "piece") grams = p.qty * (PIECE_G[hit.key] ?? PIECE_BY_CATEGORY[cat] ?? NaN);
    else if (p.unit === "bowl") grams = p.qty * (BOWL_G[cat] ?? NaN);
    else if (p.unit === "glass") grams = p.qty * GLASS_G;
    else if (p.unit === "tbsp") grams = p.qty * (TBSP_G[cat] ?? NaN);
    if (!grams || !Number.isFinite(grams)) return null;
    const per = hit.e.per_100g!;
    const f = grams / 100;
    const v = (k: string) => (Number.isFinite(per[k]) ? per[k] * f : 0);
    return { protein_g: v("protein_g"), carbs_g: v("carbs_g"), fat_g: v("fat_g"), fibre_g: v("fibre_g") };
  };
}

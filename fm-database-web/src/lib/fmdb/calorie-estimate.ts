/**
 * Deterministic calorie estimator for the client app's menus.
 *
 * Meal letters are retired, so the app is the only place that can answer
 * "is this menu near the weight-loss target?". The menu is free-text Indian
 * home food ("Masoor dal + jowar bhakri (1) + ridge gourd sabzi"), so this
 * is a best-effort ESTIMATE — a per-component lookup against a table of
 * typical home portions, summed per day. It is intentionally surfaced as a
 * rough number inside a tolerance band, never a precise claim.
 *
 * Pure, no I/O — safe to import anywhere. The coach can extend FOOD_KCAL as
 * new dishes appear; unmatched components fall back to a small default so a
 * day is never wildly under-counted.
 */

// kcal per typical home serving. Per-piece items (roti, dosa, nuts) are noted;
// everything else is "one bowl / one portion". Order doesn't matter — the
// matcher picks the longest keyword that appears in the component text.
const FOOD_KCAL: Record<string, number> = {
  // ── grains / rotis / breakfast bases ──────────────────────────────
  "jowar bhakri": 110,
  "jowar roti": 90,
  "bajra roti": 100,
  "ragi roti": 95,
  "ragi dosa": 80,
  "nachni": 85,
  bhakri: 110,
  paratha: 160,
  thepla: 110,
  chilla: 110,
  cheela: 110,
  dosa: 85, // per dosa
  uttapam: 130,
  idli: 40, // per idli
  appam: 90,
  roti: 90, // per roti
  phulka: 70,
  rice: 200, // 1 cup cooked
  "millet rice": 180,
  millet: 180,
  pongal: 210,
  upma: 180,
  poha: 180,
  khichdi: 260,
  "sabudana khichdi": 280,
  sabudana: 280,
  dalia: 160,
  oats: 160,
  bread: 75, // per slice
  // ── dals / legumes ────────────────────────────────────────────────
  "dal soup": 110,
  "dal tadka": 170,
  "moong soup": 110,
  sambar: 130,
  rasam: 60,
  rajma: 210,
  chole: 220,
  "chana dal": 160,
  chana: 180,
  dal: 150,
  lentil: 150,
  sprouts: 90,
  sprout: 90,
  // ── vegetables / mains ────────────────────────────────────────────
  "paneer": 200,
  tofu: 130,
  "stir-fry": 110,
  "stir fry": 110,
  stew: 140,
  curry: 130,
  sabzi: 80,
  subzi: 80,
  sabji: 80,
  bhaji: 80,
  raita: 70,
  salad: 55,
  spinach: 55,
  palak: 55,
  cabbage: 45,
  cauliflower: 55,
  broccoli: 55,
  gourd: 45,
  beans: 65,
  bhindi: 95,
  okra: 95,
  tikka: 180,
  scramble: 150,
  vegetable: 75,
  // ── non-veg mains ─────────────────────────────────────────────────
  "chicken curry": 220,
  "grilled chicken": 200,
  "chicken breast": 165,
  chicken: 190,
  "fish curry": 200,
  "grilled fish": 180,
  fish: 180,
  "egg curry": 190,
  "boiled egg": 78,
  "egg bhurji": 170,
  omelet: 160,
  mutton: 260,
  lamb: 250,
  prawns: 110,
  prawn: 110,
  seafood: 160,
  kebab: 190,
  keema: 230,
  meat: 210,
  // ── dairy / drinks ────────────────────────────────────────────────
  "coconut curd": 90,
  buttermilk: 45,
  chaas: 45,
  lassi: 130,
  curd: 85,
  dahi: 85,
  yogurt: 85,
  "soy milk": 90,
  milk: 110, // 1 cup
  ghee: 45, // per tsp
  egg: 78, // per egg
  omelette: 160,
  // ── snacks / sides / fruit / nuts / seeds ─────────────────────────
  chutney: 55,
  makhana: 95,
  chikki: 110,
  ladoo: 120,
  laddu: 120,
  "brazil nut": 33, // per nut
  almond: 7, // per almond
  walnut: 26,
  cashew: 9,
  peanut: 6,
  "pumpkin seed": 60, // per tbsp
  "sunflower seed": 55,
  flaxseed: 55,
  flax: 55,
  sesame: 50,
  chia: 60,
  seeds: 55,
  nuts: 50,
  papaya: 50,
  banana: 100,
  apple: 80,
  orange: 60,
  guava: 60,
  fruit: 65,
  cucumber: 15,
  carrot: 25,
  "coconut water": 45,
  sherbet: 60,
  kokum: 40,
  panna: 70,
  amla: 15,
  // ── teas / infusions (near-zero) ──────────────────────────────────
  "green tea": 5,
  kashayam: 20,
  kadha: 20,
  tea: 15,
  "lemon water": 10,
  "jeera water": 10,
  "methi water": 10,
  "amla water": 15,
};

// keywords sorted longest-first so "coconut curd" wins over "curd",
// "jowar bhakri" over "bhakri", etc.
const KEYS = Object.keys(FOOD_KCAL).sort((a, b) => b.length - a.length);

const DEFAULT_COMPONENT_KCAL = 70; // unmatched but non-trivial food

/** Match a menu-component string to a priced recipe → kcal/serving, or null.
 *  Recipes carry accurate AI-computed calories, so they always win over the
 *  table. The matcher fires only when a recipe NAME is a sub-phrase of the
 *  component ("jowar bhakri" inside "jowar bhakri (1)") and prefers the
 *  longest such name — so a short component can't pick up a big composite
 *  recipe's calories. */
export type RecipeKcalLookup = (component: string) => number | null;

function normFood(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRecipeKcalLookup(recipes: { title: string; kcalPerServing?: number }[]): RecipeKcalLookup {
  const idx = recipes
    .filter((r) => r.kcalPerServing && r.kcalPerServing > 0 && r.title)
    .map((r) => ({ name: normFood(r.title), kcal: r.kcalPerServing as number }))
    .filter((e) => e.name.length >= 5)
    .sort((a, b) => b.name.length - a.name.length);
  return (component: string) => {
    const c = normFood(component);
    if (c.length < 5) return null;
    for (const e of idx) if (c.includes(e.name)) return e.kcal;
    return null;
  };
}

/** Estimate one "+"-separated component, applying count + size multipliers.
 *  A matched recipe's per-serving calories take precedence over the table. */
export function estimateComponentKcal(raw: string, recipeLookup?: RecipeKcalLookup): number {
  const t = ` ${raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ")} `;
  if (/^[\s-]*$/.test(raw)) return 0;
  // skip supplements / pure water / drugs
  if (/\b(magnesium|glycinate|capsule|tablet|supplement|probiotic|omega|vitamin\s|sublingual)\b/.test(t)) return 0;
  // a matched recipe already carries accurate per-serving calories — use it
  if (recipeLookup) {
    const rk = recipeLookup(raw);
    if (rk != null) return rk;
  }
  // skip near-zero garnishes, condiments, spices & tempering (they ride inside
  // a dish, not a portion of their own) — unless a calorie food rides with them
  const matchedFood = KEYS.find((k) => t.includes(k));
  if (
    !matchedFood &&
    /\b(lemon|lime|ginger|garlic|coriander|cilantro|mint|curry leaf|curry leaves|hing|asafoetida|turmeric|haldi|cumin seed|mustard seed|jeera|tempering|tadka|garnish|herbs?|spice|spices|masala|rock salt|black salt|sendha|to taste|pinch|squeeze|drizzle|sprinkle|seasoning|chilli|chili|pepper)\b/.test(
      t,
    )
  ) {
    return 0;
  }

  // count of PIECES — "dosa (2)", "2 idli", "x2". A number followed by a
  // weight/volume/measure unit ("paneer (75 g)", "1 cup", "30 ml") is a
  // quantity, NOT a count, so it must not multiply the base.
  const UNIT = /^(?:g|gm|gms|gram|grams|kg|ml|l|oz|cup|cups|tbsp|tbsps|tsp|tsps|tablespoons?|teaspoons?|bowl|bowls|glass|katori|piece|pieces|slice|slices|inch|cm|handful)\b/;
  let count = 1;
  const paren = t.match(/\((\d{1,2})\)/); // "(2)" exactly — no unit inside
  const lead = t.match(/(?:^|\s)(\d{1,2})\s+([a-z]+)/);
  if (paren) count = Math.min(6, Math.max(1, parseInt(paren[1], 10)));
  else if (lead && !UNIT.test(lead[2])) count = Math.min(6, Math.max(1, parseInt(lead[1], 10)));

  // size multiplier
  let size = 1;
  if (/\b(small|little|tiny|mini|half|½|quarter)\b/.test(t)) size = 0.7;
  else if (/\b(large|big|heaped|generous|extra)\b/.test(t)) size = 1.25;
  if (/½\s*cup|half\s*cup/.test(t)) size = 0.5;

  const base = matchedFood ? FOOD_KCAL[matchedFood] : DEFAULT_COMPONENT_KCAL;
  // per-piece foods scale by count; bowl/portion foods only scale a real "(2)"
  return Math.round(base * count * size);
}

/** Estimate one dish ("A + B + C"). */
export function estimateDishKcal(dish: string, recipeLookup?: RecipeKcalLookup): number {
  if (!dish) return 0;
  return dish
    .split(/\s*\+\s*/)
    .map((c) => estimateComponentKcal(c, recipeLookup))
    .reduce((a, b) => a + b, 0);
}

/** Estimate a full day from its meal dishes (skips bedtime drinks ~ noise). */
export function estimateDayKcal(dishes: string[], recipeLookup?: RecipeKcalLookup): number {
  return dishes.map((d) => estimateDishKcal(d, recipeLookup)).reduce((a, b) => a + b, 0);
}

export type CalAdherence = "on_track" | "high" | "low";

/** Compare an estimated daily intake to a target, with a ±15 % tolerance. */
export function calorieAdherence(estimated: number, target: number): CalAdherence {
  if (!target) return "on_track";
  const ratio = estimated / target;
  if (ratio > 1.15) return "high";
  if (ratio < 0.85) return "low";
  return "on_track";
}

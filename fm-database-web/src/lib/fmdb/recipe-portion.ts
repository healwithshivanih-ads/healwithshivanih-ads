/**
 * What ONE SERVING of a library recipe is, in the units a menu speaks
 * ("3 bhakri", "2.5 bowls", "1 glass", "2 tbsp") — pure, no I/O.
 *
 * WHY (coach, 20 Nov 2026): a recipe's per-serving grams are for ITS serving,
 * which is often not the portion the menu names. Jowar bhakri's serving is
 * ~120 g flour (about 3 bhakris) while the menu says 2; toor dal's serving is
 * 75 g dry dal (about 2.5 katoris) while the menu says 1 bowl. Shown unscaled,
 * a dinner read 141 g of carbs. So the grams are scaled to the menu portion,
 * and the serving is worked out here from the recipe's own ingredient grams.
 *
 * Confident kinds only: flatbreads and batters by flour/dal per piece, dals /
 * grains by dry weight per katori, sabzis by vegetable weight, drinks by the
 * glass, chutneys by the spoon. Soups, salads and anything else return null:
 * their grams then show as "about", never scaled on a guess.
 *
 * A recipe may carry a hand-set `serving_portion: {qty, unit}` and that wins.
 */
import type { NutrientLine } from "./recipe-nutrients";

export type PortionUnit = "piece" | "bowl" | "glass" | "tbsp";
export interface Portion {
  qty: number;
  unit: PortionUnit;
  /** a menu "cup" can be a drink: the same amount in glasses (1 cup ≈ 0.8 glass) */
  asGlass?: number;
}

/** Category + basis of an ingredient-table key. */
export type FoodInfo = (key: string) => { category?: string; basis?: string } | null;

/** Dry flour / grain / dal per piece, by the bread's name. Home sizes. */
const PIECE_DRY_G: [RegExp, number][] = [
  [/phulka/, 25],
  [/chapati|chapathi|\broti\b/, 30],
  [/bhakri|bhakar/, 40],
  [/thepla/, 35],
  [/paratha|parotta/, 45],
  [/chilla|cheela|chila/, 40],
  [/pesarattu|\badai\b/, 45],
  [/uttapam|uthappam/, 55],
  [/dosa|dosai/, 45],
  [/idli|idly/, 20],
  [/appe\b|appam|paniyaram/, 12],
  [/pancake/, 40],
  [/\bpuri\b|poori/, 20],
];
/** One katori of cooked dal ≈ 30 g dry; of cooked grain ≈ 45 g dry. */
const DAL_PER_BOWL_G = 30;
const GRAIN_PER_BOWL_G = 45;
const KHICHDI_PER_BOWL_G = 60;
/** One cup of cooked sabzi ≈ 150 g raw vegetable. */
const VEG_PER_BOWL_G = 150;
const GLASS_G = 250;
const READY_PER_BOWL_G = 160;
const TBSP_G = 15;

const SOUP_RE = /\bsoup\b|rasam|shorba|broth|\bstock\b|chowder|consomm/;
const SALAD_RE = /salad|slaw|kachumber|koshimbir|raita|dressing|vinaigrette/;
const GLASS_RE = /smoothie|lassi|chaas|buttermilk|\bmilk\b|juice|kanji|shake|\bdrink\b|latte|kadha|\btea\b|infusion|sharbat|\bwater\b/;
const SPOON_RE = /chutney|\bpodi\b|pickle|\bdip\b|thokku|achar|gunpowder|spice mix|masala powder|pesto/;
const KHICHDI_RE = /khichdi|khichri|pongal|bisi bele/;
const SABZI_RE = /sabzi|sabji|bhaji|palya|poriyal|thoran|\bsaag\b|stir.?fry|subzi|usal|curry|kootu|avial/;

const DRY = new Set(["dry", "dried", "raw", "soaked", "sprouted"]);

function roundHalf(q: number): number {
  return Math.round(q * 2) / 2;
}

export function recipePortion(
  name: string,
  lines: NutrientLine[] | undefined,
  servings: number | undefined,
  food: FoodInfo,
  handSet?: unknown,
): Portion | null {
  const hs = handSet as { qty?: unknown; unit?: unknown } | null | undefined;
  if (hs && typeof hs.qty === "number" && hs.qty > 0 && ["piece", "bowl", "glass", "tbsp"].includes(String(hs.unit))) {
    return { qty: hs.qty, unit: hs.unit as PortionUnit };
  }
  if (!lines?.length || !servings || servings <= 0) return null;
  const n = name.toLowerCase();
  const g: Record<string, number> = {};
  let total = 0;
  for (const l of lines) {
    const info = l.key ? food(l.key) : null;
    const cat = info?.category ?? "none";
    // A dal or grain already cooked ("thin dal", cooked rice) is a volume,
    // not dry weight: never divide it by a dry-per-katori figure.
    const bucket = (cat === "dal_legume" || cat === "grain" || cat === "flour") && !DRY.has(info?.basis ?? "dry") ? "ready" : cat;
    const per = (l.g || 0) / servings;
    g[bucket] = (g[bucket] ?? 0) + per;
    total += per;
  }
  const v = (k: string) => g[k] ?? 0;
  const out = (q: number, unit: PortionUnit): Portion | null => {
    if (!Number.isFinite(q) || q <= 0) return null;
    return { qty: Math.max(0.5, Math.min(6, roundHalf(q))), unit };
  };

  if (SOUP_RE.test(n) || SALAD_RE.test(n) || /sandwich|chaat|\btoast\b|\bbowl\b|\bwrap\b/.test(n)) return null;
  for (const [re, per] of PIECE_DRY_G) {
    if (re.test(n)) {
      const dry = v("flour") + v("grain") + v("dal_legume");
      return dry > 0 ? out(dry / per, "piece") : null;
    }
  }
  if (GLASS_RE.test(n)) return out(total / GLASS_G, "glass");
  if (SPOON_RE.test(n)) return out(total / TBSP_G, "tbsp");
  const dal = v("dal_legume");
  const grain = v("grain") + v("flour");
  if (KHICHDI_RE.test(n) && dal + grain > 0) return out((dal + grain) / KHICHDI_PER_BOWL_G, "bowl");
  if (dal + grain >= 8 && v("ready") < 50) return out(dal / DAL_PER_BOWL_G + grain / GRAIN_PER_BOWL_G, "bowl");
  // Already-cooked dal or grain ("thin dal", cooked millet): ~160 g a katori.
  if (v("ready") >= 50 && dal + grain < 8) return out((v("ready") + v("vegetable") + v("leafy")) / READY_PER_BOWL_G, "bowl");
  if (SABZI_RE.test(n)) {
    // Leaves and keys without a category still count: a palak sabzi is mostly
    // leaf. Only the fat is left out of the weight.
    const veg = total - v("oil_fat") - v("spice") - v("condiment");
    return veg >= 25 ? out(veg / VEG_PER_BOWL_G, "bowl") : null;
  }
  return null;
}

/**
 * The menu's portion for one component ("2", "1 bowl", "small bowl", "½ cup",
 * "1 glass", "2 tbsp") in the same units. null when it names none we read.
 */
export function menuPortion(portion: string | undefined): Portion | null {
  const t = (portion || "").toLowerCase().replace(/½/g, "0.5").replace(/¼/g, "0.25").trim();
  if (!t) return null;
  const num = (() => {
    const f = t.match(/(\d+)\s*\/\s*(\d+)/);
    if (f) return parseInt(f[1], 10) / parseInt(f[2], 10);
    const m = t.match(/\d+(?:\.\d+)?/);
    if (m) return parseFloat(m[0]);
    if (/\bhalf\b/.test(t)) return 0.5;
    if (/\b(a|one)\b/.test(t)) return 1;
    return null;
  })();
  const size = /\bsmall\b/.test(t) ? 0.7 : /\b(large|big)\b/.test(t) ? 1.3 : 1;
  if (/\bcups?\b/.test(t)) return { qty: (num ?? 1) * size, unit: "bowl", asGlass: (num ?? 1) * size * 0.8 };
  if (/\b(bowls?|katoris?|plates?|servings?)\b/.test(t)) return { qty: (num ?? 1) * size, unit: "bowl" };
  if (/\b(glass|glasses|mugs?)\b/.test(t)) return { qty: (num ?? 1) * size, unit: "glass" };
  if (/\b(tbsp|tablespoons?)\b/.test(t)) return { qty: num ?? 1, unit: "tbsp" };
  if (/\b(tsp|teaspoons?)\b/.test(t)) return { qty: (num ?? 1) / 3, unit: "tbsp" };
  if (/^\d+(?:\.\d+)?$/.test(t) || /\b(pieces?|pcs?|nos?)\b/.test(t)) return num ? { qty: num, unit: "piece" } : null;
  return null;
}

/** How many recipe servings the menu portion is; null when the two can't be
 *  compared (then the grams are not scaled and the meal reads "about"). */
export function portionFactor(serving: Portion | null | undefined, menu: Portion | null): number | null {
  if (!serving || !menu) return null;
  const qty = serving.unit === menu.unit ? menu.qty : serving.unit === "glass" && menu.asGlass ? menu.asGlass : null;
  if (qty === null) return null;
  const f = qty / serving.qty;
  return Number.isFinite(f) && f > 0 ? f : null;
}

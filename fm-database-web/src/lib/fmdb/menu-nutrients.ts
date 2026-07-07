/**
 * Menu-level nutrient balancing (server-only).
 *
 * The weekly menu is free-text home food ("Masoor dal + jowar bhakri (1) +
 * ridge gourd sabzi"). Each library recipe now carries a deterministic
 * `nutrients_per_serving` panel (Phase 2). This reads that panel, name-matches
 * every menu dish component to a recipe (the SAME longest-substring match the
 * kcal estimator uses), and sums protein + fibre + kcal per day so the coach
 * can see, at approval time, whether each day clears the client's protein and
 * fibre floors before a menu goes live.
 *
 * Honest by design: only recipe-matched components contribute nutrients (we
 * don't have a macro table for the kcal fallback foods), so every day reports
 * a `matched / total` component count. A low day with poor coverage is flagged
 * "estimate incomplete" rather than "low protein".
 *
 * Reads _recipes/*.yaml once per Node process, refreshed when the dir mtime
 * changes — cheap on pm2, correct after a recipe is added/edited.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const RECIPES_DIR = path.join(process.cwd(), "..", "fm-database", "data", "_recipes");

export interface RecipeNutrients {
  kcal: number;
  protein_g: number;
  fibre_g: number;
}

interface IndexEntry extends RecipeNutrients {
  name: string; // normalised recipe title
}

let _cache: { mtimeMs: number; index: IndexEntry[] } | null = null;

function normFood(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadIndex(): IndexEntry[] {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(RECIPES_DIR).mtimeMs;
  } catch {
    return [];
  }
  if (_cache && _cache.mtimeMs === mtimeMs) return _cache.index;

  const index: IndexEntry[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
  } catch {
    return [];
  }
  for (const f of files) {
    let r: Record<string, unknown> | null = null;
    try {
      r = yaml.load(fs.readFileSync(path.join(RECIPES_DIR, f), "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!r) continue;
    const nps = r.nutrients_per_serving as Record<string, number> | undefined;
    const title = String(r.name ?? "");
    if (!nps || !title) continue;
    const name = normFood(title);
    if (name.length < 5) continue;
    index.push({
      name,
      kcal: Number(nps.kcal) || 0,
      protein_g: Number(nps.protein_g) || 0,
      fibre_g: Number(nps.fibre_g) || 0,
    });
  }
  // longest name first so "coconut curd" wins over "curd"
  index.sort((a, b) => b.name.length - a.name.length);
  _cache = { mtimeMs, index };
  return index;
}

export type RecipeNutrientLookup = (component: string) => RecipeNutrients | null;

export function buildRecipeNutrientLookup(): RecipeNutrientLookup {
  const index = loadIndex();
  return (component: string) => {
    const c = normFood(component);
    if (c.length < 5) return null;
    for (const e of index) if (c.includes(e.name)) return e;
    return null;
  };
}

// ── fallback macro table for common Indian home-menu foods ──────────────────
// A recipe match always wins (real per-serving macros). This table catches the
// ~70% of menu components that don't name-match a library recipe ("masoor dal"
// vs the recipe "Masoor dal soup"), so protein/fibre totals aren't systematically
// under-counted. Per one typical home portion (bowl / katori / piece as noted).
// Values from IFCT-typical cooked portions — same spirit as calorie-estimate's
// FOOD_KCAL. {protein_g, fibre_g, kcal}. Longest keyword match wins.
const FOOD_MACRO: Record<string, RecipeNutrients> = {
  // dals & legumes (1 bowl ~150g cooked)
  "moong dal": { protein_g: 9, fibre_g: 5, kcal: 150 },
  "masoor dal": { protein_g: 9, fibre_g: 5, kcal: 150 },
  "toor dal": { protein_g: 9, fibre_g: 5, kcal: 150 },
  "chana dal": { protein_g: 9, fibre_g: 6, kcal: 160 },
  "urad dal": { protein_g: 9, fibre_g: 5, kcal: 160 },
  dal: { protein_g: 8, fibre_g: 4, kcal: 150 },
  "sambar": { protein_g: 6, fibre_g: 4, kcal: 120 },
  rajma: { protein_g: 9, fibre_g: 7, kcal: 170 },
  chole: { protein_g: 9, fibre_g: 8, kcal: 180 },
  "chana masala": { protein_g: 9, fibre_g: 8, kcal: 180 },
  chana: { protein_g: 9, fibre_g: 8, kcal: 160 },
  chickpea: { protein_g: 9, fibre_g: 8, kcal: 160 },
  "kidney bean": { protein_g: 9, fibre_g: 7, kcal: 170 },
  "black bean": { protein_g: 8, fibre_g: 8, kcal: 160 },
  sprout: { protein_g: 7, fibre_g: 4, kcal: 100 },
  moong: { protein_g: 8, fibre_g: 4, kcal: 110 },
  // breads (per piece)
  "jowar bhakri": { protein_g: 3, fibre_g: 3, kcal: 110 },
  "bajra bhakri": { protein_g: 3, fibre_g: 3, kcal: 110 },
  "bajra roti": { protein_g: 3, fibre_g: 3, kcal: 110 },
  "jowar roti": { protein_g: 3, fibre_g: 3, kcal: 110 },
  "ragi roti": { protein_g: 3, fibre_g: 3, kcal: 110 },
  bhakri: { protein_g: 3, fibre_g: 3, kcal: 110 },
  phulka: { protein_g: 3, fibre_g: 2, kcal: 80 },
  chapati: { protein_g: 3, fibre_g: 2, kcal: 90 },
  roti: { protein_g: 3, fibre_g: 2, kcal: 90 },
  paratha: { protein_g: 4, fibre_g: 2, kcal: 180 },
  thepla: { protein_g: 3, fibre_g: 2, kcal: 120 },
  dosa: { protein_g: 3, fibre_g: 1, kcal: 130 },
  idli: { protein_g: 2, fibre_g: 1, kcal: 40 },
  uttapam: { protein_g: 4, fibre_g: 2, kcal: 150 },
  // grains (1 bowl cooked)
  khichdi: { protein_g: 8, fibre_g: 4, kcal: 200 },
  "brown rice": { protein_g: 4, fibre_g: 2, kcal: 150 },
  "white rice": { protein_g: 3, fibre_g: 1, kcal: 160 },
  rice: { protein_g: 3, fibre_g: 1, kcal: 160 },
  poha: { protein_g: 3, fibre_g: 2, kcal: 180 },
  upma: { protein_g: 4, fibre_g: 2, kcal: 190 },
  oats: { protein_g: 5, fibre_g: 4, kcal: 150 },
  quinoa: { protein_g: 6, fibre_g: 3, kcal: 170 },
  millet: { protein_g: 4, fibre_g: 3, kcal: 160 },
  "vegetable pulao": { protein_g: 5, fibre_g: 3, kcal: 220 },
  // veg / sabzi (1 katori)
  sabzi: { protein_g: 3, fibre_g: 4, kcal: 90 },
  sabji: { protein_g: 3, fibre_g: 4, kcal: 90 },
  bharta: { protein_g: 3, fibre_g: 4, kcal: 100 },
  thoran: { protein_g: 3, fibre_g: 4, kcal: 100 },
  poriyal: { protein_g: 3, fibre_g: 4, kcal: 100 },
  "palak paneer": { protein_g: 11, fibre_g: 4, kcal: 220 },
  paneer: { protein_g: 12, fibre_g: 0, kcal: 200 },
  tofu: { protein_g: 12, fibre_g: 1, kcal: 150 },
  "mixed vegetable": { protein_g: 3, fibre_g: 4, kcal: 90 },
  cabbage: { protein_g: 2, fibre_g: 3, kcal: 70 },
  "stir-fry": { protein_g: 3, fibre_g: 3, kcal: 90 },
  "stir fry": { protein_g: 3, fibre_g: 3, kcal: 90 },
  makhana: { protein_g: 4, fibre_g: 2, kcal: 120 },
  salad: { protein_g: 2, fibre_g: 3, kcal: 60 },
  raita: { protein_g: 3, fibre_g: 1, kcal: 80 },
  // dairy / eggs / non-veg
  curd: { protein_g: 4, fibre_g: 0, kcal: 80 },
  yogurt: { protein_g: 4, fibre_g: 0, kcal: 80 },
  buttermilk: { protein_g: 2, fibre_g: 0, kcal: 40 },
  chaas: { protein_g: 2, fibre_g: 0, kcal: 40 },
  chhaas: { protein_g: 2, fibre_g: 0, kcal: 40 },
  lassi: { protein_g: 4, fibre_g: 0, kcal: 120 },
  milk: { protein_g: 4, fibre_g: 0, kcal: 90 },
  egg: { protein_g: 6, fibre_g: 0, kcal: 78 }, // per egg
  omelette: { protein_g: 12, fibre_g: 0, kcal: 160 },
  bhurji: { protein_g: 12, fibre_g: 1, kcal: 170 },
  chicken: { protein_g: 25, fibre_g: 0, kcal: 190 },
  fish: { protein_g: 22, fibre_g: 0, kcal: 180 },
  prawn: { protein_g: 20, fibre_g: 0, kcal: 150 },
  mutton: { protein_g: 22, fibre_g: 0, kcal: 250 },
  // snacks / misc
  chilla: { protein_g: 9, fibre_g: 3, kcal: 160 },
  besan: { protein_g: 8, fibre_g: 3, kcal: 160 },
  dhokla: { protein_g: 6, fibre_g: 2, kcal: 150 },
  nuts: { protein_g: 5, fibre_g: 3, kcal: 160 },
  almond: { protein_g: 5, fibre_g: 3, kcal: 160 },
  peanut: { protein_g: 7, fibre_g: 3, kcal: 170 },
  fruit: { protein_g: 1, fibre_g: 3, kcal: 80 },
  soup: { protein_g: 4, fibre_g: 3, kcal: 90 },
};
const FOOD_MACRO_KEYS = Object.keys(FOOD_MACRO).sort((a, b) => b.length - a.length);

const UNIT_RE =
  /^(?:g|gm|gms|gram|grams|kg|ml|l|oz|cup|cups|tbsp|tbsps|tsp|tsps|tablespoons?|teaspoons?|bowl|bowls|glass|katori|piece|pieces|slice|slices|inch|cm|handful)\b/;

/** Component count from "(2)" / leading "2 idli" — never a "(75 g)" quantity. */
function componentCount(t: string): number {
  const paren = t.match(/\((\d{1,2})\)/);
  if (paren) return Math.min(6, Math.max(1, parseInt(paren[1], 10)));
  const lead = t.match(/(?:^|\s)(\d{1,2})\s+([a-z]+)/);
  if (lead && !UNIT_RE.test(lead[2])) return Math.min(6, Math.max(1, parseInt(lead[1], 10)));
  return 1;
}
function componentSize(t: string): number {
  if (/½\s*cup|half\s*cup/.test(t)) return 0.5;
  if (/\b(small|little|tiny|mini|half|½|quarter)\b/.test(t)) return 0.7;
  if (/\b(large|big|heaped|generous|extra)\b/.test(t)) return 1.25;
  return 1;
}

/**
 * Nutrients for one menu component. Recipe match (real per-serving macros)
 * wins; else the fallback food table with count/size multipliers; else null
 * (uncounted — reported in coverage). Returns {matched, ...nutrients}.
 */
export function componentNutrients(
  raw: string,
  recipeLookup: RecipeNutrientLookup,
): (RecipeNutrients & { matched: boolean }) | null {
  const rec = recipeLookup(raw);
  if (rec) return { ...rec, matched: true };
  const t = ` ${raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ")} `;
  const key = FOOD_MACRO_KEYS.find((k) => t.includes(k));
  if (!key) return null;
  const base = FOOD_MACRO[key];
  const mult = componentCount(t) * componentSize(t);
  return {
    kcal: Math.round(base.kcal * mult),
    protein_g: base.protein_g * mult,
    fibre_g: base.fibre_g * mult,
    matched: true,
  };
}

export interface DayNutrition {
  day: number;
  kcal: number;
  protein_g: number;
  fibre_g: number;
  matched: number; // recipe-matched components
  total: number; // total non-trivial components
}

const SKIP_RE =
  /\b(magnesium|glycinate|capsule|tablet|supplement|probiotic|omega|vitamin\s|sublingual|water|chai|tea|coffee|kahwa)\b/i;

/** Sum protein/fibre/kcal for one day's dishes. Each dish is "A + B + C". */
export function dayNutrition(day: number, dishes: string[], lookup: RecipeNutrientLookup): DayNutrition {
  let kcal = 0,
    protein = 0,
    fibre = 0,
    matched = 0,
    total = 0;
  for (const dish of dishes) {
    for (const comp of dish.split(/\s*\+\s*/)) {
      const c = comp.trim();
      if (!c || SKIP_RE.test(` ${c.toLowerCase()} `)) continue;
      total += 1;
      const n = componentNutrients(c, lookup);
      if (n) {
        matched += 1;
        kcal += n.kcal;
        protein += n.protein_g;
        fibre += n.fibre_g;
      }
    }
  }
  return {
    day,
    kcal: Math.round(kcal),
    protein_g: Math.round(protein),
    fibre_g: Math.round(fibre),
    matched,
    total,
  };
}

export interface MenuNutrition {
  days: DayNutrition[];
  proteinFloorG: number; // g/day — 1.2 g/kg (or fallback)
  proteinTargetG: number; // g/day — 1.5 g/kg
  fibreFloorG: number; // g/day
  weightKg: number | null;
  /** average matched-component coverage across the week, 0-1 */
  coverage: number;
}

const FIBRE_FLOOR_G = 25;

/** Resolve the client's body weight for protein-floor maths (kg), or null. */
export function clientWeightKg(client: Record<string, unknown> | null): number | null {
  if (!client) return null;
  const m = client.measurements as Record<string, unknown> | undefined;
  const fromMeasure = m && Number(m.weight_kg);
  if (fromMeasure && fromMeasure > 20) return fromMeasure;
  for (const k of ["latest_weight_kg", "current_weight_kg", "weight_kg"]) {
    const v = Number(client[k]);
    if (v && v > 20) return v;
  }
  const wl = client.weight_loss as Record<string, unknown> | undefined;
  const start = wl && Number(wl.starting_weight_kg);
  if (start && start > 20) return start;
  // last resort: a "weight" lab_marker if present
  const lm = client.lab_markers;
  if (Array.isArray(lm)) {
    const w = lm.find(
      (x) => x && typeof x === "object" && /weight/i.test(String((x as { marker_name?: string }).marker_name)),
    ) as { value?: number } | undefined;
    if (w?.value && w.value > 20) return Number(w.value);
  }
  return null;
}

/** Full per-day nutrient summary for a weekly menu + client-derived targets. */
export function menuNutrition(
  days: { slots: { slot: string; dish: string }[] }[],
  client: Record<string, unknown> | null,
): MenuNutrition {
  const lookup = buildRecipeNutrientLookup();
  const perDay = days.map((d, i) =>
    dayNutrition(
      i + 1,
      (d.slots ?? []).map((s) => s.dish).filter(Boolean),
      lookup,
    ),
  );
  const weightKg = clientWeightKg(client);
  // protein floor 1.2 g/kg, stretch target 1.5 g/kg (memory: 1.2-1.5 g/kg,
  // suppressed for kidney/uric-acid clients — coach reads the flag, we don't
  // auto-suppress here). Fallback 55 g/day when weight is unknown.
  const proteinFloorG = weightKg ? Math.round(weightKg * 1.2) : 55;
  const proteinTargetG = weightKg ? Math.round(weightKg * 1.5) : 70;
  const totMatched = perDay.reduce((a, d) => a + d.matched, 0);
  const totComp = perDay.reduce((a, d) => a + d.total, 0);
  return {
    days: perDay,
    proteinFloorG,
    proteinTargetG,
    fibreFloorG: FIBRE_FLOOR_G,
    weightKg,
    coverage: totComp ? totMatched / totComp : 0,
  };
}

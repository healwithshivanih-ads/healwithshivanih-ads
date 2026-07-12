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
  protein_g: number; // total for the day — food PLUS the daily protein-powder top-up
  foodProteinG: number; // food-only (for an honest per-day tooltip)
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
    foodProteinG: Math.round(protein),
    fibre_g: Math.round(fibre),
    matched,
    total,
  };
}

export interface MenuNutrition {
  days: DayNutrition[];
  proteinFloorG: number; // g/day — 1.4 g/kg (or fallback), suppression-aware
  proteinTargetG: number; // g/day — 1.6 g/kg
  fibreFloorG: number; // g/day
  weightKg: number | null;
  /** daily grams of protein contributed by a protein-powder in the plan's
   *  supplement_protocol — already folded into each day's protein_g. 0 when
   *  no protein powder is prescribed (or no plan was passed). */
  supplementProteinG: number;
  /** true when a kidney / urate / decompensated-liver contraindication means
   *  we deliberately DON'T raise the floor — protein is kept moderate and
   *  doctor-guided. Mirrors protein_logic.py. */
  proteinSuppressed: boolean;
  proteinSuppressReason: string; // "kidney" | "liver" | "uric_acid" | ""
  /** average matched-component coverage across the week, 0-1 */
  coverage: number;
}

const FIBRE_FLOOR_G = 25;

// ── protein floor, mirroring scripts/protein_logic.py calc_protein_target ──
// Baseline 1.4-1.6 g/kg (lifted from the old flat 1.2-1.5 — for this practice's
// over-50 / vegetarian / bone-health clientele the 1.2 minimum consistently
// under-served). Raised to 1.6-2.0 in a weight-loss deficit to protect lean
// mass. SUPPRESSED (kept moderate, ~0.8 g/kg, no raised floor) for kidney
// disease / low eGFR / high creatinine / gout / high urate / decompensated
// liver — never push protein on those clients. Keep in lockstep with
// protein_logic.py so the strip and the plan generator can't drift.
const PROTEIN_KIDNEY_TERMS = [
  "kidney disease", "chronic kidney", "ckd", "renal failure",
  "renal insufficiency", "renal disease", "nephropathy", "dialysis",
];
const PROTEIN_URIC_TERMS = [
  "gout", "hyperuricemia", "hyperuricaemia", "high uric acid",
  "elevated uric acid", "raised uric acid",
];
const PROTEIN_LIVER_TERMS = [
  "cirrhosis", "hepatic encephalopathy", "liver failure", "decompensated",
  "esld", "end-stage liver", "portal hypertension",
];
const PROTEIN_SLUGS = [
  "protein-plant-blend", "protein-whey-isolate", "protein-yeast-fermented",
  "plant-based-protein-powder", "whey-protein", "protein-whey",
];

function proteinConditionText(client: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["active_conditions", "medical_history"]) {
    const v = client[key];
    if (Array.isArray(v)) parts.push(...v.map((x) => String(x)));
    else if (v) parts.push(String(v));
  }
  for (const key of ["notes", "dietary_preference"]) {
    if (client[key]) parts.push(String(client[key]));
  }
  return parts.join(" ").toLowerCase();
}

/** Yield [name_lower, value] over lab_markers + health_snapshots.lab_values. */
function* iterLabValues(client: Record<string, unknown>): Generator<[string, number]> {
  const num = (v: unknown): number | null => {
    const f = Number(String(v ?? "").trim());
    return Number.isFinite(f) ? f : null;
  };
  const lm = client.lab_markers;
  if (Array.isArray(lm)) {
    for (const m of lm) {
      if (!m || typeof m !== "object") continue;
      const r = m as Record<string, unknown>;
      const name = String(r.marker_name ?? r.name ?? "").toLowerCase();
      const val = num(r.value);
      if (name && val !== null) yield [name, val];
    }
  }
  const hs = client.health_snapshots;
  if (Array.isArray(hs)) {
    for (const snap of hs) {
      if (!snap || typeof snap !== "object") continue;
      const lv = (snap as Record<string, unknown>).lab_values;
      if (!Array.isArray(lv)) continue;
      for (const row of lv) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const name = String(r.test_name ?? r.name ?? "").toLowerCase();
        const val = num(r.value);
        if (name && val !== null) yield [name, val];
      }
    }
  }
}

/** First numeric lab whose name contains a term and none of `exclude`. */
function labValue(
  client: Record<string, unknown>,
  terms: string[],
  exclude: string[] = [],
): number | null {
  for (const [name, val] of iterLabValues(client)) {
    if (terms.some((t) => name.includes(t)) && !exclude.some((x) => name.includes(x))) {
      return val;
    }
  }
  return null;
}

/** True if a lab_markers row matching a term carries a high/elevated flag. */
function labMarkerHigh(client: Record<string, unknown>, terms: string[]): boolean {
  const lm = client.lab_markers;
  if (!Array.isArray(lm)) return false;
  for (const m of lm) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const name = String(r.marker_name ?? r.name ?? "").toLowerCase();
    if (!terms.some((t) => name.includes(t))) continue;
    const flag = String(r.flag ?? "").toLowerCase();
    if (["high", "elevat", "above", "raised"].some((w) => flag.includes(w))) return true;
  }
  return false;
}

interface ProteinFloor {
  perKgFloor: number;
  perKgTarget: number;
  floorG: number;
  targetG: number;
  suppressed: boolean;
  suppressReason: string;
}

/** Suppression-aware protein floor/target for a client. Weight in kg or null. */
export function clientProteinFloor(
  client: Record<string, unknown> | null,
  weightKg: number | null,
): ProteinFloor {
  const c = client ?? {};
  const condText = proteinConditionText(c);
  const sex = String(c.sex ?? "").trim().toLowerCase();

  const egfr = labValue(c, ["egfr", "gfr"]);
  const creat = labValue(c, ["creatinine"], ["ratio", "bun", "clearance", "urine"]);
  const kidney =
    PROTEIN_KIDNEY_TERMS.some((t) => condText.includes(t)) ||
    labMarkerHigh(c, ["creatinine"]) ||
    (egfr !== null && egfr < 60) ||
    (creat !== null && creat > 1.3);

  const liver = PROTEIN_LIVER_TERMS.some((t) => condText.includes(t));

  const urate = labValue(c, ["uric acid", "urate"], ["ratio", "urine"]);
  const urateCeiling = sex === "f" || sex === "female" ? 6.0 : 7.0;
  const uric =
    PROTEIN_URIC_TERMS.some((t) => condText.includes(t)) ||
    labMarkerHigh(c, ["uric acid", "urate"]) ||
    (urate !== null && urate > urateCeiling);

  const suppressReason = kidney ? "kidney" : liver ? "liver" : uric ? "uric_acid" : "";

  // weight-loss deficit → raise protein to protect lean mass (unless suppressed)
  const wl = c.weight_loss as Record<string, unknown> | undefined;
  const deficit =
    !!wl &&
    typeof wl === "object" &&
    wl.enabled !== false &&
    !!(wl.enabled || wl.goal_kg || wl.starting_weight_kg);

  // Floor is the "menu shouldn't drop below this" line — kept at a realistic
  // 1.4 g/kg so the strip flags genuinely thin weeks, not every home-cooked veg
  // menu. The deficit protein bump (protect lean mass in a calorie deficit) and
  // the general stretch goal live in the TARGET, not the floor, so a weight-loss
  // client's floor doesn't balloon to an unmeetable 2.0 g/kg. Suppressed clients
  // keep a moderate floor and target — we never push protein on them.
  let perKgFloor = 1.4;
  let perKgTarget = 1.6;
  if (suppressReason) {
    perKgFloor = 0.8;
    perKgTarget = 1.0;
  } else if (deficit) {
    perKgTarget = 2.0;
  }

  const floorG = weightKg ? Math.round(weightKg * perKgFloor) : suppressReason ? 45 : 70;
  const targetG = weightKg ? Math.round(weightKg * perKgTarget) : suppressReason ? 55 : 80;
  return { perKgFloor, perKgTarget, floorG, targetG, suppressed: !!suppressReason, suppressReason };
}

/** Daily grams of protein from a protein-powder in the plan's supplement_protocol.
 *  Parses the LOW end of any "N-M g" in the dose (conservative). 0 if none. */
export function supplementProteinPerDay(plan: Record<string, unknown> | null | undefined): number {
  const sp = plan?.supplement_protocol;
  if (!Array.isArray(sp)) return 0;
  let grams = 0;
  for (const item of sp) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const slug = String(r.supplement_slug ?? "").toLowerCase();
    if (!(PROTEIN_SLUGS.includes(slug) || slug.includes("protein"))) continue;
    const dose = String(r.dose ?? "");
    // grab the gram figure — prefer one adjacent to "protein", else first "N g"
    const m =
      dose.match(/(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*g\b[^.]*protein/i) ||
      dose.match(/(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*g\b/i);
    if (m) grams += parseInt(m[1], 10); // low end
  }
  return grams;
}

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

/** Full per-day nutrient summary for a weekly menu + client-derived targets.
 *  Pass the client's published plan (opts.plan) so a prescribed protein powder
 *  is counted toward each day's protein — the scoop is taken daily and the food
 *  menu alone systematically under-reads without it. Floor is suppression-aware
 *  (kidney/urate/liver clients keep a moderate floor, not a raised one). */
export function menuNutrition(
  days: { slots: { slot: string; dish: string }[] }[],
  client: Record<string, unknown> | null,
  opts?: { plan?: Record<string, unknown> | null },
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
  const floor = clientProteinFloor(client, weightKg);

  // Fold the daily protein-powder top-up into each day's protein. Every day
  // carries the scoop, so it lifts the whole week uniformly; foodProteinG keeps
  // the food-only figure for an honest tooltip.
  const supplementProteinG = supplementProteinPerDay(opts?.plan);
  if (supplementProteinG > 0) {
    for (const d of perDay) d.protein_g = Math.round(d.foodProteinG + supplementProteinG);
  }

  const totMatched = perDay.reduce((a, d) => a + d.matched, 0);
  const totComp = perDay.reduce((a, d) => a + d.total, 0);
  return {
    days: perDay,
    proteinFloorG: floor.floorG,
    proteinTargetG: floor.targetG,
    fibreFloorG: FIBRE_FLOOR_G,
    weightKg,
    supplementProteinG,
    proteinSuppressed: floor.suppressed,
    proteinSuppressReason: floor.suppressReason,
    coverage: totComp ? totMatched / totComp : 0,
  };
}

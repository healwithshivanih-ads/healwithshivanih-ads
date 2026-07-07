/**
 * TS mirror of scripts/lab_nutrient_priorities.py — maps a client's off-range
 * lab markers to recipe `rich_in` nutrient tags so the dish picker can surface
 * iron-rich dishes first when the client's ferritin is low, etc.
 *
 * Kept as a faithful copy of the Python (same tables, same weights) rather than
 * a shared module — same pattern as recipe-picker.ts mirroring the app diet
 * gate. Converge into one source if it ever drifts.
 */

interface LabMarker {
  marker_name?: string;
  flag?: string;
}

const MARKER_TO_TAG: Record<string, string[]> = {
  iron: ["ferritin", "serum iron", "transferrin sat", "tsat", "hemoglobin", "haemoglobin", "hematocrit", "haematocrit", " mch", "mcv", "iron studies"],
  b12: ["b12", "b-12", "cobalamin", "holotc", "holotranscobalamin", "active b12"],
  folate: ["folate", "folic"],
  "vitamin-d": ["vitamin d", "25-oh", "25 oh", "25(oh)", "cholecalciferol"],
  magnesium: ["magnesium"],
  calcium: ["calcium"],
  zinc: ["zinc"],
  potassium: ["potassium"],
  "omega-3": ["omega-3 index", "omega 3 index", "omega-3", "epa", "dha"],
  protein: ["albumin", "total protein", "serum protein"],
  "vitamin-c": ["vitamin c", "ascorb"],
};
const EXCLUDE = ["24-hr urine calcium", "urine calcium", "a/g ratio", "globulin"];
const HIGH_RULES: Record<string, Record<string, number>> = {
  homocysteine: { folate: 1.5, b12: 1.2 },
  crp: { "omega-3": 1.0 },
  "hs-crp": { "omega-3": 1.0 },
  esr: { "omega-3": 1.0 },
};
const LOW_FLAGS = new Set(["low", "suboptimal", "deficient", "borderline"]);

export function labNutrientPriorities(client: { lab_markers?: unknown } | null): Record<string, number> {
  const out: Record<string, number> = {};
  const markers = client?.lab_markers;
  if (!Array.isArray(markers)) return out;
  for (const raw of markers) {
    const m = raw as LabMarker;
    const name = String(m?.marker_name ?? "").toLowerCase().trim();
    if (!name || EXCLUDE.some((x) => name.includes(x))) continue;
    const flag = String(m?.flag ?? "").toLowerCase().trim();
    if (LOW_FLAGS.has(flag)) {
      const weight = flag === "low" || flag === "deficient" ? 1.5 : 1.0;
      for (const [tag, needles] of Object.entries(MARKER_TO_TAG)) {
        if (needles.some((n) => name.includes(n))) out[tag] = Math.max(out[tag] ?? 0, weight);
      }
    }
    if (flag === "high") {
      for (const [needle, tags] of Object.entries(HIGH_RULES)) {
        if (name.includes(needle)) {
          for (const [tag, w] of Object.entries(tags)) out[tag] = Math.max(out[tag] ?? 0, w);
        }
      }
    }
  }
  return out;
}

export function recipeLabBoost(richIn: string[], priorities: Record<string, number>): number {
  if (!Object.keys(priorities).length) return 0;
  const rich = new Set(richIn.map((t) => t.toLowerCase()));
  return Object.entries(priorities).reduce((s, [tag, w]) => (rich.has(tag) ? s + w : s), 0);
}

/** Tags this recipe covers that the client is low on — for the picker badge. */
export function matchedPriorityTags(richIn: string[], priorities: Record<string, number>): string[] {
  const rich = new Set(richIn.map((t) => t.toLowerCase()));
  return Object.keys(priorities).filter((t) => rich.has(t));
}

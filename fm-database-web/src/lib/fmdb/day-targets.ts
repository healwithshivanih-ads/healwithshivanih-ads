/**
 * The client's daily target in grams, for the plan week — pure.
 *
 * The rule itself lives in ONE place, scripts/day_targets.py (BUILD-PLAN
 * "### Confirmed targets"); it runs on the Mac where the full record is, and
 * the staging copy projects its spec to Fly as client.yaml#day_targets. This
 * file only turns that spec into the grams for this week: calories from the
 * weight-loss phase (or maintenance) × the carb and fat shares.
 */

export interface DayTargetSpec {
  status: "ok" | "none";
  why?: string;
  client_line?: string;
  kcal?: { maintenance?: number; phases?: Record<string, number> };
  protein?: { low: number; high: number } | null;
  protein_note?: string | null;
  carb_share?: [number, number] | null;
  fat_share?: [number, number];
  fibre?: number | null;
}

export interface Band {
  low: number;
  high: number;
}

/** What the client sees. Every part optional: a part with no number is
 *  simply not shown, and `line` carries the one sentence some clients get
 *  instead of numbers. */
export interface DayTargets {
  protein?: Band;
  carbs?: Band;
  fat?: Band;
  fibre?: number;
  line?: string;
}

function phaseKcal(phases: Record<string, number>, week: number): number | undefined {
  const key = week <= 2 ? "wk1_2" : week <= 4 ? "wk3_4" : week <= 8 ? "wk5_8" : week <= 10 ? "wk9_10" : "wk11_12";
  return phases[key];
}

export function targetsForWeek(spec: unknown, week: number): DayTargets | null {
  const s = spec as DayTargetSpec | null | undefined;
  if (!s || typeof s !== "object") return null;
  if (s.status !== "ok") return s.client_line ? { line: s.client_line } : null;
  const kcal = (s.kcal?.phases ? phaseKcal(s.kcal.phases, Math.max(1, week || 1)) : undefined) ?? s.kcal?.maintenance;
  const out: DayTargets = {};
  if (s.protein && s.protein.low > 0) out.protein = { low: s.protein.low, high: s.protein.high };
  if (s.protein_note) out.line = s.protein_note;
  if (kcal && s.carb_share) out.carbs = { low: Math.round((kcal * s.carb_share[0]) / 4), high: Math.round((kcal * s.carb_share[1]) / 4) };
  if (kcal && s.fat_share) out.fat = { low: Math.round((kcal * s.fat_share[0]) / 9), high: Math.round((kcal * s.fat_share[1]) / 9) };
  if (typeof s.fibre === "number" && s.fibre > 0) out.fibre = s.fibre;
  return Object.keys(out).length ? out : null;
}

const band = (b: Band) => (b.low === b.high ? `${b.low} g` : `${b.low} to ${b.high} g`);

/** "Protein 92 to 116 g · Fat 49 to 74 g · Fibre 25 g" — no calories. */
export function targetLine(t: DayTargets): string {
  return [
    t.protein ? `Protein ${band(t.protein)}` : "",
    t.carbs ? `Carbs ${band(t.carbs)}` : "",
    t.fat ? `Fat ${band(t.fat)}` : "",
    t.fibre ? `Fibre ${t.fibre} g` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

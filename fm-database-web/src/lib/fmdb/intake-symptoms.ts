/**
 * Derive catalogue symptom slugs from a client's STRUCTURED intake-form fields.
 *
 * The public intake form captures symptoms as structured fields
 * (hair_loss_pattern, energy_crashes, bowel_pattern, pain_locations, …) but
 * never runs the symptom picker, so the intake session's `selected_symptoms`
 * is sparse or empty. The Analyse panel then only pre-selects "thyroid" (from
 * active_conditions) and the AI assessment misses the rest.
 *
 * This maps those structured fields → catalogue symptom slugs so the Analyse
 * panel pre-selects the client's real symptoms. Display-only — the coach still
 * reviews/deselects. Only slugs present in `validSlugs` are returned, so the
 * map can be generous; unknown slugs are silently dropped.
 */

type Dict = Record<string, unknown>;

function asArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase());
  if (v == null) return [];
  return [String(v).toLowerCase()];
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v).toLowerCase();
}
function asNums(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  const n = Number(v);
  return Number.isNaN(n) ? [] : [n];
}
function some(arr: string[], ...needles: string[]): boolean {
  return arr.some((a) => needles.some((n) => a.includes(n)));
}
function has(s: string, ...needles: string[]): boolean {
  return needles.some((n) => s.includes(n));
}

const NEG = new Set([
  "", "none", "no", "no_loss", "no concerns", "no acne", "not noticed",
  "no_concerns", "na", "n/a",
]);

export function deriveSymptomsFromIntake(
  client: Dict,
  validSlugs: Set<string>,
): string[] {
  const g = (k: string) => client[k];
  const out = new Set<string>();
  const add = (...slugs: string[]) => {
    for (const s of slugs) if (validSlugs.has(s)) out.add(s);
  };

  // Hair
  const hairLoss = asStr(g("hair_loss_pattern"));
  if (hairLoss && !NEG.has(hairLoss)) add("hair-loss");

  // Energy / fatigue
  const crashes = asArr(g("energy_crashes"));
  if (crashes.length) {
    add("chronic-fatigue");
    if (some(crashes, "meal")) add("daytime-fatigue");
  }
  if (some(asArr(g("postprandial_pattern")), "sleepy", "tired")) add("daytime-fatigue");

  // Bowel / GI
  const bowel = asArr(g("bowel_pattern"));
  if (some(bowel, "constipation", "straining", "incomplete")) add("constipation");
  if (some(bowel, "loose", "diarrh")) add("diarrhea");
  if (some(bowel, "blood")) add("rectal-bleeding");
  const bristol = asNums(g("bristol_stool_typical"));
  if (bristol.some((n) => n <= 2)) add("constipation");
  if (bristol.some((n) => n >= 6)) add("diarrhea");
  const dig = asStr(g("digestion_notes"));
  if (has(dig, "constipat")) add("constipation");
  if (has(dig, "acid", "reflux", "antacid")) add("heartburn");
  if (has(dig, "bloat")) add("bloating");
  if (has(dig, "headache")) add("headache");

  // Headache
  if (asArr(g("headache_type")).length) add("headache");

  // Pain
  const pains = asArr(g("pain_locations"));
  if (some(pains, "knee", "elbow", "shoulder", "hip", "hand", "wrist", "ankle", "joint")) {
    add("joint-pain");
  }
  if (pains.length >= 3 || some(pains, "back", "scapula", "sacrum", "spine")) {
    add("chronic-pain");
  }
  if (some(asArr(g("pain_quality")), "ache", "aching")) add("muscle-pain");

  // Histamine / food
  if (asArr(g("histamine_signals")).length) {
    add("food-sensitivities", "histamine-intolerance");
  }

  // Menstrual
  const endo = asArr(g("endometriosis_signals"));
  if (some(endo, "heavy", "clot")) add("heavy-periods");
  const repro = asArr(g("repro_diagnoses"));
  const ppSev = Number(g("period_pain_severity"));
  if (
    some(endo, "pain") ||
    some(repro, "endometriosis", "adenomyosis") ||
    (!Number.isNaN(ppSev) && ppSev >= 4) ||
    (asStr(g("period_pain_impact")) && asStr(g("period_pain_impact")) !== "none")
  ) {
    add("dysmenorrhea");
  }

  // Sleep
  if (some(asArr(g("wake_time_pattern")), "wake", "multiple", "early")) add("insomnia");
  if (has(asStr(g("time_to_fall_asleep")), "30_60", "over_60", "60")) add("insomnia");

  // Constitutional / skin / weight
  if (has(asStr(g("cold_heat_tolerance")), "cold")) add("cold-intolerance");
  if (some(asArr(g("skin_signs")), "dry")) add("dry-skin");
  if (has(asStr(g("weight_trend_current")), "gain")) add("unexplained-weight-gain");

  return [...out];
}

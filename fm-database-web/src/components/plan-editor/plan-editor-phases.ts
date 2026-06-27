/**
 * Plan duration + phase-timeline pure logic (Codex audit #6 — file split).
 *
 * Extracted verbatim from plan-editor.tsx: the duration presets, the topic →
 * recommended-weeks hints, and the date math that lays out Foundation / Build /
 * Maintenance phase boundaries. Pure (string/number in, data out) — unit-tested
 * in plan-editor-phases.test.ts.
 */

export const DURATION_OPTIONS = [
  { weeks: 4,  tag: "Quick reset",   desc: "Short check-in, monitoring reset" },
  { weeks: 6,  tag: "Starter",       desc: "Initial foundation phase" },
  { weeks: 8,  tag: "Foundation",    desc: "Gut, blood sugar, lifestyle" },
  { weeks: 12, tag: "Full protocol", desc: "Hormonal, thyroid, autoimmune" },
  { weeks: 16, tag: "Deep protocol", desc: "Complex multi-system cases" },
  { weeks: 18, tag: "Comprehensive", desc: "Long-term metabolic reset" },
] as const;

/** Topic → { recommended weeks, one-line rationale } */
export const TOPIC_DURATION_HINTS: Record<string, { weeks: number; rationale: string }> = {
  "hashimotos-thyroiditis":      { weeks: 12, rationale: "Thyroid antibody reduction typically needs 12 weeks of sustained gut & immune support." },
  "hypothyroidism":              { weeks: 12, rationale: "T3/T4 optimisation and symptom reversal generally requires a full 12-week protocol." },
  "subclinical-hypothyroidism":  { weeks: 12, rationale: "Subclinical cases benefit from 12 weeks before re-testing TSH and free hormones." },
  "autoimmune-thyroiditis":      { weeks: 12, rationale: "Autoimmune dampening needs consistent 12-week gut–immune intervention." },
  "perimenopause":               { weeks: 12, rationale: "Hormonal transitions require a full 12-week foundation before reassessment." },
  "menopause":                   { weeks: 12, rationale: "Menopausal symptom stabilisation benefits from 12+ weeks of consistent support." },
  "pcos":                        { weeks: 16, rationale: "PCOS involves overlapping insulin, adrenal and ovarian drivers — allow 16 weeks." },
  "insulin-resistance":          { weeks: 8,  rationale: "Blood sugar protocols show measurable improvement in 8 weeks with consistent adherence." },
  "blood-sugar-dysregulation":   { weeks: 8,  rationale: "Glycaemic stabilisation is typically achieved within an 8-week dietary reset." },
  "gut-microbiome":              { weeks: 8,  rationale: "Significant microbiome shifts occur by week 8; extend to 12 for dysbiosis repair." },
  "dysbiosis":                   { weeks: 12, rationale: "Full microbiome rehabilitation with 3-phase repair may need the full 12 weeks." },
  "leaky-gut":                   { weeks: 12, rationale: "Intestinal lining repair (4R protocol) runs 12 weeks for lasting permeability change." },
  "anxiety":                     { weeks: 8,  rationale: "Gut–brain axis support + nervous system regulation stabilises within 8 weeks." },
  "depression":                  { weeks: 12, rationale: "Neurotransmitter and inflammation interventions need 12 weeks to show sustained effect." },
  "chronic-fatigue":             { weeks: 12, rationale: "Multi-driver fatigue (adrenal, thyroid, nutrient) benefits from a 12-week protocol." },
  "adrenal-fatigue":             { weeks: 12, rationale: "HPA axis recalibration requires 12 weeks of sleep, stress and adaptogen support." },
  "insomnia":                    { weeks: 8,  rationale: "Sleep architecture typically improves within 8 weeks of targeted interventions." },
  "weight-management":           { weeks: 12, rationale: "Sustainable metabolic change takes 12 weeks — crash protocols tend to backfire." },
  "cardiovascular-health":       { weeks: 12, rationale: "Lipid and endothelial function changes are measurable at 12 weeks." },
  "liver-detoxification":        { weeks: 8,  rationale: "Phase I & II detoxification support shows results at 8 weeks." },
  "inflammation":                { weeks: 8,  rationale: "hsCRP and inflammatory markers typically respond within 8 weeks of dietary change." },
  "midlife-weight-gain":         { weeks: 12, rationale: "Hormonal, metabolic and lifestyle factors converge — 12 weeks allows each to be addressed." },
};

/** Returns the best-match duration hint for a list of primary topic slugs. */
export function getBestDurationHint(primaryTopics: string[]): { weeks: number; rationale: string } | null {
  for (const slug of primaryTopics) {
    if (TOPIC_DURATION_HINTS[slug]) return TOPIC_DURATION_HINTS[slug];
  }
  return null;
}

/** Adds `weeks` weeks to a YYYY-MM-DD string and returns a new YYYY-MM-DD string. */
export function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute phase boundaries from total weeks. Returns 2 or 3 phases. */
export function computePhases(totalWeeks: number, startDate: string): {
  name: string;
  color: string;
  textColor: string;
  startWeek: number;
  endWeek: number;
  startDate: string;
  endDate: string;
  pct: number;
}[] {
  if (totalWeeks <= 6) {
    // 2 phases: Foundation + Build
    const split = Math.ceil(totalWeeks / 2);
    return [
      { name: "Foundation", color: "#E8E4EF", textColor: "#2B2D42", startWeek: 1, endWeek: split,       startDate, endDate: addWeeks(startDate, split), pct: split / totalWeeks },
      { name: "Build",       color: "#2B2D42", textColor: "#ffffff",  startWeek: split + 1, endWeek: totalWeeks, startDate: addWeeks(startDate, split), endDate: addWeeks(startDate, totalWeeks), pct: (totalWeeks - split) / totalWeeks },
    ];
  }
  // 3 phases: Foundation / Build / Maintenance
  const f = Math.round(totalWeeks * 0.38); // ~38% Foundation
  const b = Math.round(totalWeeks * 0.38); // ~38% Build
  const m = totalWeeks - f - b;            // remainder Maintenance
  return [
    { name: "Foundation",  color: "#E8E4EF", textColor: "#2B2D42", startWeek: 1,   endWeek: f,          startDate,                          endDate: addWeeks(startDate, f),          pct: f / totalWeeks },
    { name: "Build",       color: "#2B2D42", textColor: "#ffffff",  startWeek: f+1, endWeek: f+b,        startDate: addWeeks(startDate, f),   endDate: addWeeks(startDate, f+b),       pct: b / totalWeeks },
    { name: "Maintenance", color: "#8D99AE", textColor: "#ffffff",  startWeek: f+b+1, endWeek: totalWeeks, startDate: addWeeks(startDate, f+b), endDate: addWeeks(startDate, totalWeeks), pct: m / totalWeeks },
  ];
}

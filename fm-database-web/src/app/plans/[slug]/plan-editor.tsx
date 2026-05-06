"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect, type MultiSelectOption } from "@/components/multi-select";
import { updatePlan, saveSupplementSources } from "./actions";
import type { SupplementSourcesMap } from "./actions";
import type { Plan } from "@/lib/fmdb/types";
import { ProtocolTemplatePicker } from "./protocol-template-picker";
import { PlanChatPanel } from "./plan-chat-panel";

interface SupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  duration_weeks?: number | null;
  titration?: string;
  coach_rationale?: string;
}

interface TrackingHabit {
  name: string;
  cadence: string;
}

interface Tracking {
  habits?: TrackingHabit[];
  symptoms_to_monitor?: string[];
  recheck_questions?: string[];
}

interface HypothesizedDriver {
  mechanism: string;
  reasoning: string;
}

interface PracticeItem {
  name: string;
  cadence: string;
  details?: string;
}

interface EducationModuleItem {
  target_kind: string; // "topic" | "mechanism" | "claim"
  target_slug: string;
  client_facing_summary?: string;
}

interface LabOrderItem {
  test: string;
  reason?: string;
}

interface ReferralItem {
  to: string;
  reason: string;
  urgency: string; // matches ReferralUrgency enum
}

const REFERRAL_URGENCIES = ["routine", "soon", "urgent", "emergency"] as const;

// Curated allowlist for the Education module topic picker.
// Excludes near-duplicates, noise, and overly niche entries so the dropdown
// stays navigable. Only add slugs that exist in the catalogue.
const EDUCATION_TOPIC_SLUGS = new Set([
  // ── Thyroid ──────────────────────────────────────────────────────────────
  "hypothyroidism",
  "subclinical-hypothyroidism",
  "hyperthyroidism",
  "hashimotos-thyroiditis",
  "autoimmune-thyroiditis",
  "t3-conversion-disorder",
  // ── Hormones / Women's health ─────────────────────────────────────────────
  "hrt",
  "perimenopause",
  "estrogen-dominance",
  "estrogen-metabolism",
  "low-progesterone",
  "estrobolome",
  "pcos",
  "testosterone-health",
  "sex-hormone-binding-globulin",
  "midlife-weight-gain",
  "hairfall",
  // ── Adrenal / Stress / Sleep ─────────────────────────────────────────────
  "adrenal-dysfunction",
  "hpa-axis-dysregulation",
  "chronic-stress",
  "stress-management",
  "insomnia",
  "nervous-system-regulation",
  "vagal-tone",
  "breathwork-for-health",
  // ── Mental / Emotional ────────────────────────────────────────────────────
  "anxiety",
  "emotional-wellbeing",
  "emotional-healing-chronic-disease",
  "mindfulness",
  "cognitive-decline",
  "nutrient-deficiency-depression",
  // ── Gut health ────────────────────────────────────────────────────────────
  "gut-dysfunction",
  "leaky-gut",
  "dysbiosis",
  "sibo",
  "h-pylori-infection",
  "ibs",
  "ibd",
  "gerd",
  "gerd-ppi-tapering",
  "hypochlorhydria",
  "constipation",
  "motility",
  "histamine-intolerance",
  "candida-overgrowth",
  "gut-brain-axis",
  "gut-hormone-axis",
  "5r-gut-restoration",
  "low-fodmap-diet",
  // ── Immune / Inflammation ─────────────────────────────────────────────────
  "chronic-inflammation",
  "autoimmune",
  "autoimmune-disease",
  "immune-resilience",
  "inflammaging",
  // ── Metabolic / Cardiometabolic ───────────────────────────────────────────
  "insulin-resistance",
  "blood-sugar-dysfunction",
  "prediabetes",
  "type-2-diabetes",
  "metabolic-syndrome",
  "dyslipidemia",
  "cardiometabolic-health",
  "cardiovascular-dysfunction",
  "hypertension",
  "visceral-adiposity",
  // ── Liver / Detox ─────────────────────────────────────────────────────────
  "liver-detoxification",
  "metabolic-detoxification",
  "nafld",
  "sluggish-bile-flow",
  "environmental-toxin-exposure",
  "heavy-metal-toxicity",
  "mold-mycotoxin-exposure",
  "toxic-body-burden",
  // ── Nutrients / Deficiencies ─────────────────────────────────────────────
  "iron-deficiency",
  "magnesium-insufficiency",
  "vitamin-d-deficiency",
  "vitamin-b12-deficiency",
  "folate-deficiency",
  "zinc-nutrition",
  "selenium-status",
  "essential-fatty-acids",
  "mitochondrial-health-nutrition",
  "methylation-mthfr",
  "drug-induced-nutrient-depletion",
  "fiber-gap",
  "scfa-short-chain-fatty-acids",
  // ── Diet / Food ───────────────────────────────────────────────────────────
  "food-sensitivities",
  "gluten-sensitivity",
  "elimination-diet",
  "anti-inflammatory-diet",
  "intermittent-fasting",
  "food-label-literacy",
  "mindful-intuitive-eating",
  "cooking-fats-and-cardiovascular-health",
  "oxalate-sensitivity",
  "nightshade-sensitivity",
  "salicylate-sensitivity",
  // ── Other conditions ──────────────────────────────────────────────────────
  "psoriasis",
  "dyspepsia",
  "food-sensitivity",
  "benign-prostatic-hyperplasia",
  "low-dose-naltrexone",
]);

export interface PlanEditorProps {
  plan: Plan;
  topicOptions: MultiSelectOption[];
  symptomOptions: MultiSelectOption[];
  mechanismOptions: MultiSelectOption[];
  supplementOptions: MultiSelectOption[];
  cookingOptions: MultiSelectOption[];
  remedyOptions: MultiSelectOption[];
  resourceOptions: MultiSelectOption[];
  /** Shared supplement product recommendations from ~/fm-plans/supplement-sources.yaml */
  supplementSources: SupplementSourcesMap;
  /** True when on-disk status is anything other than "draft". */
  locked: boolean;
  /** Client ID for the chat panel */
  clientId?: string;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x ?? null));
}

// ── Plan Timeline Card ─────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { weeks: 4,  tag: "Quick reset",   desc: "Short check-in, monitoring reset" },
  { weeks: 6,  tag: "Starter",       desc: "Initial foundation phase" },
  { weeks: 8,  tag: "Foundation",    desc: "Gut, blood sugar, lifestyle" },
  { weeks: 12, tag: "Full protocol", desc: "Hormonal, thyroid, autoimmune" },
  { weeks: 16, tag: "Deep protocol", desc: "Complex multi-system cases" },
  { weeks: 18, tag: "Comprehensive", desc: "Long-term metabolic reset" },
] as const;

/** Topic → { recommended weeks, one-line rationale } */
const TOPIC_DURATION_HINTS: Record<string, { weeks: number; rationale: string }> = {
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
function getBestDurationHint(primaryTopics: string[]): { weeks: number; rationale: string } | null {
  for (const slug of primaryTopics) {
    if (TOPIC_DURATION_HINTS[slug]) return TOPIC_DURATION_HINTS[slug];
  }
  return null;
}

/** Adds `weeks` weeks to a YYYY-MM-DD string and returns a new YYYY-MM-DD string. */
function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute phase boundaries from total weeks. Returns 2 or 3 phases. */
function computePhases(totalWeeks: number, startDate: string): {
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

interface PlanTimelineCardProps {
  startDate: string;
  weeks: number;
  primaryTopics: string[];
  locked: boolean;
  onStartDateChange: (d: string) => void;
  onWeeksChange: (w: number) => void;
}

function PlanTimelineCard({
  startDate,
  weeks,
  primaryTopics,
  locked,
  onStartDateChange,
  onWeeksChange,
}: PlanTimelineCardProps) {
  const hint = getBestDurationHint(primaryTopics);
  const endDate = startDate ? addWeeks(startDate, weeks) : null;
  const phases = startDate ? computePhases(weeks, startDate) : [];

  function fmt(d: string) {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric", month: "short",
    });
  }

  return (
    <Card className="border-brand-indigo/20 bg-brand-bone/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-brand flex items-center gap-2">
          📅 Plan timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Duration pills */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Duration
          </p>
          <div className="flex flex-wrap gap-2">
            {DURATION_OPTIONS.map((opt) => {
              const isSelected = weeks === opt.weeks;
              const isRecommended = hint?.weeks === opt.weeks;
              return (
                <button
                  key={opt.weeks}
                  type="button"
                  disabled={locked}
                  onClick={() => onWeeksChange(opt.weeks)}
                  className={[
                    "relative flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-all",
                    "min-w-[90px] text-sm",
                    isSelected
                      ? "border-brand-indigo bg-brand-indigo text-white shadow-sm"
                      : "border-border bg-background hover:border-brand-indigo/50 hover:bg-brand-bone/50",
                    locked ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <span className="font-semibold">{opt.weeks} wks</span>
                  <span className={`text-[10px] mt-0.5 ${isSelected ? "text-white/80" : "text-muted-foreground"}`}>
                    {opt.tag}
                  </span>
                  {isRecommended && !isSelected && (
                    <span className="absolute -top-1.5 -right-1.5 bg-brand-rose text-[8px] font-bold px-1 py-0.5 rounded-full text-white leading-none">
                      AI ✦
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Phase bar */}
        {phases.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Phases
            </p>
            {/* Visual bar */}
            <div className="flex rounded-lg overflow-hidden h-9 mb-1.5">
              {phases.map((ph, i) => (
                <div
                  key={ph.name}
                  style={{ width: `${ph.pct * 100}%`, backgroundColor: ph.color }}
                  className={[
                    "flex items-center justify-center text-[11px] font-semibold",
                    i > 0 ? "border-l border-white/30" : "",
                  ].join(" ")}
                >
                  <span style={{ color: ph.textColor }}>{ph.name}</span>
                </div>
              ))}
            </div>
            {/* Phase labels below */}
            <div className="flex gap-4">
              {phases.map((ph) => (
                <div key={ph.name} className="text-[11px] text-muted-foreground" style={{ width: `${ph.pct * 100}%` }}>
                  <span className="font-medium">Wk {ph.startWeek}–{ph.endWeek}</span>
                  <span className="ml-1">({fmt(ph.startDate)} → {fmt(ph.endDate)})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Start date + computed end */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Start date
            </p>
            <input
              type="date"
              value={startDate}
              disabled={locked}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="h-9 px-2 text-sm border rounded-md bg-background disabled:opacity-50"
            />
          </div>
          {endDate && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Recheck date
              </p>
              <div className="h-9 flex items-center text-sm font-medium text-brand-indigo">
                {new Date(endDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  ({weeks} weeks from start)
                </span>
              </div>
            </div>
          )}
        </div>

        {/* AI rationale hint */}
        {hint && (
          <div className="flex gap-2 rounded-md border border-brand-rose/30 bg-brand-rose/5 px-3 py-2 text-sm">
            <span className="shrink-0 text-brand-rose mt-0.5">✦</span>
            <div>
              <span className="font-medium text-brand-indigo">{hint.weeks} weeks suggested · </span>
              <span className="text-muted-foreground">{hint.rationale}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Lab Orders Editor ──────────────────────────────────────────────────────────

const LAB_GROUPS: { group: string; tests: { label: string; hint?: string }[] }[] = [
  {
    group: "Core baseline",
    tests: [
      { label: "CBC with differential", hint: "anaemia, immune status, platelet trends" },
      { label: "CMP (Comprehensive Metabolic Panel)", hint: "electrolytes, kidney, liver, glucose" },
      { label: "HbA1c", hint: "3-month blood sugar average" },
      { label: "eGFR + creatinine", hint: "kidney filtration rate" },
      { label: "Uric acid", hint: "gout risk, metabolic syndrome marker" },
    ],
  },
  {
    group: "Thyroid",
    tests: [
      { label: "TSH", hint: "pituitary signal — screen first" },
      { label: "Free T4 (fT4)", hint: "storage hormone output" },
      { label: "Free T3 (fT3)", hint: "active hormone — conversion step" },
      { label: "Reverse T3 (rT3)", hint: "stress/inflammation-driven pooling" },
      { label: "TPO antibodies", hint: "Hashimoto's autoimmunity" },
      { label: "Thyroglobulin antibodies (TgAb)", hint: "secondary Hashimoto's marker" },
    ],
  },
  {
    group: "Blood sugar & insulin",
    tests: [
      { label: "Fasting glucose", hint: "point-in-time blood sugar" },
      { label: "Fasting insulin", hint: "pancreatic load — early IR detector" },
      { label: "HOMA-IR (calculated)", hint: "insulin resistance index from glucose + insulin" },
      { label: "Post-meal glucose (2hr)", hint: "glucose disposal after a meal" },
      { label: "C-peptide", hint: "endogenous insulin production capacity" },
    ],
  },
  {
    group: "Lipids & cardiometabolic",
    tests: [
      { label: "Full lipid panel (TC, LDL, HDL, TG)", hint: "standard cardiovascular screen" },
      { label: "ApoB", hint: "particle count — better CV risk than LDL-C" },
      { label: "Lp(a)", hint: "genetic CV risk; does not change with lifestyle" },
      { label: "hs-CRP", hint: "low-grade systemic inflammation" },
      { label: "Homocysteine", hint: "methylation, B-vitamin status, CV risk" },
      { label: "Oxidised LDL", hint: "arterial damage signal" },
    ],
  },
  {
    group: "Hormones",
    tests: [
      { label: "Estradiol (E2)", hint: "oestrogen — phase-specific reference ranges" },
      { label: "Progesterone", hint: "day-21 luteal check for adequacy" },
      { label: "FSH", hint: "pituitary ovarian reserve signal" },
      { label: "LH", hint: "ovulation trigger; LH:FSH ratio in PCOS" },
      { label: "SHBG", hint: "binding protein — affects free hormone levels" },
      { label: "Free testosterone", hint: "androgenic activity, libido, energy" },
      { label: "Total testosterone", hint: "overall androgen pool" },
      { label: "DHEA-S", hint: "adrenal androgen reserve, longevity marker" },
      { label: "Prolactin", hint: "rule out pituitary issue; high in stress" },
      { label: "Morning serum cortisol", hint: "adrenal output at peak — 8–9 am draw" },
      { label: "DUTCH urine cortisol (24hr)", hint: "diurnal pattern, metabolites, sex-hormone metabolism" },
      { label: "AMH", hint: "ovarian reserve — age-independent" },
    ],
  },
  {
    group: "Nutrients & deficiencies",
    tests: [
      { label: "Vitamin D (25-OH)", hint: "immune, hormonal, mood regulation" },
      { label: "Vitamin B12", hint: "nerve function, methylation" },
      { label: "Folate (RBC)", hint: "cell synthesis, methylation cycle" },
      { label: "Ferritin", hint: "iron stores — most sensitive iron marker" },
      { label: "Serum iron + TIBC + transferrin saturation", hint: "full iron status picture" },
      { label: "RBC magnesium", hint: "serum Mg misses intracellular depletion" },
      { label: "Zinc (serum)", hint: "immunity, skin, thyroid conversion" },
      { label: "Copper", hint: "balance with zinc; ceruloplasmin if needed" },
      { label: "Iodine (spot urine)", hint: "thyroid substrate availability" },
      { label: "Vitamin A (retinol)", hint: "gut lining, immune, thyroid conversion" },
      { label: "Vitamin E (alpha-tocopherol)", hint: "antioxidant status" },
      { label: "Omega-3 index", hint: "EPA+DHA % in red cell membranes" },
    ],
  },
  {
    group: "Liver & detox",
    tests: [
      { label: "Liver function tests (ALT, AST, GGT, ALP, Bilirubin)", hint: "hepatic stress and bile flow" },
      { label: "GGT (standalone)", hint: "oxidative stress, alcohol, toxin load" },
      { label: "Bile acids (fasting)", hint: "bile recycling, NAFLD, gut-liver axis" },
    ],
  },
  {
    group: "Gut & microbiome",
    tests: [
      // ── Microbiome sequencing (India-available) ──────────────────────────
      { label: "LRB Gut Microbiome Test (Leucine Rich Bio)", hint: "India's leading 16S rRNA gut microbiome sequencing — diversity, dysbiosis, pathogen screen" },
      { label: "Gut microbiome sequencing (Mybiome / Aster / Neuberg)", hint: "shotgun or 16S sequencing — available at select Indian labs" },
      // ── Standard stool tests (widely available at Dr Lal / Thyrocare / SRL / Metropolis / Apollo) ──
      { label: "Comprehensive stool analysis (Dr Lal PathLabs / SRL / Metropolis)", hint: "culture + sensitivity, ova & parasites, occult blood, microscopy" },
      { label: "Stool routine & microscopy", hint: "pus cells, RBCs, ova, cysts, fat globules — available at any diagnostic lab" },
      { label: "Stool culture & sensitivity", hint: "identifies bacterial pathogens + antibiotic sensitivity" },
      { label: "Stool for ova, cysts & parasites (O&P)", hint: "Giardia, Cryptosporidium, Entamoeba, hookworm — very common in India" },
      { label: "Stool occult blood (FOBT)", hint: "colorectal bleeding screen — available everywhere" },
      // ── Functional markers (available at Dr Lal / Thyrocare / Metropolis / specialty labs) ──
      { label: "H. pylori (stool antigen)", hint: "most accurate non-invasive H. pylori test — widely available in India" },
      { label: "H. pylori breath test (UBT)", hint: "urea breath test — available at major diagnostic centres" },
      { label: "Stool calprotectin", hint: "intestinal inflammation — available at Dr Lal, SRL, Metropolis, Thyrocare" },
      { label: "Stool lactoferrin", hint: "mucosal inflammation marker — available at Neuberg, Apollo, SRL" },
      { label: "Pancreatic elastase (stool)", hint: "exocrine pancreatic insufficiency — Dr Lal PathLabs, Neuberg Diagnostics" },
      { label: "Secretory IgA (stool)", hint: "mucosal immune defence — specialty labs: Neuberg, Lilac Insights, some Apollo centres" },
      { label: "Zonulin (serum)", hint: "intestinal permeability / leaky gut — serum version available at Redcliffe, Dr Lal, Neuberg" },
      // ── Breath tests ──────────────────────────────────────────────────────
      { label: "SIBO breath test – lactulose (H₂ + CH₄)", hint: "small intestine bacterial overgrowth — available at Kokilaben, Fortis, select GI clinics" },
      { label: "Lactose intolerance breath test", hint: "hydrogen breath test — widely available at gastro centres" },
      { label: "Fructose intolerance breath test", hint: "hydrogen breath test — select gastro centres in major cities" },
    ],
  },
  {
    group: "Immune & inflammation",
    tests: [
      { label: "ESR", hint: "non-specific systemic inflammation" },
      { label: "ANA (antinuclear antibody)", hint: "autoimmune screen" },
      { label: "Anti-dsDNA", hint: "lupus-specific if ANA positive" },
      { label: "Rheumatoid factor (RF)", hint: "RA screen" },
      { label: "Anti-CCP", hint: "more specific RA marker" },
      { label: "IL-6 (interleukin-6)", hint: "inflammatory cytokine — chronic disease driver" },
    ],
  },
  {
    group: "Specialty / functional",
    tests: [
      { label: "Organic acids test (OAT)", hint: "mitochondria, gut dysbiosis, nutrient cofactors" },
      { label: "MTHFR genotyping", hint: "methylation capacity variants (C677T, A1298C)" },
      { label: "Heavy metals panel (blood or urine)", hint: "lead, mercury, arsenic, cadmium" },
      { label: "Food sensitivity IgG panel", hint: "delayed hypersensitivity triggers" },
      { label: "Micronutrient panel (SpectraCell / Genova)", hint: "intracellular functional status" },
      { label: "Mycotoxin / mould panel (urine)", hint: "chronic mould exposure indicator" },
    ],
  },
];

function LabOrdersEditor({
  labOrders,
  locked,
  onChange,
}: {
  labOrders: LabOrderItem[];
  locked: boolean;
  onChange: (next: LabOrderItem[]) => void;
}) {
  const selectedTests = new Set(labOrders.map((lo) => lo.test));

  function toggle(label: string, hint?: string) {
    if (selectedTests.has(label)) {
      onChange(labOrders.filter((lo) => lo.test !== label));
    } else {
      onChange([...labOrders, { test: label, reason: hint ?? "" }]);
    }
  }

  function updateReason(i: number, reason: string) {
    const next = [...labOrders];
    next[i] = { ...next[i], reason };
    onChange(next);
  }

  function addCustom() {
    onChange([...labOrders, { test: "", reason: "" }]);
  }

  function updateCustomTest(i: number, test: string) {
    const next = [...labOrders];
    next[i] = { ...next[i], test };
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* ── Picker ── */}
      <Card>
        <CardHeader>
          <CardTitle>Select tests to order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {LAB_GROUPS.map(({ group, tests }) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {group}
              </p>
              <div className="flex flex-wrap gap-2">
                {tests.map(({ label, hint }) => {
                  const selected = selectedTests.has(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={locked}
                      title={hint}
                      onClick={() => toggle(label, hint)}
                      className={[
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border bg-muted/30 text-foreground hover:bg-muted",
                        locked ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                      ].join(" ")}
                    >
                      {selected ? "✓ " : ""}{label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Selected list with reasons ── */}
      {labOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Ordered tests{" "}
              <span className="text-muted-foreground font-normal text-sm">
                ({labOrders.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {labOrders.map((lo, i) => {
              const isCustom = !LAB_GROUPS.flatMap((g) => g.tests).some(
                (t) => t.label === lo.test
              );
              return (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex items-center gap-2">
                    {isCustom ? (
                      <Input
                        placeholder="Test name"
                        value={lo.test}
                        disabled={locked}
                        onChange={(e) => updateCustomTest(i, e.target.value)}
                        className="flex-1"
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium">{lo.test}</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={locked}
                      onClick={() =>
                        onChange(labOrders.filter((_, j) => j !== i))
                      }
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      ✕
                    </Button>
                  </div>
                  <textarea
                    placeholder="Reason — what you're looking for, why it matters now"
                    value={lo.reason ?? ""}
                    disabled={locked}
                    onChange={(e) => updateReason(i, e.target.value)}
                    className="w-full text-sm border rounded-md p-2 min-h-[56px] bg-background resize-none"
                  />
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={addCustom}
            >
              + Add custom test
            </Button>
          </CardContent>
        </Card>
      )}

      {labOrders.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Select tests above, or{" "}
          <button
            type="button"
            disabled={locked}
            onClick={addCustom}
            className="underline hover:text-foreground"
          >
            add a custom test
          </button>
          .
        </div>
      )}
    </div>
  );
}

export function PlanEditor(props: PlanEditorProps) {
  const {
    plan: initial,
    topicOptions,
    symptomOptions,
    mechanismOptions,
    supplementOptions,
    cookingOptions,
    remedyOptions,
    supplementSources: initialSources,
    locked,
    clientId,
  } = props;

  const [plan, setPlan] = useState<Plan>(() => clone(initial));
  const [sources, setSources] = useState<SupplementSourcesMap>(() => clone(initialSources));
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<string | null>(null);

  // ── Timeline state (mirrors plan_period_* fields) ──────────────────────────
  const [timelineStart, setTimelineStart] = useState<string>(
    () => (initial.plan_period_start as string | undefined) ?? todayISO()
  );
  const [timelineWeeks, setTimelineWeeks] = useState<number>(
    () => (initial.plan_period_weeks as number | undefined) ?? 12
  );

  function handleTimelineChange(newStart: string, newWeeks: number) {
    const endDate = addWeeks(newStart, newWeeks);
    setPlan((p) => ({
      ...p,
      plan_period_start: newStart,
      plan_period_weeks: newWeeks,
      plan_period_recheck_date: endDate,
    }));
    setDirty(true);
  }

  function patch<K extends keyof Plan>(key: K, value: Plan[K]) {
    setPlan((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  function patchNutrition(field: string, value: unknown) {
    setPlan((p) => ({
      ...p,
      nutrition: { ...(p.nutrition ?? {}), [field]: value },
    }));
    setDirty(true);
  }

  function patchTracking(field: keyof Tracking, value: unknown) {
    setPlan((p) => ({
      ...p,
      tracking: { ...(p.tracking ?? {}), [field]: value },
    }));
    setDirty(true);
  }

  function applyTemplate(merged: Partial<Plan>) {
    setPlan((p) => ({ ...p, ...merged }));
    setDirty(true);
    toast.success("Protocol template applied — review changes and save");
  }

  function patchSource(slug: string, field: keyof SupplementSourcesMap[string], value: string) {
    setSources((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] ?? {}), [field]: value },
    }));
    setDirty(true);
  }

  function save() {
    setSaveResult(null);
    startTransition(async () => {
      const [planRes, srcRes] = await Promise.all([
        updatePlan(plan.slug, plan),
        saveSupplementSources(sources),
      ]);
      if (planRes.ok && srcRes.ok) {
        setDirty(false);
        setSaveResult("Saved.");
        toast.success("Plan saved");
      } else {
        const err = !planRes.ok ? planRes.error : !srcRes.ok ? srcRes.error : "Save failed";
        setSaveResult(`Error: ${err}`);
        toast.error(err ?? "Save failed");
      }
    });
  }

  const supplements: SupplementItem[] =
    (plan.supplement_protocol as SupplementItem[]) ?? [];
  const drivers: HypothesizedDriver[] =
    (plan.hypothesized_drivers as HypothesizedDriver[]) ?? [];
  const tracking: Tracking = (plan.tracking as Tracking) ?? {};
  const nutrition = (plan.nutrition as Record<string, unknown>) ?? {};
  const lifestyle: PracticeItem[] =
    (plan.lifestyle_practices as PracticeItem[]) ?? [];
  const education: EducationModuleItem[] =
    (plan.education as EducationModuleItem[]) ?? [];
  const labOrders: LabOrderItem[] = (plan.lab_orders as LabOrderItem[]) ?? [];
  const referrals: ReferralItem[] = (plan.referrals as ReferralItem[]) ?? [];
  const nutritionAdd: string[] = (nutrition.add as string[]) ?? [];
  const nutritionReduce: string[] = (nutrition.reduce as string[]) ?? [];

  // Filtered topic list for the Education module — curated, no duplicates.
  const educationTopicOptions = topicOptions.filter((o) =>
    EDUCATION_TOPIC_SLUGS.has(o.value)
  );

  function optionsForKind(kind: string): MultiSelectOption[] {
    if (kind === "topic") return topicOptions;
    if (kind === "mechanism") return mechanismOptions;
    // claim — we don't load claims options into the editor; fall back to empty
    return [];
  }

  return (
    <div className="space-y-4">
      {locked && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm">
          This plan is <strong>{plan.status}</strong> — switch back to drafts
          to edit, or use the lifecycle CLI (
          <code>fmdb plan-revoke</code> / <code>plan-supersede</code>) to make
          a new revision.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 sticky top-0 z-10 bg-background/80 backdrop-blur py-2 -mx-2 px-2">
        <div className="text-sm text-muted-foreground">
          {dirty ? (
            <span className="text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          ) : (
            <span>Up to date</span>
          )}
          {saveResult && <span className="ml-3">{saveResult}</span>}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || isPending || locked}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <ProtocolTemplatePicker onApply={applyTemplate} disabled={locked} />

      {/* ── Plan timeline ── */}
      <PlanTimelineCard
        startDate={timelineStart}
        weeks={timelineWeeks}
        primaryTopics={(plan.primary_topics as string[]) ?? []}
        locked={locked}
        onStartDateChange={(d) => {
          setTimelineStart(d);
          handleTimelineChange(d, timelineWeeks);
        }}
        onWeeksChange={(w) => {
          setTimelineWeeks(w);
          handleTimelineChange(timelineStart, w);
        }}
      />

      {/* ── Supplement schedule (shown when plan has supplements) ── */}
      {((plan.supplement_protocol as SupplementItem[]) ?? []).length > 0 && (
        <SupplementScheduleCard supplements={(plan.supplement_protocol as SupplementItem[]) ?? []} />
      )}

      <Tabs defaultValue="assessment">
        <TabsList>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="lifestyle">Lifestyle</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="supplements">Supplements</TabsTrigger>
          <TabsTrigger value="labs">Labs</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="notes">Notes &amp; Raw</TabsTrigger>
          <TabsTrigger value="chat">💬 Chat</TabsTrigger>
        </TabsList>

        {/* ─────────── Assessment ─────────── */}
        <TabsContent value="assessment">
          <Card>
            <CardHeader>
              <CardTitle>Assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Primary topics
                </label>
                <MultiSelect
                  options={topicOptions}
                  value={plan.primary_topics ?? []}
                  onChange={(v) => patch("primary_topics", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Contributing topics
                </label>
                <MultiSelect
                  options={topicOptions}
                  value={plan.contributing_topics ?? []}
                  onChange={(v) => patch("contributing_topics", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Presenting symptoms
                </label>
                <MultiSelect
                  options={symptomOptions}
                  value={plan.presenting_symptoms ?? []}
                  onChange={(v) => patch("presenting_symptoms", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Hypothesized drivers
                </label>
                <div className="space-y-3">
                  {drivers.map((d, i) => (
                    <div
                      key={i}
                      className="border rounded-md p-3 space-y-2 bg-muted/20"
                    >
                      <div className="flex gap-2">
                        <select
                          value={d.mechanism}
                          onChange={(e) => {
                            const next = [...drivers];
                            next[i] = { ...next[i], mechanism: e.target.value };
                            patch("hypothesized_drivers", next);
                          }}
                          className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                        >
                          <option value="">— mechanism —</option>
                          {mechanismOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} ({o.value})
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const next = drivers.filter((_, j) => j !== i);
                            patch("hypothesized_drivers", next);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      <textarea
                        value={d.reasoning}
                        onChange={(e) => {
                          const next = [...drivers];
                          next[i] = { ...next[i], reasoning: e.target.value };
                          patch("hypothesized_drivers", next);
                        }}
                        placeholder="Reasoning — why this is in play for this client"
                        className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patch("hypothesized_drivers", [
                        ...drivers,
                        { mechanism: "", reasoning: "" },
                      ])
                    }
                  >
                    + Add driver
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Supplements ─────────── */}
        <TabsContent value="supplements">
          <Card>
            <CardHeader>
              <CardTitle>Supplement protocol</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {supplements.map((s, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2 items-center">
                    <select
                      value={s.supplement_slug}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = {
                          ...next[i],
                          supplement_slug: e.target.value,
                        };
                        patch("supplement_protocol", next);
                      }}
                      className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                    >
                      <option value="">— supplement —</option>
                      {supplementOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label} ({o.value})
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "supplement_protocol",
                          supplements.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Form (e.g. capsule)"
                      value={s.form ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], form: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Dose (e.g. 200-400 mg)"
                      value={s.dose ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], dose: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Timing (e.g. evening)"
                      value={s.timing ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], timing: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Take with food"
                      value={s.take_with_food ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = {
                          ...next[i],
                          take_with_food: e.target.value,
                        };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Duration (weeks)"
                      value={s.duration_weeks ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        const v = e.target.value;
                        next[i] = {
                          ...next[i],
                          duration_weeks: v === "" ? null : Number(v),
                        };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Titration"
                      value={s.titration ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], titration: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                  </div>
                  <textarea
                    placeholder="Coach rationale — why for this client"
                    value={s.coach_rationale ?? ""}
                    onChange={(e) => {
                      const next = [...supplements];
                      next[i] = {
                        ...next[i],
                        coach_rationale: e.target.value,
                      };
                      patch("supplement_protocol", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />

                  {/* ── Source from (shared product recommendation) ── */}
                  {s.supplement_slug && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground select-none py-1 flex items-center gap-1.5">
                        <span className="font-medium text-foreground/70">📦 Source from</span>
                        {sources[s.supplement_slug]?.url && (
                          <a
                            href={sources[s.supplement_slug].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 underline text-[10px]"
                          >
                            {sources[s.supplement_slug].brand || "link ↗"}
                          </a>
                        )}
                        {!sources[s.supplement_slug]?.url && sources[s.supplement_slug]?.brand && (
                          <span className="text-[10px] text-foreground/60">{sources[s.supplement_slug].brand}</span>
                        )}
                        {!sources[s.supplement_slug]?.brand && !sources[s.supplement_slug]?.url && (
                          <span className="text-[10px] text-muted-foreground italic">not set</span>
                        )}
                      </summary>
                      <div className="mt-2 space-y-2 pl-1 border-l-2 border-muted">
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Brand / product name"
                            value={sources[s.supplement_slug]?.brand ?? ""}
                            onChange={(e) => patchSource(s.supplement_slug, "brand", e.target.value)}
                            className="text-xs h-8"
                          />
                          <Input
                            placeholder="Affiliate / buy URL"
                            value={sources[s.supplement_slug]?.url ?? ""}
                            onChange={(e) => patchSource(s.supplement_slug, "url", e.target.value)}
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                        <Input
                          placeholder="Code (e.g. SHIVANI10)"
                          value={sources[s.supplement_slug]?.code ?? ""}
                          onChange={(e) => patchSource(s.supplement_slug, "code", e.target.value)}
                          className="text-xs h-8 w-48"
                        />
                        {sources[s.supplement_slug]?.vitaone_ref && (
                          <p className="text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                            <span className="font-medium">VitaOne ref:</span>{" "}
                            {sources[s.supplement_slug].vitaone_ref}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          Shared across all plans — changes apply to all clients.
                        </p>
                      </div>
                    </details>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("supplement_protocol", [
                    ...supplements,
                    {
                      supplement_slug: "",
                      form: "",
                      dose: "",
                      timing: "",
                      take_with_food: "",
                      duration_weeks: null,
                      titration: "",
                      coach_rationale: "",
                    },
                  ])
                }
              >
                + Add supplement
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Tracking ─────────── */}
        <TabsContent value="tracking">
          <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Habits
                </label>
                <div className="space-y-2">
                  {(tracking.habits ?? []).map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="Name (e.g. nightly walk)"
                        value={h.name}
                        onChange={(e) => {
                          const next = [...(tracking.habits ?? [])];
                          next[i] = { ...next[i], name: e.target.value };
                          patchTracking("habits", next);
                        }}
                      />
                      <Input
                        placeholder="Cadence"
                        value={h.cadence}
                        onChange={(e) => {
                          const next = [...(tracking.habits ?? [])];
                          next[i] = { ...next[i], cadence: e.target.value };
                          patchTracking("habits", next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const next = (tracking.habits ?? []).filter(
                            (_, j) => j !== i
                          );
                          patchTracking("habits", next);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchTracking("habits", [
                        ...(tracking.habits ?? []),
                        { name: "", cadence: "" },
                      ])
                    }
                  >
                    + Add habit
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Symptoms to monitor
                </label>
                <MultiSelect
                  options={symptomOptions}
                  value={tracking.symptoms_to_monitor ?? []}
                  onChange={(v) => patchTracking("symptoms_to_monitor", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Recheck questions
                </label>
                <div className="space-y-2">
                  {(tracking.recheck_questions ?? []).map((q, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={q}
                        onChange={(e) => {
                          const next = [...(tracking.recheck_questions ?? [])];
                          next[i] = e.target.value;
                          patchTracking("recheck_questions", next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const next = (
                            tracking.recheck_questions ?? []
                          ).filter((_, j) => j !== i);
                          patchTracking("recheck_questions", next);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchTracking("recheck_questions", [
                        ...(tracking.recheck_questions ?? []),
                        "",
                      ])
                    }
                  >
                    + Add question
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Nutrition (partial; multi-selects only) ─────────── */}
        <TabsContent value="nutrition">
          <Card>
            <CardHeader>
              <CardTitle>Nutrition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Pattern
                </label>
                <Input
                  value={(nutrition.pattern as string) ?? ""}
                  onChange={(e) => patchNutrition("pattern", e.target.value)}
                  placeholder="e.g. gentle anti-inflammatory"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Meal timing
                </label>
                <Input
                  value={(nutrition.meal_timing as string) ?? ""}
                  onChange={(e) =>
                    patchNutrition("meal_timing", e.target.value)
                  }
                  placeholder="e.g. 12-hour overnight fast"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Cooking adjustments
                </label>
                <MultiSelect
                  options={cookingOptions}
                  value={(nutrition.cooking_adjustments as string[]) ?? []}
                  onChange={(v) => patchNutrition("cooking_adjustments", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Home remedies
                </label>
                <MultiSelect
                  options={remedyOptions}
                  value={(nutrition.home_remedies as string[]) ?? []}
                  onChange={(v) => patchNutrition("home_remedies", v)}
                />
              </div>
              <FreeformStringList
                label="Foods to add"
                value={nutritionAdd}
                onChange={(v) => patchNutrition("add", v)}
                placeholder="e.g. cooked leafy greens"
                addLabel="+ Add food"
              />
              <FreeformStringList
                label="Foods to reduce"
                value={nutritionReduce}
                onChange={(v) => patchNutrition("reduce", v)}
                placeholder="e.g. ultra-processed snacks"
                addLabel="+ Add food"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Lifestyle ─────────── */}
        <TabsContent value="lifestyle">
          <Card>
            <CardHeader>
              <CardTitle>Lifestyle practices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lifestyle.map((p, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="Name (e.g. morning sunlight)"
                      value={p.name}
                      onChange={(e) => {
                        const next = [...lifestyle];
                        next[i] = { ...next[i], name: e.target.value };
                        patch("lifestyle_practices", next);
                      }}
                    />
                    <Input
                      placeholder="Cadence (e.g. daily)"
                      value={p.cadence}
                      onChange={(e) => {
                        const next = [...lifestyle];
                        next[i] = { ...next[i], cadence: e.target.value };
                        patch("lifestyle_practices", next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "lifestyle_practices",
                          lifestyle.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <textarea
                    placeholder="Details — how to do it, what to expect"
                    value={p.details ?? ""}
                    onChange={(e) => {
                      const next = [...lifestyle];
                      next[i] = { ...next[i], details: e.target.value };
                      patch("lifestyle_practices", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("lifestyle_practices", [
                    ...lifestyle,
                    { name: "", cadence: "", details: "" },
                  ])
                }
              >
                + Add practice
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Education ─────────── */}
        <TabsContent value="education">
          <Card>
            <CardHeader>
              <CardTitle>Education modules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {education.map((em, i) => {
                // Education tab uses a curated subset for topics to avoid duplicates.
                const opts =
                  em.target_kind === "topic"
                    ? educationTopicOptions
                    : optionsForKind(em.target_kind);
                return (
                  <div
                    key={i}
                    className="border rounded-md p-3 space-y-2 bg-muted/20"
                  >
                    <div className="flex gap-2">
                      <select
                        value={em.target_kind}
                        onChange={(e) => {
                          const next = [...education];
                          // Changing kind clears the slug — slugs aren't
                          // interchangeable across topic/mechanism/claim.
                          next[i] = {
                            ...next[i],
                            target_kind: e.target.value,
                            target_slug: "",
                          };
                          patch("education", next);
                        }}
                        className="h-9 px-2 text-sm border rounded-md bg-background"
                      >
                        <option value="topic">topic</option>
                        <option value="mechanism">mechanism</option>
                        <option value="claim">claim</option>
                      </select>
                      <select
                        value={em.target_slug}
                        onChange={(e) => {
                          const next = [...education];
                          next[i] = { ...next[i], target_slug: e.target.value };
                          patch("education", next);
                        }}
                        className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                      >
                        <option value="">
                          {em.target_kind === "claim"
                            ? "— claim slug (paste below) —"
                            : `— ${em.target_kind} —`}
                        </option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label} ({o.value})
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch(
                            "education",
                            education.filter((_, j) => j !== i)
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    {em.target_kind === "claim" && (
                      <Input
                        placeholder="Claim slug (no picker for claims yet)"
                        value={em.target_slug}
                        onChange={(e) => {
                          const next = [...education];
                          next[i] = {
                            ...next[i],
                            target_slug: e.target.value,
                          };
                          patch("education", next);
                        }}
                      />
                    )}
                    <textarea
                      placeholder="Client-facing summary — what you'll actually say"
                      value={em.client_facing_summary ?? ""}
                      onChange={(e) => {
                        const next = [...education];
                        next[i] = {
                          ...next[i],
                          client_facing_summary: e.target.value,
                        };
                        patch("education", next);
                      }}
                      className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                    />
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("education", [
                    ...education,
                    {
                      target_kind: "topic",
                      target_slug: "",
                      client_facing_summary: "",
                    },
                  ])
                }
              >
                + Add module
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Labs ─────────── */}
        <TabsContent value="labs">
          <LabOrdersEditor
            labOrders={labOrders}
            locked={locked}
            onChange={(next) => patch("lab_orders", next)}
          />
        </TabsContent>

        {/* ─────────── Referrals ─────────── */}
        <TabsContent value="referrals">
          <Card>
            <CardHeader>
              <CardTitle>Referrals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {referrals.map((r, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="To (role/specialty — e.g. menopause-certified clinician)"
                      value={r.to}
                      onChange={(e) => {
                        const next = [...referrals];
                        next[i] = { ...next[i], to: e.target.value };
                        patch("referrals", next);
                      }}
                    />
                    <select
                      value={r.urgency || "routine"}
                      onChange={(e) => {
                        const next = [...referrals];
                        next[i] = { ...next[i], urgency: e.target.value };
                        patch("referrals", next);
                      }}
                      className="h-9 px-2 text-sm border rounded-md bg-background"
                    >
                      {REFERRAL_URGENCIES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "referrals",
                          referrals.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <textarea
                    placeholder="Reason — why this referral, what you want them to look at"
                    value={r.reason}
                    onChange={(e) => {
                      const next = [...referrals];
                      next[i] = { ...next[i], reason: e.target.value };
                      patch("referrals", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("referrals", [
                    ...referrals,
                    { to: "", reason: "", urgency: "routine" },
                  ])
                }
              >
                + Add referral
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="resources">
          <Card>
            <CardHeader>
              <CardTitle>Attached resources</CardTitle>
            </CardHeader>
            <CardContent>
              {props.resourceOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No resources found at <code>~/fm-resources/</code>.
                </p>
              ) : (
                <MultiSelect
                  options={props.resourceOptions}
                  value={(plan.attached_resources as string[]) ?? []}
                  onChange={(v) => patch("attached_resources", v)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Notes & Raw ─────────── */}
        <TabsContent value="notes">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Notes for coach</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <textarea
                  value={(plan.notes_for_coach as string) ?? ""}
                  onChange={(e) => patch("notes_for_coach", e.target.value)}
                  placeholder="Private working notes…"
                  className="w-full text-sm border rounded-md p-2 min-h-[120px] bg-background font-mono"
                />
              </CardContent>
            </Card>

            {/* Check-in timeline — parsed from notes_for_coach check-in blocks */}
            <CheckInTimeline notesForCoach={(plan.notes_for_coach as string) ?? ""} />

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-normal">Raw plan (read-only)</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-x-auto max-h-[400px]">
                  {JSON.stringify(plan, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─────────── Chat ─────────── */}
        <TabsContent value="chat">
          <Card>
            <CardHeader>
              <CardTitle>AI Plan Assistant</CardTitle>
            </CardHeader>
            <CardContent>
              <PlanChatPanel
                slug={plan.slug as string}
                clientId={clientId ?? ""}
                isLocked={locked}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-xs text-muted-foreground flex gap-4 pt-2 border-t">
        <span>
          Status: <Badge variant="outline">{plan.status ?? "draft"}</Badge>
        </span>
        <span>Version: {plan.version ?? 1}</span>
        <span>Updated: {String(plan.updated_at ?? "—")}</span>
      </div>
    </div>
  );
}

// ─── Supplement Schedule ─────────────────────────────────────────────────────
// Groups supplements by timing slot and renders a client-readable daily schedule.

type TimingSlot = "morning" | "midday" | "evening" | "bedtime" | "anytime";

function classifyTiming(timing: string | undefined): TimingSlot {
  const t = (timing ?? "").toLowerCase();
  if (/bed|night|sleep/.test(t)) return "bedtime";
  if (/evening|pm\b|afternoon/.test(t)) return "evening";
  if (/midday|lunch|noon/.test(t)) return "midday";
  if (/morning|am\b|wake|fasted|breakfast/.test(t)) return "morning";
  return "anytime";
}

const SLOT_META: Record<TimingSlot, { label: string; icon: string; bg: string }> = {
  morning:  { label: "Morning",  icon: "🌅", bg: "bg-amber-50  border-amber-200"  },
  midday:   { label: "Midday",   icon: "☀️",  bg: "bg-yellow-50 border-yellow-200" },
  evening:  { label: "Evening",  icon: "🌆", bg: "bg-blue-50   border-blue-200"   },
  bedtime:  { label: "Bedtime",  icon: "🌙", bg: "bg-indigo-50 border-indigo-200" },
  anytime:  { label: "Anytime",  icon: "💊", bg: "bg-muted/40  border-border"     },
};

const SLOT_ORDER: TimingSlot[] = ["morning", "midday", "evening", "bedtime", "anytime"];

function SupplementScheduleCard({ supplements }: { supplements: SupplementItem[] }) {
  const grouped = new Map<TimingSlot, SupplementItem[]>();
  for (const slot of SLOT_ORDER) grouped.set(slot, []);
  for (const s of supplements) {
    const slot = classifyTiming(s.timing);
    grouped.get(slot)!.push(s);
  }
  const filledSlots = SLOT_ORDER.filter((sl) => (grouped.get(sl)?.length ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          📅 Daily supplement schedule
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-grouped from timing fields · {supplements.length} supplement{supplements.length !== 1 ? "s" : ""} total
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filledSlots.map((slot) => {
            const meta = SLOT_META[slot];
            const items = grouped.get(slot)!;
            return (
              <div key={slot} className={`rounded-lg border p-3 ${meta.bg}`}>
                <div className="text-xs font-bold mb-2 flex items-center gap-1.5">
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                  <span className="ml-auto text-muted-foreground font-normal">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((s, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-medium">
                        {s.supplement_slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      {s.dose && <span className="text-muted-foreground"> · {s.dose}</span>}
                      {s.form && <span className="text-muted-foreground"> ({s.form})</span>}
                      {s.take_with_food && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {s.take_with_food}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Check-in Timeline ───────────────────────────────────────────────────────
// Parses the structured check-in blocks that CheckInForm appends to
// notes_for_coach and renders them as a visual timeline.

interface CheckInEntry {
  date: string;
  content: string;
}

function parseCheckIns(notesForCoach: string): CheckInEntry[] {
  // The append format is: "\n\n---\n📋 Check-in YYYY-MM-DD\n<content>"
  const MARKER = /\n\n---\n📋 Check-in /;
  const parts = notesForCoach.split(MARKER);
  // parts[0] is base notes before any check-ins; skip it
  return parts.slice(1).map((part) => {
    const firstNewline = part.indexOf("\n");
    const date = firstNewline === -1 ? part.trim() : part.slice(0, firstNewline).trim();
    const content = firstNewline === -1 ? "" : part.slice(firstNewline + 1).trim();
    return { date, content };
  }).reverse(); // newest first
}

function renderMarkdownLine(line: string): string {
  // Simple inline markdown: **bold** and *italic*
  return line
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function CheckInTimeline({ notesForCoach }: { notesForCoach: string }) {
  const entries = parseCheckIns(notesForCoach);
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span>📋 Check-in history</span>
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {entries.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Appended automatically from each check-in session. Read-only.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="relative pl-4 border-l-2 pb-1"
              style={{ borderColor: "var(--brand-lavender)" }}
            >
              {/* Date marker */}
              <div
                className="text-[11px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: "var(--brand-indigo)" }}
              >
                {entry.date}
              </div>
              {/* Content lines */}
              <div className="space-y-0.5">
                {entry.content.split("\n").map((line, j) => {
                  if (!line.trim()) return null;
                  return (
                    <p
                      key={j}
                      className="text-xs text-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownLine(line) }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface FreeformStringListProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}

/** Vertical list of freeform string rows with Add at bottom + Remove per row. */
function FreeformStringList({
  label,
  value,
  onChange,
  placeholder,
  addLabel = "+ Add",
}: FreeformStringListProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={v}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...value];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, ""])}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect, type MultiSelectOption } from "@/components/multi-select";
import { updatePlan, saveSupplementSources, checkSupplementInteractionsAction } from "@/lib/server-actions/plans";
import { resolveSupplementProducts } from "@/lib/server-actions/supplement-links";
import type { SupplementSourcesMap, SupplementInteraction, DrugCaution } from "@/lib/server-actions/plans";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";
import { stripBrand } from "@/lib/fmdb/supplement-display";
// ProtocolTemplatePicker removed — superseded by the unified AttachedProtocolsPanel
// on the plan edit page, which handles both protocol selection and content seeding.
import { PlanChatPanel } from "./plan-chat-panel";
import { LifecyclePanel } from "./lifecycle-panel";
import { RecipeSuggestionsCard } from "./recipe-suggestions-card";
import { MedicationImpactPanel } from "@/components/client-widgets/medication-impact-panel";
import {
  DURATION_OPTIONS,
  TOPIC_DURATION_HINTS,
  getBestDurationHint,
  addWeeks,
  todayISO,
  computePhases,
} from "./plan-editor-phases";

interface SupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  duration_weeks?: number | null;
  // Protocol week this supplement is introduced (1-indexed; default 1 =
  // start now). Phased protocols (5R etc.) stagger supplements — the
  // client-facing shopping list + schedule badge each by start week.
  start_week?: number | null;
  titration?: string;
  coach_rationale?: string;
  // v0.72: short coach-readable phrases the suggester / rework AI used
  // to cite the intake observations that justified this recommendation.
  // Empty when not intake-driven. Rendered as a 💡 audit chip-row below
  // the recommendation card. Coach can edit / remove freely.
  intake_evidence?: string[];
  // Per-supplement display override (e.g. "Vegetarian Omega-3"). Used to
  // resolve the retailer/product for the capsule-dosing hint.
  display_name?: string | null;
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
  intake_evidence?: string[];   // v0.72 — see SupplementItem
}

interface PracticeItem {
  name: string;
  cadence: string;
  details?: string;
  intake_evidence?: string[];   // v0.72 — see SupplementItem
}

interface EducationModuleItem {
  target_kind: string; // "topic" | "mechanism" | "claim"
  target_slug: string;
  client_facing_summary?: string;
}

interface LabOrderItem {
  test: string;
  reason?: string;
  intake_evidence?: string[];   // v0.72 — see SupplementItem
}

interface ReferralItem {
  to: string;
  reason: string;
  urgency: string; // matches ReferralUrgency enum
}

// Bespoke per-client kitchen remedy (NutritionPlan.custom_remedies).
interface CustomRemedyT {
  name: string;
  kind?: string;        // churan | tea | juice | infused_water | other
  ingredients?: string;
  preparation?: string;
  timing?: string;
  reason?: string;
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
  /** Ayurveda context from the client (the Plan editor doesn't load the
   *  client itself). When ayurvedaEnabled, the editor shows the Ayurveda
   *  section. Constitution + the latest AI read are shown read-only for
   *  context — the editable per-plan content lives on plan.ayurveda. */
  ayurvedaEnabled?: boolean;
  ayurvedaConstitution?: string;
  ayurvedaAssessment?: Record<string, unknown> | null;
  /** Tissue-salt (Schüssler) module — on when 'schussler_salts' is in the
   *  client's plan_modules. Shows the 🧂 tissue-salts editor section. */
  schusslerEnabled?: boolean;
  /** TissueSalt catalogue options (slug → display) for the salt picker. */
  tissueSaltOptions?: MultiSelectOption[];
  /** Lifecycle panel props — passed through so the 🚀 Lifecycle tab can render inline */
  lifecycleProps: {
    status: PlanStatus | undefined;
    version?: number;
    catalogueSnapshot?: { git_sha?: string; snapshot_date?: string } | null;
    statusHistory: Array<{ state?: string; by?: string; at?: string; reason?: string }>;
    supersedes?: string;
    allPlanSlugs: string[];
  };
}

/**
 * Render the AI's intake-citation audit chips below a recommendation
 * (SupplementItem / HypothesizedDriver / PracticeItem / LabOrderItem).
 *
 * The AI populates `intake_evidence: string[]` on each recommendation when
 * an intake observation justified it — see suggester.py system-prompt rule
 * #27 and assess-rework.py's INTAKE-EVIDENCE TRACEABILITY block. This
 * surface lets the coach see WHY each recommendation came up, inline,
 * without scrolling away to the IntakeInsightsCard on the client overview.
 *
 * Coach can edit / remove citations freely. Empty when not intake-driven —
 * the whole panel hides in that case to stay quiet.
 */
function IntakeEvidenceChips({
  value,
  onChange,
  locked,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
  locked?: boolean;
}) {
  const items = value ?? [];
  if (items.length === 0) return null;
  const handleRemove = (idx: number) => {
    if (!onChange || locked) return;
    onChange(items.filter((_, i) => i !== idx));
  };
  return (
    <div
      className="mt-2 px-2.5 py-2 rounded border border-indigo-100 bg-indigo-50/30"
      title="Intake observations the AI cited when generating this recommendation. Coach can edit / remove."
    >
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-indigo-700/80 font-medium mb-1.5">
        <span aria-hidden>💡</span>
        <span>From intake</span>
        <span className="opacity-50">·</span>
        <span className="opacity-70">{items.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((ev, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white border border-indigo-200 text-indigo-900"
          >
            <span>{ev}</span>
            {!locked && onChange && (
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="opacity-50 hover:opacity-100 text-[12px] leading-none"
                aria-label={`Remove citation: ${ev}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x ?? null));
}

// ── Plan Timeline Card ─────────────────────────────────────────────────────────


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
                  {/* v0.72: AI's intake citations for this lab order. */}
                  <IntakeEvidenceChips
                    value={lo.intake_evidence}
                    locked={locked}
                    onChange={(next_ev) => {
                      const next = [...labOrders];
                      next[i] = { ...next[i], intake_evidence: next_ev };
                      onChange(next);
                    }}
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

// ── Supplement Combobox ────────────────────────────────────────────────────────
// Typeahead input that filters catalog options while typing.
// Allows freeform values (not restricted to catalog).
// Shows "✓ catalog" badge when a catalog match is active.
function SupplementCombobox({
  value,
  options,
  allSlugs,
  onChange,
  disabled,
}: {
  value: string;
  options: MultiSelectOption[];
  allSlugs: string[];   // slugs already in the plan (for conflict hint)
  onChange: (slug: string) => void;
  disabled?: boolean;
}) {
  // Show the display name if it's a catalog entry, else show the raw value
  const catalog = options.find((o) => o.value === value);
  const [text, setText] = useState(() => catalog?.label ?? value);
  const [open, setOpen] = useState(false);

  // Resync the displayed text when the `value` prop changes from outside —
  // this matters when a supplement row is removed and the array shifts up:
  // the React component at key={i} keeps mounted but now hosts a different
  // supplement's slug. Without this useEffect the visible text stayed
  // stuck on the previous-row label, making it look like the WRONG row got
  // removed (the one below the clicked Remove button).
  // Skip the resync while the dropdown is open / user is typing — would
  // overwrite their in-progress edit.
  useEffect(() => {
    if (!open) {
      setText(catalog?.label ?? value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, catalog?.label]);

  const filtered = text.trim().length === 0
    ? options.slice(0, 30)
    : options.filter(
        (o) =>
          o.label.toLowerCase().includes(text.toLowerCase()) ||
          o.value.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 40);

  function select(opt: MultiSelectOption) {
    setText(opt.label);
    onChange(opt.value);
    setOpen(false);
  }

  function handleBlur() {
    // slight delay so a click-in-list fires before blur
    setTimeout(() => {
      setOpen(false);
      // if nothing in catalog matches the text, save freeform
      const match = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
      if (match) {
        onChange(match.value);
      } else if (text.trim()) {
        // slugify freeform text
        const slug = text.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        onChange(slug || text.trim());
      }
    }, 150);
  }

  const isInCatalog = !!options.find((o) => o.value === value);
  // Simple conflict hint: check if any selected supp has known interactions with this one
  const otherSlugs = allSlugs.filter((s) => s !== value && s !== "");

  return (
    <div className="relative flex-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder="Type to search catalog or enter custom name…"
          className="flex-1 h-9 px-3 text-sm border rounded-md bg-background disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
        />
        {isInCatalog && (
          <span className="shrink-0 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-full px-1.5 py-0.5 font-semibold whitespace-nowrap">
            ✓ catalog
          </span>
        )}
        {value && !isInCatalog && (
          <span className="shrink-0 text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-1.5 py-0.5 font-semibold whitespace-nowrap">
            custom
          </span>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-0.5 z-50 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.map((o) => {
            const selected = o.value === value;
            const otherHasConflict = otherSlugs.some(
              (s) => o.value.includes(s) || s.includes(o.value)
            );
            return (
              <button
                key={o.value}
                type="button"
                onMouseDown={() => select(o)}
                className={[
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted/50 transition-colors",
                  selected ? "bg-primary/10 font-medium" : "",
                ].join(" ")}
              >
                <span className="flex-1 truncate">{o.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{o.value}</span>
                {otherHasConflict && (
                  <span className="shrink-0 text-[10px] text-amber-600">⚠</span>
                )}
              </button>
            );
          })}
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
    ayurvedaEnabled,
    ayurvedaConstitution,
    ayurvedaAssessment,
    schusslerEnabled,
    tissueSaltOptions = [],
    lifecycleProps,
  } = props;

  // Deep-link support: callers can pass ?tab=protocol|advanced. The
  // Submit / Activate flow has moved to the inline status bar above the
  // editor (in the v2 edit page wrapper, 2026-05-14), so the old
  // "lifecycle" tab is now a smaller "advanced" tab covering only the
  // rare actions (revoke / supersede / diff / export / save-as-template
  // / successor draft). Documents tab was killed in the same pass — it
  // was a stub cross-link to the client page.
  // Legacy ?tab=lifecycle / ?tab=documents redirect to advanced /
  // protocol respectively for backward compat.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: "protocol" | "advanced" =
    tabParam === "advanced" || tabParam === "lifecycle"
      ? "advanced"
      : "protocol";

  const [plan, setPlan] = useState<Plan>(() => clone(initial));
  const [sources, setSources] = useState<SupplementSourcesMap>(() => clone(initialSources));
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<string | null>(null);
  // editAnyway: coach can unlock an active/published plan for careful edits
  const [editAnyway, setEditAnyway] = useState(false);
  const effectiveLocked = locked && !editAnyway;

  // Supplement interaction + drug-caution checker state (v0.74)
  const [supplementInteractions, setSupplementInteractions] = useState<SupplementInteraction[]>([]);
  const [drugCautions, setDrugCautions] = useState<DrugCaution[]>([]);
  useEffect(() => {
    let cancelled = false;
    checkSupplementInteractionsAction(initial.slug).then((res) => {
      if (!cancelled && res.ok) {
        setSupplementInteractions(res.interactions);
        setDrugCautions(res.drug_cautions ?? []);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.slug]);

  // Per-supplement retailer + fixed per-unit strength (VitaOne etc.). Lets the
  // editor nudge the coach to dose in whole capsules of the actual product
  // rather than an off-grid mg range the fixed product can't hit.
  const [productInfo, setProductInfo] = useState<
    Record<string, { source: string; unit_strength?: string }>
  >({});
  const suppLabelFor = (s: SupplementItem): string =>
    s.display_name?.trim() ||
    supplementOptions.find((o) => o.value === s.supplement_slug)?.label ||
    (s.supplement_slug || "").replace(/-/g, " ").trim();
  const suppNamesKey = ((plan.supplement_protocol as SupplementItem[]) ?? [])
    .map(suppLabelFor)
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    const names = suppNamesKey ? suppNamesKey.split("|") : [];
    if (!names.length) {
      setProductInfo({});
      return;
    }
    resolveSupplementProducts(names).then((res) => {
      if (!cancelled) setProductInfo(res);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppNamesKey]);

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

  function patchAyurveda(field: string, value: unknown) {
    setPlan((p) => ({
      ...p,
      ayurveda: { ...((p.ayurveda as Record<string, unknown>) ?? {}), [field]: value },
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
  const customRemedies: CustomRemedyT[] = (nutrition.custom_remedies as CustomRemedyT[]) ?? [];
  const updateCustomRemedy = (i: number, field: keyof CustomRemedyT, value: string) => {
    patchNutrition(
      "custom_remedies",
      customRemedies.map((r, j) => (j === i ? { ...r, [field]: value } : r))
    );
  };

  // ── Ayurveda section state (only used when ayurvedaEnabled) ──
  const ayurveda = (plan.ayurveda as Record<string, unknown>) ?? {};
  const dinacharya: PracticeItem[] = (ayurveda.dinacharya as PracticeItem[]) ?? [];
  const ayurRemedies: string[] = (ayurveda.remedies as string[]) ?? [];
  const ayurAssessment = ayurvedaAssessment ?? {};
  const updateDinacharya = (i: number, field: keyof PracticeItem, value: string) => {
    patchAyurveda(
      "dinacharya",
      dinacharya.map((d, j) => (j === i ? { ...d, [field]: value } : d))
    );
  };
  const ayurCustomRemedies: CustomRemedyT[] = (ayurveda.custom_remedies as CustomRemedyT[]) ?? [];
  const updateAyurCustomRemedy = (i: number, field: keyof CustomRemedyT, value: string) => {
    patchAyurveda(
      "custom_remedies",
      ayurCustomRemedies.map((r, j) => (j === i ? { ...r, [field]: value } : r))
    );
  };

  // ── Tissue-salts section state (only used when schusslerEnabled) ──
  const tissueSalts = (plan.tissue_salts as Record<string, unknown>) ?? {};
  const tsSalts: Array<{ salt_slug?: string; reason?: string }> =
    (tissueSalts.salts as Array<{ salt_slug?: string; reason?: string }>) ?? [];
  function patchTissueSalts(field: string, value: unknown) {
    setPlan((p) => ({
      ...p,
      tissue_salts: { ...((p.tissue_salts as Record<string, unknown>) ?? {}), [field]: value },
    }));
    setDirty(true);
  }
  const updateTsSalt = (i: number, field: "salt_slug" | "reason", value: string) =>
    patchTissueSalts(
      "salts",
      tsSalts.map((s, j) => (j === i ? { ...s, [field]: value } : s))
    );

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
      {locked && !editAnyway && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              📌 This plan is {lifecycleProps.status?.replace(/_/g, " ")} — it has been sent to the client
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Edit carefully, or archive this plan and create a new version to start fresh.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setEditAnyway(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-amber-400 bg-white text-amber-800 hover:bg-amber-50 transition-colors"
            >
              ✏️ Edit anyway
            </button>
          </div>
        </div>
      )}
      {locked && editAnyway && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 px-4 py-2 flex items-center gap-2 text-xs text-amber-700">
          <span>⚠️ Editing an active plan — changes save immediately to the client record.</span>
          <button onClick={() => setEditAnyway(false)} className="ml-auto underline hover:text-amber-900">Lock again</button>
        </div>
      )}

      {/* ── Next-step strip ──
          Tight single-line cue tied to plan status. Earlier this was a fat
          card that shouted "Build the protocol, then activate" even when
          the plan was already ready_to_publish — pure dashboard clutter.
          Now: nothing on draft (the Lifecycle tab is right there), a
          one-line nudge on ready_to_publish, and a CTA only on published
          where the next action is in a different surface (client page). */}
      {(() => {
        const st = lifecycleProps.status;
        if (st === "ready_to_publish") {
          return (
            <div className="text-xs text-emerald-800 bg-emerald-50/60 border border-emerald-200 rounded-md px-3 py-1.5">
              ✓ Ready to publish — open the <strong>🚀 Lifecycle</strong> tab to go live.
            </div>
          );
        }
        if (st === "published" && clientId) {
          return (
            <a
              href={`/clients-v2/${clientId}/communicate`}
              className="text-xs text-violet-900 bg-violet-50/60 border border-violet-200 rounded-md px-3 py-1.5 flex items-center justify-between gap-3 hover:bg-violet-100/60 transition-colors no-underline"
            >
              <span>📤 Plan is live — the client app now shows it. Send the welcome email from the <strong>Communicate</strong> tab.</span>
              <span className="font-semibold whitespace-nowrap">Open →</span>
            </a>
          );
        }
        return null;
      })()}

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
          disabled={!dirty || isPending || effectiveLocked}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* ── Plan timeline ── */}
      <PlanTimelineCard
        startDate={timelineStart}
        weeks={timelineWeeks}
        primaryTopics={(plan.primary_topics as string[]) ?? []}
        locked={effectiveLocked}
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

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="protocol">📋 Protocol</TabsTrigger>
          <TabsTrigger value="advanced">🚀 Plan actions</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            📋 PROTOCOL TAB — all clinical sections in one scrolling view
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="protocol">
          <div className="space-y-3 pt-2">

            {/* ── AI Chat — pinned near top so coach can use it to fill in sections ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border border-violet-200 bg-violet-50/40 px-4 py-3 text-sm font-semibold hover:bg-violet-50/60 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                💬 AI Plan Assistant
                <span className="ml-auto text-[10px] text-violet-600 font-normal">Ask AI to fill in, adjust, or review any section</span>
              </summary>
              <div className="pt-2 px-1">
                <PlanChatPanel
                  slug={plan.slug as string}
                  clientId={clientId ?? ""}
                  isLocked={effectiveLocked}
                />
              </div>
            </details>

            {/* ── Assessment ── */}
            <details open className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Assessment
                {((plan.primary_topics as string[] | undefined)?.length ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {(plan.primary_topics as string[]).length} topic{(plan.primary_topics as string[]).length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </summary>
              <div className="pt-3 space-y-4 px-1">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Primary topics</label>
                  <MultiSelect
                    options={topicOptions}
                    value={plan.primary_topics ?? []}
                    onChange={(v) => patch("primary_topics", v)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Contributing topics</label>
                  <MultiSelect
                    options={topicOptions}
                    value={plan.contributing_topics ?? []}
                    onChange={(v) => patch("contributing_topics", v)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Presenting symptoms</label>
                  <MultiSelect
                    options={symptomOptions}
                    value={plan.presenting_symptoms ?? []}
                    onChange={(v) => patch("presenting_symptoms", v)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Hypothesized drivers</label>
                  <div className="space-y-3">
                    {drivers.map((d, i) => (
                      <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20">
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
                        {/* v0.72: AI's intake citations for this hypothesis. */}
                        <IntakeEvidenceChips
                          value={d.intake_evidence}
                          locked={locked}
                          onChange={(next_ev) => {
                            const next = [...drivers];
                            next[i] = { ...next[i], intake_evidence: next_ev };
                            patch("hypothesized_drivers", next);
                          }}
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
              </div>
            </details>

            {/* ── Supplements ── */}
            <details open className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Supplement protocol
                {supplements.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {supplements.length}
                  </Badge>
                )}
                {supplementInteractions.length > 0 && (
                  <span className="text-amber-600 text-xs font-semibold">⚠ {supplementInteractions.length} interaction{supplementInteractions.length !== 1 ? "s" : ""}</span>
                )}
                {drugCautions.length > 0 && (
                  <span className="text-rose-600 text-xs font-semibold">⚠ {drugCautions.length} drug caution{drugCautions.length !== 1 ? "s" : ""}</span>
                )}
              </summary>
              <div className="pt-3 space-y-3 px-1">
                {/* Fix D 2026-05-23 — inline drug-nutrient depletion lookup
                   so the coach sees which supplements each medication is
                   pulling out of the client BEFORE building the protocol.
                   Self-hides when no medications match the catalogue. */}
                {clientId && <MedicationImpactPanel clientId={clientId} />}
                {/* ── Drug-derived protocol cautions (v0.74) ── */}
                {drugCautions.length > 0 && (() => {
                  const critical = drugCautions.filter((c) => c.severity === "critical");
                  const warning = drugCautions.filter((c) => c.severity === "warning");
                  const info = drugCautions.filter((c) => c.severity === "info");
                  const borderClass = critical.length > 0 ? "border-rose-400 bg-rose-50" : "border-amber-300 bg-amber-50";
                  const textClass = critical.length > 0 ? "text-rose-900" : "text-amber-900";
                  return (
                    <details className="group/drug" open={critical.length > 0}>
                      <summary className={`flex items-center gap-2 cursor-pointer select-none list-none rounded-md border ${borderClass} px-3 py-2 text-xs font-semibold ${textClass}`}>
                        <span className="transition-transform group-open/drug:rotate-90 text-xs">▶</span>
                        ⚠ Drug-derived protocol cautions ({drugCautions.length})
                        {critical.length > 0 && <span className="ml-1 rounded px-1.5 py-0.5 bg-rose-600 text-white text-[9px]">CRITICAL {critical.length}</span>}
                      </summary>
                      <div className="mt-2 space-y-2 rounded-md border border-amber-200 bg-white px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">
                          The client&apos;s medications imply these protocol constraints. Reflect them in the plan, menu, and supplement choices.
                        </p>
                        {[...critical, ...warning, ...info].map((c, i) => {
                          const sevColor = c.severity === "critical" ? "rose" : c.severity === "warning" ? "amber" : "slate";
                          return (
                            <div key={`${c.drug_slug}-${i}`} className={`text-[11px] border border-${sevColor}-200 rounded bg-${sevColor}-50/60 px-2.5 py-2 space-y-1`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`rounded px-1.5 py-0.5 bg-${sevColor}-200 text-${sevColor}-900 text-[9px] font-bold uppercase`}>{c.severity}</span>
                                <span className={`rounded px-1.5 py-0.5 bg-slate-200 text-slate-700 text-[9px] uppercase`}>{c.kind.replace(/_/g, " ")}</span>
                                <span className="font-semibold text-slate-900">{c.drug_name}</span>
                                <span className="text-muted-foreground text-[10px]">({c.matched_medication})</span>
                              </div>
                              <div className="text-slate-900">{c.item}</div>
                              {c.reason && <div className="text-muted-foreground text-[10px] italic">Why: {c.reason}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
                {/* ── Medication interaction warnings ── */}
                {supplementInteractions.length > 0 && (
                  <details className="group/warn">
                    <summary className="flex items-center gap-2 cursor-pointer select-none list-none rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                      <span className="transition-transform group-open/warn:rotate-90 text-amber-600 text-xs">▶</span>
                      ⚠ Potential medication interactions detected ({supplementInteractions.length})
                    </summary>
                    <div className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
                      <p className="text-[11px] text-amber-800">
                        The following supplements may interact with the client&apos;s current medications. Review with the client before proceeding.
                      </p>
                      {supplementInteractions.map((interaction) => (
                        <div key={interaction.supplement_slug} className="text-[11px] border border-amber-200 rounded bg-white px-2.5 py-2 space-y-1">
                          <div className="font-semibold text-amber-900">
                            {stripBrand(interaction.supplement_name)}{" "}
                            <span className="text-amber-500">may interact with</span>{" "}
                            {interaction.matched_medications.join(", ")}
                          </div>
                          <div className="text-muted-foreground text-[10px]">
                            Contraindication note: {interaction.contraindication_text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {supplements.map((s, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20">
                    <div className="flex gap-2 items-center">
                      <SupplementCombobox
                        value={s.supplement_slug}
                        options={supplementOptions}
                        allSlugs={supplements.map((x) => x.supplement_slug)}
                        disabled={effectiveLocked}
                        onChange={(slug) => {
                          const next = [...supplements];
                          next[i] = { ...next[i], supplement_slug: slug };
                          patch("supplement_protocol", next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch("supplement_protocol", supplements.filter((_, j) => j !== i))
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
                      <div>
                        <Input
                          placeholder="Dose (e.g. 200-400 mg)"
                          value={s.dose ?? ""}
                          onChange={(e) => {
                            const next = [...supplements];
                            next[i] = { ...next[i], dose: e.target.value };
                            patch("supplement_protocol", next);
                          }}
                        />
                        {(() => {
                          const info = productInfo[suppLabelFor(s)];
                          if (!info || (info.source !== "vitaone" && info.source !== "fmnutrition")) return null;
                          const label = info.source === "vitaone" ? "VitaOne" : "FM Nutrition";
                          return (
                            <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                              {label}
                              {info.unit_strength ? ` · ${info.unit_strength}` : ""} — dose in capsules
                            </p>
                          );
                        })()}
                      </div>
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
                          next[i] = { ...next[i], take_with_food: e.target.value };
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
                          next[i] = { ...next[i], duration_weeks: v === "" ? null : Number(v) };
                          patch("supplement_protocol", next);
                        }}
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Start week (1 = now)"
                        title="Protocol week this supplement is introduced. 1 = start immediately. Use 3 / 5 / 9 etc. to phase a 5R-style protocol."
                        value={s.start_week ?? ""}
                        onChange={(e) => {
                          const next = [...supplements];
                          const v = e.target.value;
                          next[i] = {
                            ...next[i],
                            start_week: v === "" ? null : Math.max(1, Number(v)),
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
                        next[i] = { ...next[i], coach_rationale: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                      className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                    />
                    {/* v0.72: intake citations from the AI — coach sees why
                        the recommendation came up, can prune anything she
                        disagrees with. Empty list ⇒ panel hides. */}
                    <IntakeEvidenceChips
                      value={s.intake_evidence}
                      locked={effectiveLocked}
                      onChange={(next_ev) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], intake_evidence: next_ev };
                        patch("supplement_protocol", next);
                      }}
                    />
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
              </div>
            </details>

            {/* ── Nutrition ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Nutrition
                {(nutrition.pattern as string | undefined) && (
                  <span className="ml-auto text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                    {nutrition.pattern as string}
                  </span>
                )}
              </summary>
              <div className="pt-3 space-y-4 px-1">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Pattern</label>
                  <Input
                    value={(nutrition.pattern as string) ?? ""}
                    onChange={(e) => patchNutrition("pattern", e.target.value)}
                    placeholder="e.g. gentle anti-inflammatory"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Meal timing</label>
                  <Input
                    value={(nutrition.meal_timing as string) ?? ""}
                    onChange={(e) => patchNutrition("meal_timing", e.target.value)}
                    placeholder="e.g. 12-hour overnight fast"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Cooking adjustments</label>
                  <MultiSelect
                    options={cookingOptions}
                    value={(nutrition.cooking_adjustments as string[]) ?? []}
                    onChange={(v) => patchNutrition("cooking_adjustments", v)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Home remedies</label>
                  <MultiSelect
                    options={remedyOptions}
                    value={(nutrition.home_remedies as string[]) ?? []}
                    onChange={(v) => patchNutrition("home_remedies", v)}
                  />
                </div>
                <div>
                  <RecipeSuggestionsCard
                    planSlug={plan.slug as string}
                    value={(nutrition.recipes as string[]) ?? []}
                    onChange={(v) => patchNutrition("recipes", v)}
                    locked={effectiveLocked}
                  />
                </div>
                {/* Bespoke per-client remedies — render in the letter's
                    "🍵 Drinks & digestives" section alongside catalogue ones. */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Custom remedies <span className="font-normal text-muted-foreground">· bespoke for this client</span>
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    A kitchen-spice churan, tea, or juice authored just for this client (e.g. a jeera-saunf-ajwain
                    digestive). Shows in the app&apos;s &ldquo;🍵 Drinks &amp; digestives&rdquo; section.
                  </p>
                  {customRemedies.map((r, i) => (
                    <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20 mb-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Name (e.g. After-meal digestive churan)"
                          value={r.name ?? ""}
                          onChange={(e) => updateCustomRemedy(i, "name", e.target.value)}
                        />
                        <Input
                          placeholder="Kind (churan / tea / juice)"
                          className="max-w-[170px]"
                          value={r.kind ?? ""}
                          onChange={(e) => updateCustomRemedy(i, "kind", e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={locked}
                          onClick={() =>
                            patchNutrition("custom_remedies", customRemedies.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        placeholder="When to take (e.g. ½ tsp with warm water after lunch & dinner)"
                        value={r.timing ?? ""}
                        onChange={(e) => updateCustomRemedy(i, "timing", e.target.value)}
                      />
                      <textarea
                        placeholder="What's in it — kitchen-spice ingredients + rough quantities"
                        value={r.ingredients ?? ""}
                        onChange={(e) => updateCustomRemedy(i, "ingredients", e.target.value)}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                      <textarea
                        placeholder="How to make it"
                        value={r.preparation ?? ""}
                        onChange={(e) => updateCustomRemedy(i, "preparation", e.target.value)}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                      <textarea
                        placeholder="Why — coach rationale (shown in italics to the client)"
                        value={r.reason ?? ""}
                        onChange={(e) => updateCustomRemedy(i, "reason", e.target.value)}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={locked}
                    onClick={() => patchNutrition("custom_remedies", [...customRemedies, { name: "" }])}
                  >
                    + Add custom remedy
                  </Button>
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
              </div>
            </details>

            {/* ── Ayurveda (opt-in per client) ── */}
            {ayurvedaEnabled && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm font-semibold hover:bg-amber-50/70 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                🪔 Ayurveda
                {ayurvedaConstitution && (
                  <span className="ml-auto text-xs text-muted-foreground font-normal truncate max-w-[220px]">
                    {ayurvedaConstitution}
                  </span>
                )}
              </summary>
              <div className="pt-3 space-y-4 px-1">
                {/* Read-only context: constitution + latest AI read */}
                <div className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs space-y-1">
                  <div>
                    <span className="font-semibold">Constitution (prakruti):</span>{" "}
                    {ayurvedaConstitution || (
                      <span className="text-muted-foreground italic">
                        not set — established by the dosha quiz, confirm on the client profile
                      </span>
                    )}
                  </div>
                  {(ayurAssessment.vikruti_label || ayurAssessment.vata_score != null) && (
                    <div className="text-muted-foreground">
                      <span className="font-semibold text-foreground">AI read:</span>{" "}
                      {ayurAssessment.vata_score != null && (
                        <>V {String(ayurAssessment.vata_score)} · P {String(ayurAssessment.pitta_score)} · K {String(ayurAssessment.kapha_score)} · </>
                      )}
                      {ayurAssessment.vikruti_label ? String(ayurAssessment.vikruti_label) : ""}
                      {ayurAssessment.agni_state ? ` · agni: ${String(ayurAssessment.agni_state)}` : ""}
                      {ayurAssessment.ama_present ? " · ama present" : ""}
                      {ayurAssessment.prakruti_confidence === "pending_quiz" && (
                        <span className="ml-1 italic">(constitution pending quiz)</span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Current imbalance (vikruti)</label>
                  <Input
                    value={(ayurveda.current_imbalance as string) ?? ""}
                    onChange={(e) => patchAyurveda("current_imbalance", e.target.value)}
                    placeholder="e.g. Pitta-aggravated, mild ama"
                    disabled={effectiveLocked}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Balancing focus <span className="font-normal text-muted-foreground">· client-facing one-liner</span>
                  </label>
                  <Input
                    value={(ayurveda.balancing_focus as string) ?? ""}
                    onChange={(e) => patchAyurveda("balancing_focus", e.target.value)}
                    placeholder="e.g. Cool Pitta and steady your digestion"
                    disabled={effectiveLocked}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Dietary guidance (dosha-aware)</label>
                  <textarea
                    value={(ayurveda.dietary_guidance as string) ?? ""}
                    onChange={(e) => patchAyurveda("dietary_guidance", e.target.value)}
                    placeholder="Six-tastes / qualities bias for this client's imbalance"
                    disabled={effectiveLocked}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Remedies <span className="font-normal text-muted-foreground">· dosha-matched; checker flags mismatches</span></label>
                  <MultiSelect
                    options={remedyOptions}
                    value={ayurRemedies}
                    onChange={(v) => patchAyurveda("remedies", v)}
                  />
                </div>
                {/* Bespoke per-client remedies (Ayurvedic) */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Custom remedies <span className="font-normal text-muted-foreground">· bespoke for this client</span>
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    A churan, tea, oil, or decoction authored just for this client — full ingredients
                    + preparation + timing. Shows in the app&apos;s Ayurvedic guidance section.
                  </p>
                  {ayurCustomRemedies.map((r, i) => (
                    <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20 mb-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Name (e.g. Brahmi-jatamansi bedtime decoction)"
                          value={r.name ?? ""}
                          onChange={(e) => updateAyurCustomRemedy(i, "name", e.target.value)}
                          disabled={effectiveLocked}
                        />
                        <Input
                          placeholder="Kind (tea / churan / oil)"
                          className="max-w-[170px]"
                          value={r.kind ?? ""}
                          onChange={(e) => updateAyurCustomRemedy(i, "kind", e.target.value)}
                          disabled={effectiveLocked}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={effectiveLocked}
                          onClick={() => patchAyurveda("custom_remedies", ayurCustomRemedies.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        placeholder="When to take (e.g. 1 cup an hour before bed)"
                        value={r.timing ?? ""}
                        onChange={(e) => updateAyurCustomRemedy(i, "timing", e.target.value)}
                        disabled={effectiveLocked}
                      />
                      <textarea
                        placeholder="What's in it — ingredients + rough quantities"
                        value={r.ingredients ?? ""}
                        onChange={(e) => updateAyurCustomRemedy(i, "ingredients", e.target.value)}
                        disabled={effectiveLocked}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                      <textarea
                        placeholder="How to make it"
                        value={r.preparation ?? ""}
                        onChange={(e) => updateAyurCustomRemedy(i, "preparation", e.target.value)}
                        disabled={effectiveLocked}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                      <textarea
                        placeholder="Why — coach rationale (shown in italics to the client)"
                        value={r.reason ?? ""}
                        onChange={(e) => updateAyurCustomRemedy(i, "reason", e.target.value)}
                        disabled={effectiveLocked}
                        className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={effectiveLocked}
                    onClick={() => patchAyurveda("custom_remedies", [...ayurCustomRemedies, { name: "" }])}
                  >
                    + Add custom remedy
                  </Button>
                </div>
                {/* Dinacharya (daily routine) */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Daily rhythm (dinacharya)
                  </label>
                  {dinacharya.map((d, i) => (
                    <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20 mb-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Practice (e.g. tongue scraping on waking)"
                          value={d.name ?? ""}
                          onChange={(e) => updateDinacharya(i, "name", e.target.value)}
                          disabled={effectiveLocked}
                        />
                        <Input
                          placeholder="Cadence (daily / nightly)"
                          className="max-w-[170px]"
                          value={d.cadence ?? ""}
                          onChange={(e) => updateDinacharya(i, "cadence", e.target.value)}
                          disabled={effectiveLocked}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={effectiveLocked}
                          onClick={() => patchAyurveda("dinacharya", dinacharya.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        placeholder="Details (optional)"
                        value={d.details ?? ""}
                        onChange={(e) => updateDinacharya(i, "details", e.target.value)}
                        disabled={effectiveLocked}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={effectiveLocked}
                    onClick={() => patchAyurveda("dinacharya", [...dinacharya, { name: "", cadence: "" }])}
                  >
                    + Add practice
                  </Button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Seasonal note (ritucharya)</label>
                  <Input
                    value={(ayurveda.seasonal_note as string) ?? ""}
                    onChange={(e) => patchAyurveda("seasonal_note", e.target.value)}
                    placeholder="e.g. Summer now — favour cooling foods"
                    disabled={effectiveLocked}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Coach notes <span className="font-normal text-muted-foreground">· not shown to client</span>
                  </label>
                  <textarea
                    value={(ayurveda.coach_notes as string) ?? ""}
                    onChange={(e) => patchAyurveda("coach_notes", e.target.value)}
                    disabled={effectiveLocked}
                    className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                  />
                </div>
              </div>
            </details>
            )}

            {/* ── Tissue salts (Schüssler — opt-in per client) ── */}
            {schusslerEnabled && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border border-sky-200 bg-sky-50/50 px-4 py-3 text-sm font-semibold hover:bg-sky-50/70 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                🧂 Schüssler tissue salts
                {tsSalts.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">{tsSalts.length}</Badge>
                )}
              </summary>
              <div className="pt-3 space-y-4 px-1">
                <p className="text-xs text-muted-foreground">
                  Gentle biochemic adjuncts (cell salts + Bio-Combinations). Optional support — renders in the
                  app when set. Pick from the catalogue; the AI also suggests relevant salts during
                  assessment.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Intro <span className="font-normal text-muted-foreground">· client-facing one-liner</span>
                  </label>
                  <Input
                    value={(tissueSalts.overview as string) ?? ""}
                    onChange={(e) => patchTissueSalts("overview", e.target.value)}
                    placeholder="e.g. A few gentle tissue salts to support you alongside the plan"
                    disabled={effectiveLocked}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Salts</label>
                  {tsSalts.map((s, i) => (
                    <div key={i} className="flex gap-2 items-center mb-2">
                      <select
                        value={s.salt_slug ?? ""}
                        onChange={(e) => updateTsSalt(i, "salt_slug", e.target.value)}
                        disabled={effectiveLocked}
                        className="text-sm border rounded-md px-2 py-1.5 bg-background min-w-[220px] max-w-[280px]"
                      >
                        <option value="">— pick a salt —</option>
                        {tissueSaltOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        placeholder="why — e.g. cramping periods"
                        value={s.reason ?? ""}
                        onChange={(e) => updateTsSalt(i, "reason", e.target.value)}
                        disabled={effectiveLocked}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={effectiveLocked}
                        onClick={() => patchTissueSalts("salts", tsSalts.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={effectiveLocked}
                    onClick={() => patchTissueSalts("salts", [...tsSalts, { salt_slug: "", reason: "" }])}
                  >
                    + Add salt
                  </Button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Coach notes <span className="font-normal text-muted-foreground">· not shown to client</span>
                  </label>
                  <textarea
                    value={(tissueSalts.coach_notes as string) ?? ""}
                    onChange={(e) => patchTissueSalts("coach_notes", e.target.value)}
                    disabled={effectiveLocked}
                    className="w-full text-sm border rounded-md p-2 min-h-[48px] bg-background"
                  />
                </div>
              </div>
            </details>
            )}

            {/* ── Lifestyle ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Lifestyle practices
                {lifestyle.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {lifestyle.length}
                  </Badge>
                )}
              </summary>
              <div className="pt-3 space-y-3 px-1">
                {lifestyle.map((p, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20">
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
                          patch("lifestyle_practices", lifestyle.filter((_, j) => j !== i))
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
                    {/* v0.72: AI's intake citations for this practice. */}
                    <IntakeEvidenceChips
                      value={p.intake_evidence}
                      locked={locked}
                      onChange={(next_ev) => {
                        const next = [...lifestyle];
                        next[i] = { ...next[i], intake_evidence: next_ev };
                        patch("lifestyle_practices", next);
                      }}
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
              </div>
            </details>

            {/* ── Labs ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Lab orders
                {labOrders.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {labOrders.length}
                  </Badge>
                )}
              </summary>
              <div className="pt-3 px-1">
                <LabOrdersEditor
                  labOrders={labOrders}
                  locked={effectiveLocked}
                  onChange={(next) => patch("lab_orders", next)}
                />
              </div>
            </details>

            {/* ── Education ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Education modules
                {education.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {education.length}
                  </Badge>
                )}
              </summary>
              <div className="pt-3 space-y-3 px-1">
                {education.map((em, i) => {
                  const opts =
                    em.target_kind === "topic"
                      ? educationTopicOptions
                      : optionsForKind(em.target_kind);
                  return (
                    <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20">
                      <div className="flex gap-2">
                        <select
                          value={em.target_kind}
                          onChange={(e) => {
                            const next = [...education];
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
                            patch("education", education.filter((_, j) => j !== i))
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
                            next[i] = { ...next[i], target_slug: e.target.value };
                            patch("education", next);
                          }}
                        />
                      )}
                      <textarea
                        placeholder="Client-facing summary — what you'll actually say"
                        value={em.client_facing_summary ?? ""}
                        onChange={(e) => {
                          const next = [...education];
                          next[i] = { ...next[i], client_facing_summary: e.target.value };
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
                      { target_kind: "topic", target_slug: "", client_facing_summary: "" },
                    ])
                  }
                >
                  + Add module
                </Button>
              </div>
            </details>

            {/* ── Referrals ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Referrals
                {referrals.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {referrals.length}
                  </Badge>
                )}
              </summary>
              <div className="pt-3 space-y-3 px-1">
                {referrals.map((r, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/20">
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
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch("referrals", referrals.filter((_, j) => j !== i))
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
              </div>
            </details>

            {/* ── Tracking ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Tracking
                {((tracking.habits?.length ?? 0) + (tracking.symptoms_to_monitor?.length ?? 0)) > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {(tracking.habits?.length ?? 0) + (tracking.symptoms_to_monitor?.length ?? 0)} items
                  </Badge>
                )}
              </summary>
              <div className="pt-3 space-y-6 px-1">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Habits</label>
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
                            const next = (tracking.habits ?? []).filter((_, j) => j !== i);
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
                  <label className="block text-sm font-medium mb-1.5">Symptoms to monitor</label>
                  <MultiSelect
                    options={symptomOptions}
                    value={tracking.symptoms_to_monitor ?? []}
                    onChange={(v) => patchTracking("symptoms_to_monitor", v)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Recheck questions</label>
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
                            const next = (tracking.recheck_questions ?? []).filter((_, j) => j !== i);
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
              </div>
            </details>

            {/* ── Resources ── */}
            {props.resourceOptions.length > 0 && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                  <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                  Attached resources
                  {((plan.attached_resources as string[] | undefined)?.length ?? 0) > 0 && (
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {(plan.attached_resources as string[]).length}
                    </Badge>
                  )}
                </summary>
                <div className="pt-3 px-1">
                  <MultiSelect
                    options={props.resourceOptions}
                    value={(plan.attached_resources as string[]) ?? []}
                    onChange={(v) => patch("attached_resources", v)}
                  />
                </div>
              </details>
            )}

            {/* ── Notes & Raw ── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none rounded-md border bg-muted/30 px-4 py-3 text-sm font-semibold hover:bg-muted/50 list-none">
                <span className="transition-transform group-open:rotate-90 text-muted-foreground text-xs">▶</span>
                Notes &amp; Raw
              </summary>
              <div className="pt-3 space-y-4 px-1">
                <Card>
                  <CardHeader>
                    <CardTitle>Notes for coach</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <textarea
                      value={(plan.notes_for_coach as string) ?? ""}
                      onChange={(e) => patch("notes_for_coach", e.target.value)}
                      placeholder="Private working notes…"
                      className="w-full text-sm border rounded-md p-2 min-h-[120px] bg-background font-mono"
                    />
                  </CardContent>
                </Card>
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
            </details>


          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            ⚙️ ADVANCED TAB — rare lifecycle actions (revoke, supersede,
            diff, export, save-as-template, successor draft). Daily-use
            Submit / Activate buttons live in the inline status bar at the
            top of the editor page (v2 wrapper). Documents tab killed —
            client-facing letters are generated from the client page's
            "Send package" surface.
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="advanced">
          <div className="pt-2">
            <LifecyclePanel
              slug={plan.slug as string}
              clientId={clientId}
              status={lifecycleProps.status}
              version={lifecycleProps.version}
              catalogueSnapshot={lifecycleProps.catalogueSnapshot}
              statusHistory={lifecycleProps.statusHistory}
              supersedes={lifecycleProps.supersedes}
              allPlanSlugs={lifecycleProps.allPlanSlugs}
            />
          </div>
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

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Client } from "@/lib/fmdb/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  runAssessAction,
  generateDraftAction,
  regeneratePlanFromSessionAction,
  chatAction,
  loadSessionChatAction,
  extractTranscriptAction,
  extractTranscriptUrlAction,
  applyTranscriptDataAction,
  parseHealthTextAction,
  computeRatiosAction,
  loadClientSessionsAction,
  loadCustomTemplatesAction,
  type SessionSummary,
  type CustomTemplate,
} from "./actions";
import { getMindMapPathways, peekSubgraphAction, type SubgraphReadiness } from "./mindmap-actions";
import { IFMMatrixCard } from "./ifm-matrix-card";
import { kindLabel } from "@/lib/fmdb/kinds";

/** Map a singular internal kind name (topic/mechanism/symptom/...) to a
 *  coach-friendly singular label. Falls back to the raw kind. */
function prettyKindSingular(kind: unknown): string {
  if (typeof kind !== "string" || !kind) return "Item";
  // Internal kind names are singular; KIND_LABELS keys are plural directory names.
  const pluralMap: Record<string, string> = {
    topic: "topics", mechanism: "mechanisms", symptom: "symptoms",
    supplement: "supplements", protocol: "protocols", claim: "claims",
    source: "sources", lab_test: "lab_tests", lab_panel: "lab_panels",
    home_remedy: "home_remedies", cooking_adjustment: "cooking_adjustments",
    titration_protocol: "titration_protocols",
  };
  return kindLabel(pluralMap[kind] ?? kind, "singular");
}
import {
  resolveClientFileAction,
  parseTranscriptForClientByPath,
  updateClientFromTranscriptAction,
} from "@/app/clients/actions";
import type { MindMapPathwayResult } from "@/lib/fmdb/loader-extras";
import type {
  AssessResult,
  AssessUsage,
  AssessSuggestions,
  ChatTurn,
  ComputedRatio,
  PlanBrief,
  FactorScores,
} from "@/lib/fmdb/anthropic-types";
import { FACTOR_LABELS, FACTOR_WEIGHTS } from "@/lib/fmdb/anthropic-types";
import { PROTOCOL_TEMPLATES } from "@/lib/fmdb/protocol-templates";
import type {
  ExtractedHealthData,
  ExtractedLabValue,
  ExtractedMeasurements,
} from "@/lib/fmdb/anthropic";
import { FivePillarsCapture, type FivePillarsData } from "@/app/clients/[id]/five-pillars-capture";

type Opt = { slug: string; label: string; aliases?: string[]; category?: string };

interface Props {
  clients?: Client[];
  symptoms: Opt[];
  topics: Opt[];
  initialClientId?: string;
  initialSessions?: SessionSummary[];
  /** When set, the component runs in embedded mode: client picker is hidden
   *  and this ID is used directly. Intended for the /clients/[id] Assess tab. */
  fixedClientId?: string;
  /** Filenames already in the client's files/ dir. When non-empty, the assess
   *  page renders an "Existing files" panel so the coach can re-attach a
   *  previously-uploaded lab report instead of uploading again. */
  existingFiles?: string[];
  /** Client's sex (M/F/...). Drives gender-responsive symptom sections in
   *  the picker. When unset, both Women's Health and Men's Health sections
   *  are shown so coach never loses access to a relevant symptom. */
  clientSex?: string | null;
  /** Health snapshots already extracted from prior reports. Used to:
   *  (1) pre-populate the editable health-data card so the coach starts
   *      from the latest known labs/meds/conditions instead of a blank
   *      form, and
   *  (2) skip re-extraction when the coach attaches a file whose
   *      `source` is already represented in a snapshot. */
  priorSnapshots?: NonNullable<Client["health_snapshots"]>;
}

interface UploadedRef {
  filePath: string;
  filename: string;
  mime_type: string;
  kind: "lab_report" | "food_journal";
}

// ---------------------------------------------------------------------------
// InlinePicker — replaces the floating-dropdown MultiSelect for Assess.
// Renders a search box + a scrollable checkbox list that is always visible
// (no absolute positioning, no z-index fighting with adjacent cards).
// ---------------------------------------------------------------------------
function InlinePicker({
  options,
  value,
  onChange,
  placeholder,
  maxHeight = "16rem",
}: {
  options: Opt[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxHeight?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    );
  }, [query, options]);

  function toggle(slug: string) {
    if (value.includes(slug)) onChange(value.filter((v) => v !== slug));
    else onChange([...value, slug]);
  }

  const labelOf = (slug: string) =>
    options.find((o) => o.slug === slug)?.label ?? slug;

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1 text-xs">
              {labelOf(v)}
              <button
                type="button"
                onClick={() => toggle(v)}
                aria-label={`Remove ${v}`}
                className="ml-0.5 hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground hover:underline self-center"
          >
            clear all
          </button>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />

      {/* Inline scrollable list — never floating, always in flow */}
      <div
        className="border rounded-md divide-y overflow-y-auto"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            No matches for &ldquo;{query}&rdquo;
          </div>
        ) : (
          filtered.map((o) => {
            const checked = value.includes(o.slug);
            return (
              <label
                key={o.slug}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-muted/50 ${
                  checked ? "bg-primary/5 font-medium" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.slug)}
                  className="rounded shrink-0"
                />
                <span className="text-sm">{o.label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground font-mono shrink-0">
                  {o.slug}
                </span>
              </label>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length > 0
          ? `${value.length} selected · `
          : ""}
        {filtered.length === options.length
          ? `${options.length} options — type to filter`
          : `${filtered.length} of ${options.length} shown`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryPicker — two-level: category accordion → concept cluster → variants
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  gi: "GI / Digestive",
  musculoskeletal: "Musculoskeletal",
  neurological: "Neurological",
  mood: "Mood & Mental",
  sleep: "Sleep",
  skin: "Skin",
  hormonal: "Hormonal (shared)",
  womens_health: "Women's Health",
  mens_health: "Men's Health",
  metabolic: "Metabolic",
  constitutional: "Constitutional",
  cardiovascular: "Cardiovascular",
  urinary: "Urinary",
  other: "Other",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

// Re-route specific symptom slugs into gendered categories without editing the
// catalog YAMLs. Anything in this map overrides the symptom's stored category
// when grouping the picker. Keeps the catalogue stable while letting the UI
// reorganise around the IFM coaching workflow.
const SLUG_CATEGORY_OVERRIDES: Record<string, "womens_health" | "mens_health"> = {
  // Female-specific (move out of "hormonal" / "skin")
  "irregular-periods": "womens_health",
  "irregular-menstrual-cycles": "womens_health",
  "menstrual-irregularities": "womens_health",
  "heavy-periods": "womens_health",
  "painful-periods": "womens_health",
  "pms": "womens_health",
  "pms-symptoms": "womens_health",
  "premenstrual-tension": "womens_health",
  "pms-irregular-cycles-low-libido": "womens_health",
  "hot-flashes": "womens_health",
  "night-sweats": "womens_health",
  "vaginal-dryness": "womens_health",
  "vaginal-discharge": "womens_health",
  "vaginal-itching": "womens_health",
  "fibrocystic-breasts": "womens_health",
  "breast-tenderness": "womens_health",
  "facial-hair": "womens_health",
  "acne-hormonal": "womens_health",
  "infertility-female": "womens_health",
  "primary-infertility": "womens_health",
  "recurrent-miscarriage": "womens_health",
  "estrogen-dominance-symptoms": "womens_health",
  "perimenopause-symptoms": "womens_health",
  "menopause-symptoms": "womens_health",

  // Male-specific
  "erectile-dysfunction": "mens_health",
  "premature-ejaculation": "mens_health",
  "morning-erection-loss": "mens_health",
  "prostate-symptoms": "mens_health",
  "low-testosterone-symptoms": "mens_health",
};

// Map a normalised client.sex value to which gender-specific category to show.
// Any other value (or unknown) shows BOTH so the coach can still capture the
// symptom — e.g. when sex isn't recorded yet.
function gendersToShow(sex: string | null | undefined): { showWomens: boolean; showMens: boolean } {
  const s = (sex ?? "").trim().toUpperCase();
  if (s === "F" || s === "FEMALE" || s === "WOMAN") return { showWomens: true, showMens: false };
  if (s === "M" || s === "MALE" || s === "MAN")     return { showWomens: false, showMens: true };
  return { showWomens: true, showMens: true };
}

// Concept clusters: top-level concept name → canonical slug(s) that belong to it.
// Slugs listed first within a cluster appear first in the sub-list.
// Any symptom slug NOT listed here is shown individually under its category.
// Concept clusters group near-duplicate slugs under a single label. Aim:
// every visually-distinct concept appears exactly once. Coach picks the
// concept; the picker stores all variant slugs internally so AI matching
// against either the freeform or alias version still resolves.
const CONCEPT_CLUSTERS: Record<string, { label: string; slugs: string[] }[]> = {
  gi: [
    { label: "Bloating", slugs: ["bloating", "abdominal-bloating", "constant-bloating", "gas-and-bloating"] },
    { label: "Gas / Flatulence", slugs: ["gas", "abdominal-gas", "flatulence", "foul-smelling-gas", "upper-digestive-tract-gassiness"] },
    { label: "Acid Reflux / Heartburn", slugs: ["acid-reflux", "heartburn", "indigestion"] },
    { label: "Constipation", slugs: ["constipation", "chronic-constipation", "infrequent-stools", "constipation-thyroid"] },
    { label: "Diarrhea / Loose Stools", slugs: ["diarrhea", "loose-stools", "osmotic-diarrhea"] },
    { label: "Abdominal Pain / Cramping", slugs: ["abdominal-pain", "abdominal-cramping", "digestive-pain"] },
    { label: "Food Sensitivities", slugs: ["food-sensitivities", "food-reactivity", "new-food-sensitivities", "multiple-food-allergies", "histamine-intolerance"] },
    { label: "Nausea", slugs: ["nausea", "nausea-after-supplements"] },
    { label: "Stool abnormalities", slugs: ["undigested-food-in-stool", "steatorrhea"] },
  ],
  mood: [
    { label: "Depression / Low Mood", slugs: ["depression", "depression-symptoms", "low-mood", "lethargic-depression", "emotional-numbness"] },
    { label: "Anxiety", slugs: ["anxiety", "anxiety-with-gut-issues", "agitated-depression"] },
    { label: "Mood Swings / Irritability", slugs: ["mood-swings", "mood-changes", "irritability"] },
  ],
  skin: [
    { label: "Hair Loss / Thinning", slugs: ["hair-loss", "hair-thinning", "brittle-hair", "unexplained-hair-loss", "dry-skin-brittle-hair"] },
    { label: "Brittle / Weak Nails", slugs: ["brittle-nails", "weak-peeling-nails", "weak-peeling-cracked-fingernails"] },
    { label: "Acne / Breakouts", slugs: ["acne", "skin-breakouts"] }, // acne-hormonal moved to womens_health
    { label: "Rashes / Hives", slugs: ["skin-rash", "skin-rash-hives", "skin-rashes", "skin-flares"] },
    { label: "Dry skin", slugs: ["dry-skin"] },
  ],
  neurological: [
    { label: "Brain Fog / Cognition", slugs: ["brain-fog", "cognitive-decline", "poor-concentration"] },
    { label: "Headaches / Migraines", slugs: ["headache", "headaches"] },
    { label: "Neuropathy / Tingling", slugs: ["neuropathy", "peripheral-neuropathy", "numbness-tingling", "diabetic-nerve-pain"] },
  ],
  metabolic: [
    { label: "Weight Gain", slugs: [
      "weight-gain",
      "weight-gain-abdomen",
      "abdominal-weight-gain",
      "belly-fat",
      "central-weight-gain",
      "resistant-weight-gain",
      "unexplained-weight-gain",
      "excess-weight",
      "excess-body-weight",
      "cold-intolerance-and-weight-gain",
    ] },
    { label: "Blood Sugar / Insulin issues", slugs: ["blood-sugar-spikes", "elevated-blood-sugar", "elevated-fasting-insulin", "hypoglycemia-symptoms", "insulin-resistance-symptom"] },
    { label: "Post-meal Fatigue / Crashes", slugs: ["fatigue-after-meals", "post-meal-fatigue", "energy-crashes"] },
    { label: "Sugar / Salt Cravings", slugs: ["sugar-cravings", "craving-sweets", "craving-salt", "salt-craving"] },
  ],
  // Hormonal symptoms that apply to either sex (thyroid, adrenal, generic libido)
  hormonal: [
    { label: "Libido (general / non-specific)", slugs: ["decreased-libido", "low-libido"] },
    { label: "Cold intolerance / temperature regulation", slugs: ["cold-intolerance", "cold-intolerance-and-weight-gain"] },
    { label: "Heat intolerance", slugs: ["heat-intolerance"] },
  ],
  womens_health: [
    { label: "Perimenopause symptoms", slugs: ["perimenopause-symptoms"] },
    { label: "Menopause symptoms", slugs: ["menopause-symptoms"] },
    { label: "Hot flashes / Night sweats", slugs: ["hot-flashes", "night-sweats"] },
    { label: "Vaginal symptoms", slugs: ["vaginal-itching", "vaginal-dryness", "vaginal-discharge"] },
    { label: "Menstrual irregularities", slugs: ["irregular-periods", "irregular-menstrual-cycles", "menstrual-irregularities", "heavy-periods", "painful-periods"] },
    { label: "PMS / PMDD", slugs: ["pms", "pms-symptoms", "premenstrual-tension", "pms-irregular-cycles-low-libido"] },
    { label: "Hormonal acne", slugs: ["acne-hormonal"] },
    { label: "Excess facial / body hair (PCOS marker)", slugs: ["facial-hair"] },
    { label: "Breast: tenderness / fibrocystic", slugs: ["breast-tenderness", "fibrocystic-breasts"] },
    { label: "Estrogen dominance signs", slugs: ["estrogen-dominance-symptoms"] },
    { label: "Fertility / Miscarriage", slugs: ["infertility-female", "primary-infertility", "recurrent-miscarriage"] },
  ],
  mens_health: [
    { label: "Erectile dysfunction", slugs: ["erectile-dysfunction"] },
    { label: "Loss of morning erections", slugs: ["morning-erection-loss"] },
    { label: "Premature ejaculation", slugs: ["premature-ejaculation"] },
    { label: "Low testosterone / andropause", slugs: ["low-testosterone-symptoms"] },
    { label: "Prostate / urinary changes", slugs: ["prostate-symptoms"] },
  ],
  sleep: [
    { label: "Insomnia / Poor Sleep", slugs: ["insomnia", "poor-sleep", "sleep-disruption", "sleep-disturbance"] },
  ],
  musculoskeletal: [
    { label: "Joint / Muscle Pain", slugs: ["joint-pain", "joint-muscle-pain", "chronic-pain"] },
    { label: "Cramps / Tension", slugs: ["muscle-cramps", "muscle-tension", "tension"] },
  ],
  constitutional: [
    { label: "Fatigue", slugs: ["fatigue", "chronic-fatigue", "low-energy"] },
  ],
};

function CategoryPicker({
  options,
  value,
  onChange,
  placeholder,
  maxHeight = "28rem",
  transcriptSlugs = new Set(),
  clientSex,
}: {
  options: Opt[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxHeight?: string;
  transcriptSlugs?: Set<string>;
  /** Drives which gender-specific category section to show. Defaults to BOTH
   *  when sex is unknown so coach never loses access to a relevant symptom. */
  clientSex?: string | null;
}) {
  const [query, setQuery] = useState("");
  // expandedCats: which category accordions are open
  // expandedClusters: which concept-clusters within a category are open
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const sel = new Set(value);
    for (const o of options) if (sel.has(o.slug)) s.add(o.category || "other");
    return s;
  });
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const sel = new Set(value);
    for (const [cat, clusters] of Object.entries(CONCEPT_CLUSTERS)) {
      for (const cl of clusters) {
        if (cl.slugs.some((slug) => sel.has(slug))) s.add(`${cat}::${cl.label}`);
      }
    }
    return s;
  });

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return null;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    );
  }, [q, options]);

  // Build per-category structure: clusters + unclustered singletons.
  // Applies SLUG_CATEGORY_OVERRIDES to re-route gendered symptoms into
  // womens_health / mens_health, and gender-filters those categories away
  // when the client's sex is set.
  const { showWomens, showMens } = gendersToShow(clientSex);
  const effectiveCategoryOf = (o: Opt): string =>
    SLUG_CATEGORY_OVERRIDES[o.slug] ?? o.category ?? "other";

  const byCategory = useMemo(() => {
    const slugSet = new Set(options.map((o) => o.slug));
    const result: Record<string, { clusters: { label: string; opts: Opt[] }[]; singles: Opt[] }> = {};

    for (const cat of CATEGORY_ORDER) {
      // Gender filter: hide irrelevant gendered category entirely.
      if (cat === "womens_health" && !showWomens) continue;
      if (cat === "mens_health" && !showMens) continue;

      const catOpts = options.filter((o) => effectiveCategoryOf(o) === cat);
      if (catOpts.length === 0) continue;

      const clusterDefs = CONCEPT_CLUSTERS[cat] ?? [];
      const clusteredSlugs = new Set(clusterDefs.flatMap((c) => c.slugs));

      const clusters = clusterDefs
        .map((cl) => ({
          label: cl.label,
          opts: cl.slugs
            .filter((slug) => slugSet.has(slug))
            .map((slug) => options.find((o) => o.slug === slug)!)
            .filter(Boolean),
        }))
        .filter((cl) => cl.opts.length > 0);

      const singles = catOpts.filter((o) => !clusteredSlugs.has(o.slug));
      result[cat] = { clusters, singles };
    }
    return result;
  }, [options, showWomens, showMens]);

  function toggle(slug: string) {
    if (value.includes(slug)) onChange(value.filter((v) => v !== slug));
    else onChange([...value, slug]);
  }

  function toggleCat(cat: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function toggleCluster(key: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const labelOf = (slug: string) => options.find((o) => o.slug === slug)?.label ?? slug;

  const SymptomRow = ({ o, indent = false }: { o: Opt; indent?: boolean }) => {
    const checked = value.includes(o.slug);
    const fromTranscript = transcriptSlugs.has(o.slug);
    return (
      <label
        className={`flex items-center gap-2 py-1.5 cursor-pointer select-none hover:bg-muted/50 ${
          indent ? "pl-8 pr-3" : "px-4"
        } ${checked ? "bg-primary/5 font-medium" : ""}`}
      >
        <input type="checkbox" checked={checked} onChange={() => toggle(o.slug)} className="rounded shrink-0" />
        <span className="text-sm">{o.label}</span>
        {fromTranscript && (
          <span className="ml-auto text-[10px] text-emerald-600 font-medium shrink-0">📞</span>
        )}
      </label>
    );
  };

  const orderedCats = CATEGORY_ORDER.filter((c) => byCategory[c]);

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1 text-xs">
              {labelOf(v)}
              <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v}`} className="ml-0.5 hover:text-destructive">×</button>
            </Badge>
          ))}
          <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground hover:underline self-center">clear all</button>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />

      <div className="border rounded-md overflow-y-auto" style={{ maxHeight }}>
        {filtered !== null ? (
          // ── Search mode: flat results ──
          filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches for &ldquo;{query}&rdquo;</div>
          ) : (
            <div className="divide-y">
              {filtered.map((o) => (
                <label key={o.slug} className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-muted/50 ${value.includes(o.slug) ? "bg-primary/5 font-medium" : ""}`}>
                  <input type="checkbox" checked={value.includes(o.slug)} onChange={() => toggle(o.slug)} className="rounded shrink-0" />
                  <span className="text-sm">{o.label}</span>
                  {transcriptSlugs.has(o.slug) && (
                    <span className="text-[10px] text-emerald-600 font-medium shrink-0">📞</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground font-mono shrink-0">{o.slug}</span>
                </label>
              ))}
            </div>
          )
        ) : (
          // ── Category accordion mode (two levels) ──
          <div className="divide-y">
            {orderedCats.map((cat) => {
              const { clusters, singles } = byCategory[cat];
              const allInCat = [
                ...clusters.flatMap((cl) => cl.opts.map((o) => o.slug)),
                ...singles.map((o) => o.slug),
              ];
              const selectedInCat = allInCat.filter((s) => value.includes(s)).length;
              const isCatOpen = expandedCats.has(cat);

              return (
                <div key={cat}>
                  {/* ── Level 1: Category header ── */}
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-muted/50 text-left"
                    onClick={() => toggleCat(cat)}
                  >
                    <span>
                      {CATEGORY_LABELS[cat] ?? cat}
                      {selectedInCat > 0 && (
                        <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{selectedInCat}</Badge>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">{isCatOpen ? "▲" : "▼"}</span>
                  </button>

                  {isCatOpen && (
                    <div className="bg-muted/5 divide-y">
                      {/* ── Level 2a: Concept clusters (expandable) ── */}
                      {clusters.map((cl) => {
                        const clKey = `${cat}::${cl.label}`;
                        const isClOpen = expandedClusters.has(clKey);
                        const selectedInCl = cl.opts.filter((o) => value.includes(o.slug)).length;

                        // Single-item clusters: just show the row directly, no expand
                        if (cl.opts.length === 1) {
                          return <SymptomRow key={cl.opts[0].slug} o={cl.opts[0]} />;
                        }

                        return (
                          <div key={clKey}>
                            {/* Cluster header */}
                            <button
                              type="button"
                              className="w-full flex items-center justify-between pl-4 pr-3 py-1.5 text-sm hover:bg-muted/50 text-left text-muted-foreground"
                              onClick={() => toggleCluster(clKey)}
                            >
                              <span className="font-medium text-foreground/80">
                                {cl.label}
                                {selectedInCl > 0 && (
                                  <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 border-primary/40 text-primary">{selectedInCl}</Badge>
                                )}
                              </span>
                              <span className="text-[11px]">{cl.opts.length} variants · {isClOpen ? "▲" : "▼"}</span>
                            </button>
                            {/* Cluster sub-items */}
                            {isClOpen && (
                              <div className="divide-y">
                                {cl.opts.map((o) => <SymptomRow key={o.slug} o={o} indent />)}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* ── Level 2b: Unclustered singletons ── */}
                      {singles.map((o) => <SymptomRow key={o.slug} o={o} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length > 0 ? `${value.length} selected · ` : ""}
        {filtered !== null
          ? `${filtered.length} of ${options.length} shown — clear search to browse by category`
          : `${options.length} symptoms in ${orderedCats.length} categories`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SynthesisNotes — formatted rendering of the AI's synthesis_notes string.
// ---------------------------------------------------------------------------

function SynthesisNotes({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);

  const HEADER_RE = /^(\*\*[^*]+:\*\*|[A-Z][A-Za-z\s]+:|Note:|Summary:|Confident:|Caution:|Watch for:)/;
  const LIST_RE = /^([•\-*]|\d+\.)\s/;

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");
        const elements: React.ReactNode[] = [];
        let listItems: string[] = [];

        const flushList = () => {
          if (listItems.length > 0) {
            elements.push(
              <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-0.5 text-sm">
                {listItems.map((item, li) => (
                  <li key={li}>{item.replace(/^([•\-*]|\d+\.)\s/, "")}</li>
                ))}
              </ul>
            );
            listItems = [];
          }
        };

        for (const line of lines) {
          if (LIST_RE.test(line)) {
            listItems.push(line);
          } else {
            flushList();
            if (HEADER_RE.test(line)) {
              // Bold header line
              const cleaned = line.replace(/\*\*/g, "");
              elements.push(
                <p key={`h-${elements.length}`} className="font-semibold text-sm mt-1">
                  {cleaned}
                </p>
              );
            } else if (line.trim()) {
              elements.push(
                <p key={`p-${elements.length}`} className="text-sm">
                  {line}
                </p>
              );
            }
          }
        }
        flushList();

        return <div key={pi}>{elements}</div>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComputedRatiosCard — color-coded FM marker ratios from lab data.
// ---------------------------------------------------------------------------

function FlagDot({ flag }: { flag: string }) {
  if (flag === "optimal") return <span className="text-green-600 font-bold">🟢</span>;
  if (flag === "suboptimal") return <span className="text-yellow-600 font-bold">🟡</span>;
  return <span className="text-red-600 font-bold">🔴</span>;
}

function FlagBadge({ flag }: { flag: string }) {
  if (flag === "optimal")
    return <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">{flag}</Badge>;
  if (flag === "suboptimal")
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-[10px]">{flag}</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-300 text-[10px]">{flag}</Badge>;
}

/** A Card whose body collapses on header-click. Open/closed state persists
 *  per coach in localStorage under `fmcoach_collapse_<storageKey>`. */
function CollapsibleCard({
  title,
  storageKey,
  defaultOpen = true,
  children,
}: {
  title: React.ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const lsKey = `fmcoach_collapse_${storageKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOpen;
    const v = window.localStorage?.getItem(lsKey);
    if (v == null) return defaultOpen;
    return v === "1";
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(lsKey, next ? "1" : "0");
    }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center justify-between gap-2 text-left hover:text-foreground/80"
          aria-expanded={open}
        >
          <CardTitle className="text-sm">{title}</CardTitle>
          <span className="text-xs text-muted-foreground select-none">
            {open ? "▾" : "▸"}
          </span>
        </button>
      </CardHeader>
      {open && children}
    </Card>
  );
}

function ComputedRatiosCard({ ratios }: { ratios: ComputedRatio[] }) {
  if (!ratios || ratios.length === 0) return null;
  return (
    <CollapsibleCard title="📊 Key FM markers" storageKey="fm_markers">
      <CardContent className="space-y-2 text-sm">
        {ratios.map((r, i) => (
          <div key={i} className="flex items-start gap-3 border rounded-md p-2">
            <FlagDot flag={r.flag} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{r.marker_name}</span>
                <span className="font-mono text-xs">
                  {r.value}{r.unit ? ` ${r.unit}` : ""}
                </span>
                <FlagBadge flag={r.flag} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{r.fm_interpretation}</div>
              <div className="text-[11px] text-muted-foreground/70 mt-0.5">Ref: {r.reference_range}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </CollapsibleCard>
  );
}

function UsageStats({ usage, subgraphBytes }: { usage?: AssessUsage; subgraphBytes?: number }) {
  if (!usage) return null;
  return (
    <p className="text-xs text-muted-foreground">
      model: <code>{usage.model || "?"}</code> · in:{" "}
      {usage.input_tokens ?? "?"} · out: {usage.output_tokens ?? "?"} · cache
      read: {usage.cache_read_input_tokens ?? 0} · cache write:{" "}
      {usage.cache_creation_input_tokens ?? 0} · stop:{" "}
      {usage.stop_reason || "?"}
      {subgraphBytes != null && (
        <> · subgraph: {(subgraphBytes / 1024).toFixed(0)} KB</>
      )}
    </p>
  );
}

function SuggestionsView({
  suggestions,
  picks,
  setPicks,
  selectedTopics,
  computedRatios,
}: {
  suggestions: AssessSuggestions;
  picks: Record<string, boolean>;
  setPicks: (next: Record<string, boolean>) => void;
  selectedTopics: string[];
  computedRatios?: ComputedRatio[];
}) {
  const isOn = (k: string) => picks[k] ?? true;
  const set = (k: string, v: boolean) => setPicks({ ...picks, [k]: v });

  const Pick = ({ k }: { k: string }) => (
    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={isOn(k)}
        onChange={(e) => set(k, e.target.checked)}
      />
      include
    </label>
  );

  const drivers = suggestions.likely_drivers;
  const topics = suggestions.topics_in_play;
  const lifestyles = suggestions.lifestyle_suggestions;
  const nutrition = suggestions.nutrition_suggestions;
  const supplements = suggestions.supplement_suggestions;
  const protocols = suggestions.suggested_protocols ?? [];
  const labs = suggestions.lab_followups;
  const refs = suggestions.referral_triggers;
  const edu = suggestions.education_framings;
  const extracted = suggestions.extracted_labs;
  const synthesisNotes = suggestions.synthesis_notes;

  return (
    <div className="space-y-4">
      {synthesisNotes && (
        <CollapsibleCard title="🧐 Synthesis notes" storageKey="synthesis_notes">
          <CardContent>
            <SynthesisNotes text={synthesisNotes} />
          </CardContent>
        </CollapsibleCard>
      )}

      {/* Computed FM ratios — shown BEFORE raw extracted labs */}
      {computedRatios && computedRatios.length > 0 && (
        <ComputedRatiosCard ratios={computedRatios} />
      )}

      {extracted.length > 0 && (
        <CollapsibleCard title="🧪 Extracted lab values" storageKey="extracted_labs">
          <CardContent className="text-sm space-y-1">
            {extracted.map((lab, i) => (
              <div key={i} className="flex gap-2 border-b pb-1">
                <span className="font-medium">{String(lab.test_name ?? "?")}</span>
                <span>
                  {String(lab.value ?? "?")} {String(lab.unit ?? "")}
                </span>
                <Badge variant="outline">{String(lab.flag ?? "—")}</Badge>
                <span className="text-xs text-muted-foreground">
                  {String(lab.fm_interpretation ?? "")}
                </span>
              </div>
            ))}
          </CardContent>
        </CollapsibleCard>
      )}

      {drivers.length > 0 && (
        <CollapsibleCard
          title={<span>🎯 Likely drivers (ATM cascade) <span className="text-[11px] font-normal text-muted-foreground">— antecedent → trigger → mediator → expression</span></span>}
          storageKey="likely_drivers"
        >
          <CardContent className="space-y-4 text-sm">
            {(() => {
              type Bucket = { key: "antecedent" | "trigger" | "mediator" | "expression"; label: string; emoji: string; color: string };
              const BUCKETS: Bucket[] = [
                { key: "antecedent",  label: "Antecedents",  emoji: "🧬", color: "border-purple-200 bg-purple-50/60" },
                { key: "trigger",     label: "Triggers",     emoji: "⚡", color: "border-amber-200 bg-amber-50/60" },
                { key: "mediator",    label: "Mediators",    emoji: "🔁", color: "border-blue-200 bg-blue-50/60" },
                { key: "expression",  label: "Expressions",  emoji: "🩺", color: "border-rose-200 bg-rose-50/50" },
              ];

              const grouped = new Map<string, typeof drivers>();
              const unclassified: typeof drivers = [];
              for (const d of drivers) {
                const role = (d.atm_role ?? "").toLowerCase();
                if (role === "antecedent" || role === "trigger" || role === "mediator" || role === "expression") {
                  const arr = grouped.get(role) ?? [];
                  arr.push(d);
                  grouped.set(role, arr);
                } else {
                  unclassified.push(d);
                }
              }

              const renderDriver = (d: typeof drivers[number]) => {
                const slug = String(d.mechanism_slug ?? "?");
                const k = `driver_${slug}`;
                const parents = (d.parents ?? []).filter(Boolean);
                return (
                  <div key={k} className="rounded-md border bg-background p-2 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            #{String(d.rank ?? "?")}
                          </span>
                          <a
                            href={`/catalogue/mechanisms/${slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-sm hover:underline break-all"
                          >
                            {slug}
                          </a>
                        </div>
                        {d.reasoning && (
                          <p className="text-xs text-muted-foreground leading-snug mt-1">
                            {String(d.reasoning)}
                          </p>
                        )}
                        {d.chain_evidence && (
                          <p className="text-[11px] italic text-foreground/70 leading-snug mt-1 border-l-2 border-muted pl-2">
                            {String(d.chain_evidence)}
                          </p>
                        )}
                        {parents.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            <span className="font-medium">↑ from: </span>
                            {parents.join(" · ")}
                          </p>
                        )}
                      </div>
                      <Pick k={k} />
                    </div>
                  </div>
                );
              };

              return (
                <div className="space-y-3">
                  {BUCKETS.map((b) => {
                    const items = grouped.get(b.key) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <div key={b.key} className={`rounded-lg border-2 p-2.5 space-y-2 ${b.color}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{b.emoji}</span>
                          <span className="text-xs font-semibold uppercase tracking-wide">
                            {b.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">({items.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {items.map(renderDriver)}
                        </div>
                      </div>
                    );
                  })}
                  {unclassified.length > 0 && (
                    <div className="rounded-lg border-2 border-gray-200 bg-gray-50/60 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">❓</span>
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          Unclassified
                        </span>
                        <span className="text-[10px] text-muted-foreground">({unclassified.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {unclassified.map(renderDriver)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </CollapsibleCard>
      )}

      {topics.length > 0 && (
        <CollapsibleCard title="🩺 Conditions in play" storageKey="conditions_in_play">
          <CardContent className="space-y-2 text-sm">
            {topics.map((t) => {
              const slug = String(t.topic_slug ?? "?");
              const role = String(t.role ?? "primary");
              const confidencePct = typeof t.confidence_pct === "number" ? t.confidence_pct : null;
              const isCoachSelected = selectedTopics.includes(slug);
              const k = `topic_${slug}_${role}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {role === "primary" ? "🟢" : "🟡"} {slug} ({role})
                      {!isCoachSelected && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">
                          💡 AI suggested
                        </Badge>
                      )}
                    </div>
                    {confidencePct !== null && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-primary/20">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${confidencePct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {confidencePct}%
                        </span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {String(t.rationale ?? "")}
                    </div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {lifestyles.length > 0 && (
        <CollapsibleCard title="🌿 Lifestyle suggestions" storageKey="lifestyle">
          <CardContent className="space-y-2 text-sm">
            {lifestyles.map((ls, i) => {
              const name = String(ls.name ?? "?");
              const k = `lifestyle_${i}_${name}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {name} <span className="text-muted-foreground text-xs">({String(ls.cadence ?? "?")})</span>
                    </div>
                    {ls.details ? (
                      <div className="text-xs text-muted-foreground">{String(ls.details)}</div>
                    ) : null}
                    <div className="text-xs italic">{String(ls.rationale ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {nutrition && (
        <CollapsibleCard
          title={<span className="flex items-center gap-2">🥗 Nutrition <Pick k="nutrition_block" /></span>}
          storageKey="nutrition"
        >
          <CardContent className="text-sm space-y-1">
            {nutrition.pattern ? <div><strong>Pattern:</strong> {nutrition.pattern}</div> : null}
            {nutrition.add && nutrition.add.length > 0 ? (
              <div><strong>Add:</strong> {nutrition.add.join(", ")}</div>
            ) : null}
            {nutrition.reduce && nutrition.reduce.length > 0 ? (
              <div><strong>Reduce:</strong> {nutrition.reduce.join(", ")}</div>
            ) : null}
            {nutrition.meal_timing ? <div><strong>Meal timing:</strong> {nutrition.meal_timing}</div> : null}
            {nutrition.cooking_adjustment_slugs && nutrition.cooking_adjustment_slugs.length > 0 ? (
              <div><strong>Cooking adjustments:</strong> {nutrition.cooking_adjustment_slugs.join(", ")}</div>
            ) : null}
            {nutrition.home_remedy_slugs && nutrition.home_remedy_slugs.length > 0 ? (
              <div><strong>Home remedies:</strong> {nutrition.home_remedy_slugs.join(", ")}</div>
            ) : null}
            {nutrition.rationale ? <div className="text-xs italic">{nutrition.rationale}</div> : null}
          </CardContent>
        </CollapsibleCard>
      )}

      {protocols.length > 0 && (
        <CollapsibleCard
          title={<span>🧭 Recommended protocols (top 2) <span className="text-[11px] font-normal text-muted-foreground">— pick ONE; it shapes all letters</span></span>}
          storageKey="protocols"
        >
          <CardContent className="space-y-3 text-sm">
            {protocols.map((p, i) => {
              const slug = String(p.protocol_slug ?? `?_${i}`);
              const pickKey = `protocol_${slug}`;
              const isPicked = picks[pickKey] === true;
              const fitPercent = p.fit_percent ?? null;
              const pctColor =
                fitPercent == null ? "bg-gray-100 text-gray-700" :
                fitPercent >= 80 ? "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-300" :
                fitPercent >= 65 ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" :
                "bg-red-50 text-red-800 ring-1 ring-red-200";
              const cardBorder = isPicked
                ? "border-emerald-400 bg-emerald-50/40"
                : "border-[rgba(43,45,66,0.18)] bg-[rgba(250,248,245,0.4)]";
              return (
                <div key={pickKey} className={`rounded-lg border-2 p-3 space-y-2 transition-colors ${cardBorder}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/catalogue/protocols/${slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-sm hover:underline"
                        style={{ color: "var(--brand-indigo, #2B2D42)" }}
                      >
                        {slug}
                      </a>
                      {fitPercent != null && (
                        <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${pctColor}`}>
                          {Math.round(fitPercent)}% fit
                        </span>
                      )}
                      {p.expected_weeks != null && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          {p.expected_weeks}w
                        </span>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer shrink-0">
                      <input
                        type="radio"
                        name="selected_protocol"
                        checked={isPicked}
                        onChange={() => {
                          // Mutual-exclusion radio — clear other protocol_* keys
                          const next = { ...picks };
                          for (const k of Object.keys(next)) {
                            if (k.startsWith("protocol_")) next[k] = false;
                          }
                          next[pickKey] = true;
                          setPicks(next);
                        }}
                        className="accent-emerald-600"
                      />
                      <span>Use this protocol</span>
                    </label>
                  </div>
                  {p.why_indicated && (
                    <p className="text-sm leading-relaxed text-foreground/80">
                      {p.why_indicated}
                    </p>
                  )}
                  {p.factor_scores && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium select-none">
                        📊 Score breakdown
                      </summary>
                      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-1">
                        {(Object.keys(FACTOR_LABELS) as (keyof FactorScores)[]).map((f) => {
                          const s = p.factor_scores?.[f];
                          if (s == null) return null;
                          const w = FACTOR_WEIGHTS[f];
                          const dotColor = s >= 4 ? "#059669" : s >= 3 ? "#D97706" : "#DC2626";
                          return (
                            <li key={f} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                                {FACTOR_LABELS[f]}
                                <span className="text-[9px] text-muted-foreground/70">({w}%)</span>
                              </span>
                              <span className="tabular-nums font-medium">{s}/5</span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                  {p.when_to_start && (
                    <p className="text-xs">
                      <span className="text-muted-foreground font-medium">When to start: </span>
                      {p.when_to_start}
                    </p>
                  )}
                  {p.client_specific_modifications && (
                    <p className="text-xs">
                      <span className="text-muted-foreground font-medium">Modifications: </span>
                      {p.client_specific_modifications}
                    </p>
                  )}
                  {p.contraindication_check && (
                    <p className="text-xs rounded-md bg-amber-50 border border-amber-200 px-2 py-1">
                      <span className="font-medium">⚠ Contraindication check: </span>
                      {p.contraindication_check}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {supplements.length > 0 && (
        <CollapsibleCard title="💊 Supplements" storageKey="supplements">
          <CardContent className="space-y-2 text-sm">
            {supplements.map((sp) => {
              const slug = String(sp.supplement_slug ?? "?");
              const k = `supp_${slug}`;
              const vitaoneUrl = sp.vitaone_url ?? "";
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <span>{slug}</span>
                      {vitaoneUrl ? (
                        <a
                          href={vitaoneUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100"
                          title="Stocked on VitaOne — click to view product"
                        >
                          🛒 VitaOne
                        </a>
                      ) : null}
                    </div>
                    <div className="text-xs">
                      {sp.form ? `${String(sp.form)} · ` : ""}
                      {sp.dose ? `${String(sp.dose)} · ` : ""}
                      {sp.timing ? String(sp.timing) : ""}
                    </div>
                    <div className="text-xs italic">{String(sp.rationale ?? "")}</div>
                    {sp.evidence_tier_caveat ? (
                      <div className="text-xs text-orange-700">
                        ⚠ {String(sp.evidence_tier_caveat)}
                      </div>
                    ) : null}
                    {sp.contraindication_check ? (
                      <div className="text-xs text-red-700">
                        ⚠ {String(sp.contraindication_check)}
                      </div>
                    ) : null}
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {labs.length > 0 && (
        <CollapsibleCard title="🔬 Lab follow-ups" storageKey="lab_followups">
          <CardContent className="space-y-1 text-sm">
            {labs.map((lf, i) => {
              const k = `lab_${i}_${String(lf.test ?? "")}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">{String(lf.test ?? "?")}</div>
                    <div className="text-xs text-muted-foreground">{String(lf.reason ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {refs.length > 0 && (
        <CollapsibleCard title="↗️ Referrals" storageKey="referrals">
          <CardContent className="space-y-1 text-sm">
            {refs.map((r, i) => {
              const k = `ref_${i}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {String(r.to ?? "?")} <Badge variant="outline">{String(r.urgency ?? "routine")}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{String(r.reason ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}

      {edu.length > 0 && (
        <CollapsibleCard title="🎓 Education framings" storageKey="education">
          <CardContent className="space-y-1 text-sm">
            {edu.map((ed, i) => {
              const k = `edu_${i}_${String(ed.target_slug ?? "")}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {prettyKindSingular(ed.target_kind)}: {String(ed.target_slug ?? "?")}
                    </div>
                    <div className="text-xs">{String(ed.client_facing_summary ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </CollapsibleCard>
      )}
    </div>
  );
}

function ChatPanel({
  clientId,
  sessionId,
  dryRun,
}: {
  clientId: string;
  sessionId: string;
  dryRun: boolean;
}) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [usageByIndex, setUsageByIndex] = useState<
    Record<number, AssessUsage | undefined>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isFirstScroll = useRef<boolean>(true);

  // Auto-scroll to the bottom on rehydration (instant) and on every new
  // turn (smooth). The first non-empty render is detected via a ref flag so
  // we don't animate the initial chat-log fill.
  useEffect(() => {
    if (history.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isFirstScroll.current ? "instant" : "smooth",
    });
    isFirstScroll.current = false;
  }, [history.length]);

  // Rehydrate persisted chat_log when the session changes, so reloading the
  // page or coming back later restores the conversation. Only seeds when
  // local state is empty — never clobbers in-flight messages. Cancels via
  // an `ignore` flag if the session id changes mid-fetch (prevents the
  // stale response from a prior session overwriting the current one).
  useEffect(() => {
    if (!clientId || !sessionId) return;
    let ignore = false;
    (async () => {
      const res = await loadSessionChatAction({
        client_id: clientId,
        session_id: sessionId,
        dry_run: dryRun,
      });
      if (ignore) return;
      if (!res.ok) {
        toast.error(res.error ?? "Failed to load chat history");
        return;
      }
      if (res.chat_log.length > 0) {
        setHistory((current) => (current.length === 0 ? res.chat_log : current));
      }
    })();
    return () => {
      ignore = true;
    };
  }, [clientId, sessionId, dryRun]);

  const onSend = () => {
    const msg = draft.trim();
    if (!msg || pending) return;
    setError(null);
    const next: ChatTurn[] = [
      ...history,
      { role: "user", content: msg, at: new Date().toISOString() },
    ];
    setHistory(next);
    setDraft("");
    startTransition(async () => {
      try {
        const res = await chatAction({
          client_id: clientId,
          session_id: sessionId,
          history,
          user_message: msg,
          dry_run: dryRun,
        });
        if (!res.ok || !res.assistant_message) {
          const msg = res.error || "Chat call failed";
          setError(msg);
          toast.error(msg);
          return;
        }
        const reply: ChatTurn = {
          role: "assistant",
          content: res.assistant_message,
          at: new Date().toISOString(),
        };
        setHistory((h) => {
          const newHistory = [...h, reply];
          setUsageByIndex((u) => ({ ...u, [newHistory.length - 1]: res.usage }));
          return newHistory;
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          💬 Chat — refine these suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Ask follow-ups: "is ashwagandha safe with Hashimoto's?", "swap
          magnesium-glycinate for magnesium-threonate — implications?". Each
          turn reuses the cached client + catalogue context (~$0.05–0.10).
        </div>

        <div
          ref={scrollRef}
          className="border rounded p-3 max-h-[400px] overflow-y-auto bg-muted/30 space-y-3"
        >
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No messages yet — ask anything about this assessment.
            </p>
          )}
          {history.map((turn, i) => {
            const isUser = turn.role === "user";
            const usage = usageByIndex[i];
            return (
              <div
                key={i}
                className={
                  isUser
                    ? "flex justify-end"
                    : "flex flex-col items-start gap-1"
                }
              >
                <div
                  className={
                    isUser
                      ? "max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground whitespace-pre-wrap"
                      : "max-w-[85%] rounded-lg px-3 py-2 text-sm bg-background border whitespace-pre-wrap"
                  }
                >
                  {turn.content}
                </div>
                {!isUser && usage && (
                  <span className="text-[10px] text-muted-foreground pl-1">
                    tokens — in: {usage.input_tokens ?? "?"} · out:{" "}
                    {usage.output_tokens ?? "?"} · cache hit:{" "}
                    {usage.cache_read_input_tokens ?? 0}
                    {usage.model ? ` · ${usage.model}` : ""}
                  </span>
                )}
              </div>
            );
          })}
          {pending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              thinking…
            </div>
          )}
        </div>

        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a follow-up… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 rounded border bg-background px-2 py-1 text-sm resize-y min-h-[40px]"
            disabled={pending}
          />
          <Button onClick={onSend} disabled={pending || !draft.trim()}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Health data helpers ──────────────────────────────────────────────────────

function emptyHealthData(): ExtractedHealthData {
  return {
    lab_values: [],
    measurements: {
      height_cm: null, weight_kg: null,
      bp_systolic: null, bp_diastolic: null,
      hr_bpm: null, waist_cm: null, hip_cm: null,
    },
    medications: [],
    conditions: [],
  };
}

function mergeHealthData(a: ExtractedHealthData | null, b: ExtractedHealthData): ExtractedHealthData {
  if (!a) return { ...emptyHealthData(), ...b, measurements: { ...emptyHealthData().measurements, ...b.measurements } };
  // Merge lab values: deduplicate by test_name
  const labMap = new Map<string, ExtractedLabValue>();
  for (const lv of [...a.lab_values, ...b.lab_values]) labMap.set(lv.test_name.toLowerCase(), lv);
  // Merge measurements: non-null wins, b takes precedence
  const meas: ExtractedMeasurements = { ...a.measurements };
  for (const k of Object.keys(b.measurements ?? {}) as Array<keyof ExtractedMeasurements>) {
    if (b.measurements[k] != null) meas[k] = b.measurements[k] as never;
  }
  // Merge string lists: deduplicate case-insensitively
  const mergeLists = (x: string[], y: string[]) => {
    const seen = new Set(x.map(s => s.toLowerCase()));
    return [...x, ...y.filter(s => !seen.has(s.toLowerCase()))];
  };
  return {
    lab_values: Array.from(labMap.values()),
    measurements: meas,
    medications: mergeLists(a.medications, b.medications),
    conditions: mergeLists(a.conditions, b.conditions),
  };
}

// ─── Editable health data panel ───────────────────────────────────────────────

function HealthDataEditor({
  data,
  onChange,
  clientId,
  source,
  onApplied,
}: {
  data: ExtractedHealthData;
  onChange: (d: ExtractedHealthData) => void;
  clientId: string | null;
  source: string;
  onApplied?: () => void;
}) {
  const [applyPending, startApply] = useTransition();
  const [useImperial, setUseImperial] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage?.getItem("fmcoach_units") === "imperial";
  });

  const toggleUnits = (next: boolean) => {
    setUseImperial(next);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("fmcoach_units", next ? "imperial" : "metric");
    }
  };

  const setMeas = (key: keyof ExtractedMeasurements, val: string) => {
    const num = val === "" ? null : Number(val);
    onChange({ ...data, measurements: { ...data.measurements, [key]: isNaN(num as number) ? null : num } });
  };

  /** Set a length measurement (cm storage) from a possibly-imperial input string. */
  const setLengthFromInput = (key: "height_cm" | "waist_cm" | "hip_cm", val: string) => {
    if (val === "") return setMeas(key, "");
    const n = Number(val);
    if (isNaN(n)) return;
    const cm = useImperial ? n * 2.54 : n;
    onChange({ ...data, measurements: { ...data.measurements, [key]: Math.round(cm * 10) / 10 } });
  };

  const setWeightFromInput = (val: string) => {
    if (val === "") return setMeas("weight_kg", "");
    const n = Number(val);
    if (isNaN(n)) return;
    const kg = useImperial ? n * 0.453592 : n;
    onChange({ ...data, measurements: { ...data.measurements, weight_kg: Math.round(kg * 10) / 10 } });
  };

  /** Display value for a length stored in cm — converted to inches if needed. */
  const lengthDisplay = (cm: number | null | undefined): string => {
    if (cm == null) return "";
    return useImperial ? String(Math.round((cm / 2.54) * 10) / 10) : String(cm);
  };

  const weightDisplay = (kg: number | null | undefined): string => {
    if (kg == null) return "";
    return useImperial ? String(Math.round((kg * 2.20462) * 10) / 10) : String(kg);
  };

  const setLabValue = (i: number, field: keyof ExtractedLabValue, val: string) => {
    const labs = [...data.lab_values];
    labs[i] = { ...labs[i], [field]: val };
    onChange({ ...data, lab_values: labs });
  };

  const addLab = () => onChange({ ...data, lab_values: [...data.lab_values, { test_name: "", value: "", unit: "" }] });
  const removeLab = (i: number) => onChange({ ...data, lab_values: data.lab_values.filter((_, j) => j !== i) });

  const setList = (field: "medications" | "conditions", i: number, val: string) => {
    const arr = [...data[field]];
    arr[i] = val;
    onChange({ ...data, [field]: arr });
  };
  const addItem = (field: "medications" | "conditions") =>
    onChange({ ...data, [field]: [...data[field], ""] });
  const removeItem = (field: "medications" | "conditions", i: number) =>
    onChange({ ...data, [field]: data[field].filter((_, j) => j !== i) });

  const hasMeas = Object.values(data.measurements).some(v => v != null);
  const hasAny = data.lab_values.length > 0 || hasMeas || data.medications.length > 0 || data.conditions.length > 0;

  const inputCls = "border rounded px-1.5 py-0.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white";
  const sectionLabel = "text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1";

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-emerald-800">📋 Health data</p>
        {clientId && (
          <button
            type="button"
            disabled={applyPending || !hasAny}
            onClick={() => {
              startApply(async () => {
                const res = await applyTranscriptDataAction({
                  client_id: clientId,
                  measurements: hasMeas ? data.measurements : undefined,
                  lab_values: data.lab_values.filter(lv => lv.test_name && lv.value),
                  medications: data.medications.filter(Boolean),
                  conditions: data.conditions.filter(Boolean),
                  source,
                });
                if (res.ok) {
                  const fields = res.updated_fields ?? [];
                  toast.success(fields.length
                    ? `Saved to client profile: ${fields.join(", ")}`
                    : (res.message ?? "Nothing new to save"));
                  onApplied?.();
                } else {
                  toast.error(res.error ?? "Failed to save");
                }
              });
            }}
            className="text-xs px-2 py-0.5 rounded border border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
          >
            {applyPending ? "Saving…" : "💾 Save to client profile"}
          </button>
        )}
      </div>

      {/* Lab values */}
      <div>
        <p className={sectionLabel}>Lab values</p>
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr className="text-left text-muted-foreground text-[10px]">
              <th className="pr-1 pb-0.5 font-medium w-2/5">Test name</th>
              <th className="pr-1 pb-0.5 font-medium w-1/4">Value</th>
              <th className="pr-1 pb-0.5 font-medium">Unit</th>
              <th className="w-5"></th>
            </tr>
          </thead>
          <tbody>
            {data.lab_values.map((lv, i) => (
              <tr key={i} className="border-t border-emerald-100">
                <td className="pr-1 py-0.5">
                  <input value={lv.test_name} onChange={e => setLabValue(i, "test_name", e.target.value)} className={inputCls} placeholder="e.g. TSH" />
                </td>
                <td className="pr-1 py-0.5">
                  <input value={lv.value} onChange={e => setLabValue(i, "value", e.target.value)} className={inputCls} placeholder="e.g. 4.2" />
                </td>
                <td className="pr-1 py-0.5">
                  <input value={lv.unit} onChange={e => setLabValue(i, "unit", e.target.value)} className={inputCls} placeholder="e.g. mIU/L" />
                </td>
                <td>
                  <button type="button" onClick={() => removeLab(i)} className="text-red-400 hover:text-red-600 text-[10px] px-0.5">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={addLab} className="text-[10px] text-emerald-700 hover:underline">+ Add lab value</button>
      </div>

      {/* Measurements */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className={sectionLabel}>Measurements</p>
          <div className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
            <button
              type="button"
              onClick={() => toggleUnits(false)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${!useImperial ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              title="cm / kg"
            >cm/kg</button>
            <button
              type="button"
              onClick={() => toggleUnits(true)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${useImperial ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              title="inches / lbs"
            >in/lbs</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
          {/* Height — convertible */}
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Height ({useImperial ? "in" : "cm"})</span>
            <input
              type="number"
              step="0.1"
              value={lengthDisplay(data.measurements.height_cm)}
              onChange={(e) => setLengthFromInput("height_cm", e.target.value)}
              className={inputCls}
              placeholder={useImperial ? "e.g. 68" : "e.g. 173"}
            />
          </label>
          {/* Weight — convertible */}
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Weight ({useImperial ? "lbs" : "kg"})</span>
            <input
              type="number"
              step="0.1"
              value={weightDisplay(data.measurements.weight_kg)}
              onChange={(e) => setWeightFromInput(e.target.value)}
              className={inputCls}
              placeholder={useImperial ? "e.g. 154" : "e.g. 70"}
            />
          </label>
          {/* Waist — convertible */}
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Waist ({useImperial ? "in" : "cm"})</span>
            <input
              type="number"
              step="0.1"
              value={lengthDisplay(data.measurements.waist_cm)}
              onChange={(e) => setLengthFromInput("waist_cm", e.target.value)}
              className={inputCls}
              placeholder={useImperial ? "e.g. 34" : "e.g. 86"}
            />
          </label>
          {/* Hip — convertible */}
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Hip ({useImperial ? "in" : "cm"})</span>
            <input
              type="number"
              step="0.1"
              value={lengthDisplay(data.measurements.hip_cm)}
              onChange={(e) => setLengthFromInput("hip_cm", e.target.value)}
              className={inputCls}
              placeholder={useImperial ? "e.g. 38" : "e.g. 97"}
            />
          </label>
          {/* HR + BP — no unit conversion needed */}
          {([
            ["hr_bpm", "Heart rate (bpm)"],
            ["bp_systolic", "BP systolic"],
            ["bp_diastolic", "BP diastolic"],
          ] as [keyof ExtractedMeasurements, string][]).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <input
                type="number"
                value={data.measurements[key] ?? ""}
                onChange={e => setMeas(key, e.target.value)}
                className={inputCls}
                placeholder="—"
              />
            </label>
          ))}
        </div>
        {/* Computed: waist-to-hip + waist-to-height ratios */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
          {data.measurements.waist_cm && data.measurements.hip_cm ? (
            <p className="text-[10px] text-muted-foreground">
              W:H ratio:{" "}
              <span className="font-semibold text-foreground">
                {(data.measurements.waist_cm / data.measurements.hip_cm).toFixed(2)}
              </span>
              {" "}
              <span className="text-[10px]">
                {(() => {
                  const ratio = data.measurements.waist_cm! / data.measurements.hip_cm!;
                  return ratio >= 0.9 ? "⚠️ high risk" : ratio >= 0.80 ? "⚠️ moderate risk" : "✅ healthy";
                })()}
              </span>
            </p>
          ) : null}
          {data.measurements.waist_cm && data.measurements.height_cm ? (
            <p className="text-[10px] text-muted-foreground">
              W:Ht ratio:{" "}
              <span className="font-semibold text-foreground">
                {(data.measurements.waist_cm / data.measurements.height_cm).toFixed(2)}
              </span>
              {" "}
              <span className="text-[10px]">
                {(() => {
                  const r = data.measurements.waist_cm! / data.measurements.height_cm!;
                  return r >= 0.6 ? "⚠️ high risk" : r >= 0.5 ? "⚠️ central adiposity" : "✅ < ½ height";
                })()}
              </span>
            </p>
          ) : null}
          {data.measurements.height_cm && data.measurements.weight_kg ? (() => {
            const h_m = data.measurements.height_cm! / 100;
            const bmi = data.measurements.weight_kg! / (h_m * h_m);
            // South-Asian-aware BMI thresholds (WHO Asian Pacific): 23 = overweight, 25 = obese
            const tag = bmi >= 30 ? "⚠️ obese" : bmi >= 25 ? "⚠️ obese (Asian)" : bmi >= 23 ? "⚠️ overweight (Asian)" : bmi >= 18.5 ? "✅ healthy" : "⚠️ underweight";
            return (
              <p className="text-[10px] text-muted-foreground">
                BMI:{" "}
                <span className="font-semibold text-foreground">{bmi.toFixed(1)}</span>{" "}
                <span className="text-[10px]">{tag}</span>
              </p>
            );
          })() : null}
        </div>
      </div>

      {/* Medications */}
      <div>
        <p className={sectionLabel}>Medications / Supplements</p>
        <div className="space-y-1 mb-1">
          {data.medications.map((m, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input value={m} onChange={e => setList("medications", i, e.target.value)} className={inputCls} placeholder="e.g. Levothyroxine 50mcg" />
              <button type="button" onClick={() => removeItem("medications", i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => addItem("medications")} className="text-[10px] text-emerald-700 hover:underline">+ Add medication</button>
      </div>

      {/* Conditions */}
      <div>
        <p className={sectionLabel}>Conditions / Diagnoses</p>
        <div className="space-y-1 mb-1">
          {data.conditions.map((c, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input value={c} onChange={e => setList("conditions", i, e.target.value)} className={inputCls} placeholder="e.g. Hashimoto's" />
              <button type="button" onClick={() => removeItem("conditions", i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => addItem("conditions")} className="text-[10px] text-emerald-700 hover:underline">+ Add condition</button>
      </div>

      {data.lab_values.some(lv => lv.test_name && lv.value) && (
        <p className="text-[10px] text-amber-600">⚠ Verbally reported lab values — verify against actual lab report before making clinical decisions.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MindMapContextPanel — shows relevant mindmap pathways for selected symptoms/topics
// ---------------------------------------------------------------------------

const KIND_PILL: Record<string, string> = {
  symptom: "bg-amber-100 text-amber-800",
  topic: "bg-blue-100 text-blue-800",
  mechanism: "bg-purple-100 text-purple-800",
  supplement: "bg-emerald-100 text-emerald-800",
};

const KIND_URL: Record<string, string> = {
  topic: "topics", mechanism: "mechanisms",
  symptom: "symptoms", supplement: "supplements",
  claim: "claims", cooking_adjustment: "cooking_adjustments", home_remedy: "home_remedies",
};

function MindMapContextPanel({
  symptomSlugs,
  topicSlugs,
  clientSex,
}: {
  symptomSlugs: string[];
  topicSlugs: string[];
  clientSex?: string | null;
}) {
  const [pathways, setPathways] = useState<MindMapPathwayResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!symptomSlugs.length && !topicSlugs.length) {
      setPathways([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMindMapPathways(symptomSlugs, topicSlugs, clientSex ?? null).then((res) => {
      if (!cancelled) { setPathways(res); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [symptomSlugs.join(","), topicSlugs.join(","), clientSex]);  // eslint-disable-line

  if (!symptomSlugs.length && !topicSlugs.length) return null;
  if (!loading && !pathways.length) return null;

  return (
    <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          🧭 Root cause pathways
          {loading && <span className="text-xs font-normal text-muted-foreground animate-pulse">scanning mind maps…</span>}
          {!loading && pathways.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              found in {pathways.length} mind map{pathways.length > 1 ? "s" : ""}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pathways.map((p) => {
          const isOpen = expanded[p.mindmapSlug] ?? true;
          // Group matches by their top-level branch (first path segment)
          const byBranch: Record<string, typeof p.matches> = {};
          for (const m of p.matches) {
            const branch = m.path[0] ?? "Other";
            if (!byBranch[branch]) byBranch[branch] = [];
            byBranch[branch].push(m);
          }

          return (
            <div key={p.mindmapSlug} className="rounded-lg border bg-background p-3 space-y-2">
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [p.mindmapSlug]: !isOpen }))}
                  className="flex items-center gap-2 font-medium text-sm hover:underline text-left"
                >
                  <span>{isOpen ? "▾" : "▸"}</span>
                  <span>{p.mindmapName}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {p.matches.length} match{p.matches.length > 1 ? "es" : ""}
                  </Badge>
                </button>
                <a
                  href={`/mindmap/${p.mindmapSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:underline shrink-0"
                >
                  View full map ↗
                </a>
              </div>

              {isOpen && (
                <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                  {/* Matched branches */}
                  {Object.entries(byBranch).map(([branch, matches]) => (
                    <div key={branch} className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {branch}
                      </p>
                      <ul className="space-y-1">
                        {matches.map((m, i) => (
                          <li key={i} className="flex items-baseline gap-2 flex-wrap">
                            {/* Breadcrumb (skip the branch label itself) */}
                            <span className="text-xs text-muted-foreground">
                              {m.path.slice(1, -1).join(" → ")}
                              {m.path.length > 2 && " → "}
                            </span>
                            <span className="text-sm font-medium">{m.nodeLabel}</span>
                            <a
                              href={`/catalogue/${KIND_URL[m.linkedKind] ?? m.linkedKind}/${m.linkedSlug}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors ${KIND_PILL[m.linkedKind] ?? "bg-muted text-muted-foreground"}`}
                            >
                              {m.linkedKind} ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {/* All top-level branches as quick navigation chips */}
                  <div className="pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      Also in this map
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.topLevelBranches
                        .filter((b) => !Object.keys(byBranch).includes(b))
                        .map((branch, i) => (
                          <a
                            key={i}
                            href={`/mindmap/${p.mindmapSlug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] px-2 py-0.5 rounded-full border bg-muted/50 hover:bg-accent text-muted-foreground"
                          >
                            {branch}
                          </a>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RegeneratePlanButton — regenerates a draft plan from a session whose plan
// was manually deleted, reusing the AI analysis already stored on disk.
// ---------------------------------------------------------------------------
function RegeneratePlanButton({
  clientId,
  sessionId,
  onDone,
  onError,
}: {
  clientId: string;
  sessionId: string;
  onDone: (slug: string) => void;
  onError: (err: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await regeneratePlanFromSessionAction(clientId, sessionId);
      if (result.ok && result.slug) {
        onDone(result.slug);
      } else {
        onError(result.error ?? "Unknown error");
      }
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="border-amber-400 text-amber-700 hover:bg-amber-50"
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? "Regenerating…" : "📋 Regenerate plan from this session"}
    </Button>
  );
}

// ─── Plan Brief Card ──────────────────────────────────────────────────────────
// Shown after AI analysis, before the Generate Draft button. Coach can optionally
// pick a protocol template, edit the root cause hypothesis, set plan period and add
// coaching notes. All fields are optional — skip to use AI suggestions as-is.

function PlanBriefCard({
  brief,
  onChange,
  synthesisNotes,
}: {
  brief: PlanBrief;
  onChange: (b: PlanBrief) => void;
  synthesisNotes?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedTemplate = PROTOCOL_TEMPLATES.find((t) => t.id === brief.protocol_template_id);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);

  useEffect(() => {
    if (open && customTemplates.length === 0) {
      loadCustomTemplatesAction().then(setCustomTemplates).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardHeader className="pb-2">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <CardTitle className="text-base flex items-center gap-2">
            🗒️ Plan Brief
            {selectedTemplate && (
              <span className="text-xs font-normal text-indigo-700 bg-indigo-100 rounded px-2 py-0.5">
                {selectedTemplate.icon} {selectedTemplate.display_name}
              </span>
            )}
            {brief.plan_period_weeks && (
              <span className="text-xs font-normal text-muted-foreground">
                · {brief.plan_period_weeks}w
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">{open ? "▲ collapse" : "▼ expand"}</span>
        </button>
        {!open && (
          <p className="text-xs text-muted-foreground pt-1">
            {selectedTemplate
              ? `Protocol: ${selectedTemplate.display_name} — click to edit`
              : "Optional: pick a protocol template + add coaching brief before generating the draft"}
          </p>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 pt-0">
          {/* Protocol template picker — visual cards */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Protocol template <span className="normal-case font-normal">(optional — merges with AI suggestions)</span>
            </label>
            {/* "None" pill + selected template detail */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...brief, protocol_template_id: undefined })}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  !brief.protocol_template_id
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 font-medium"
                    : "border-input bg-background text-muted-foreground hover:bg-muted/50"
                }`}
              >
                ✦ AI only
              </button>
            </div>
            {/* ⭐ Your templates — custom coach templates saved from published plans */}
            {customTemplates.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide">⭐ Your templates</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {customTemplates.map((t) => {
                    const isSelected = brief.protocol_template_id === `custom:${t.slug}`;
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        onClick={() =>
                          onChange({
                            ...brief,
                            protocol_template_id: isSelected ? undefined : (`custom:${t.slug}` as string),
                          })
                        }
                        className={`rounded-lg border p-2.5 text-left text-xs transition-all ${
                          isSelected
                            ? "border-purple-400 bg-purple-50 shadow-sm ring-1 ring-purple-300"
                            : "border-purple-200 bg-purple-50/30 hover:bg-purple-50/60 hover:border-purple-300"
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className="text-base leading-none shrink-0 mt-0.5">{t.icon}</span>
                          <div className="min-w-0">
                            <p className={`font-medium leading-tight truncate ${isSelected ? "text-purple-800" : "text-purple-900"}`}>
                              {t.display_name}
                            </p>
                            {t.description && (
                              <p className="text-[10px] text-purple-600/80 mt-0.5 leading-tight line-clamp-2">
                                {t.description}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(t.supplement_protocol as Array<unknown> | undefined)?.length ? (
                                <span className="text-[9px] bg-purple-100 rounded px-1 py-0.5">
                                  💊 {(t.supplement_protocol as Array<unknown>).length} supps
                                </span>
                              ) : null}
                              {t.source_plan && (
                                <span className="text-[9px] bg-purple-100/60 rounded px-1 py-0.5 truncate max-w-[90px] text-purple-700">
                                  from {t.source_plan}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {brief.protocol_template_id?.startsWith("custom:") && (() => {
                  const ct = customTemplates.find((t) => `custom:${t.slug}` === brief.protocol_template_id);
                  if (!ct) return null;
                  return (
                    <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2.5 space-y-1">
                      <p className="text-xs font-medium text-purple-800">{ct.icon} {ct.display_name} — will be merged into draft</p>
                      {ct.description && <p className="text-[11px] text-purple-700">{ct.description}</p>}
                      {ct.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {ct.tags.map((tag) => (
                            <span key={tag} className="text-[9px] bg-purple-100 border border-purple-200 rounded px-1.5 py-0.5 text-purple-700">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <hr className="border-muted my-2" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Built-in templates</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
              {PROTOCOL_TEMPLATES.map((t) => {
                const isSelected = brief.protocol_template_id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...brief,
                        protocol_template_id: isSelected ? undefined : t.id,
                      })
                    }
                    className={`rounded-lg border p-2.5 text-left text-xs transition-all ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-50 shadow-sm ring-1 ring-indigo-300"
                        : "border-input bg-background hover:bg-muted/40 hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="text-base leading-none shrink-0 mt-0.5">{t.icon}</span>
                      <div className="min-w-0">
                        <p className={`font-medium leading-tight truncate ${isSelected ? "text-indigo-800" : ""}`}>
                          {t.display_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">
                          {t.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5">
                            💊 {t.supplements.length} supps
                          </span>
                          {(t.lab_orders?.length ?? 0) > 0 && (
                            <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5">
                              🧪 {t.lab_orders!.length} labs
                            </span>
                          )}
                          {t.nutrition_pattern && (
                            <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-[80px]">
                              🥗 {t.nutrition_pattern}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Selected template detail */}
            {selectedTemplate && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2.5 space-y-1.5">
                <p className="text-xs font-medium text-indigo-800">
                  {selectedTemplate.icon} {selectedTemplate.display_name} — will be merged into draft
                </p>
                <p className="text-[11px] text-indigo-700">{selectedTemplate.description}</p>
                <div className="flex flex-wrap gap-1">
                  {selectedTemplate.supplements.slice(0, 6).map((s) => (
                    <span key={s.supplement_slug} className="text-[10px] bg-white/70 border border-indigo-200 rounded px-1.5 py-0.5">
                      {s.display_name}
                    </span>
                  ))}
                  {selectedTemplate.supplements.length > 6 && (
                    <span className="text-[10px] text-indigo-600">+{selectedTemplate.supplements.length - 6} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Plan period */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Plan period
            </label>
            <div className="flex gap-2">
              {[6, 8, 12, 16].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onChange({ ...brief, plan_period_weeks: w })}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    brief.plan_period_weeks === w
                      ? "border-indigo-500 bg-indigo-100 text-indigo-800 font-medium"
                      : "border-input bg-background hover:bg-muted/50"
                  }`}
                >
                  {w} weeks
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange({ ...brief, plan_period_weeks: undefined })}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  !brief.plan_period_weeks
                    ? "border-indigo-500 bg-indigo-100 text-indigo-800 font-medium"
                    : "border-input bg-background hover:bg-muted/50"
                }`}
              >
                Default (8w)
              </button>
            </div>
          </div>

          {/* Root cause hypothesis — pre-filled from synthesis_notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Root cause hypothesis
              <span className="ml-1 font-normal normal-case">
                (pre-filled from AI analysis — edit or clear)
              </span>
            </label>
            <textarea
              value={brief.root_cause_hypothesis ?? ""}
              onChange={(e) =>
                onChange({ ...brief, root_cause_hypothesis: e.target.value || undefined })
              }
              placeholder={synthesisNotes?.slice(0, 200) ?? "e.g. Primary driver is HPA axis dysregulation secondary to gut permeability…"}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            />
          </div>

          {/* Coaching notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Coaching notes for this plan
            </label>
            <textarea
              value={brief.coaching_notes ?? ""}
              onChange={(e) =>
                onChange({ ...brief, coaching_notes: e.target.value || undefined })
              }
              placeholder="e.g. Client is vegetarian Jain — avoid root veg. Very stressed — keep supplement count low to start. Soak methi seeds overnight."
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function AssessClient({ clients = [], symptoms, topics, initialClientId, initialSessions = [], fixedClientId, existingFiles = [], clientSex, priorSnapshots = [] }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState<string>(
    fixedClientId ?? initialClientId ?? clients[0]?.client_id ?? ""
  );
  const [sessionDate, setSessionDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<SubgraphReadiness | null>(null);
  const [readinessPending, setReadinessPending] = useState(false);
  const [complaints, setComplaints] = useState("");
  const [uploads, setUploads] = useState<UploadedRef[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [planBrief, setPlanBrief] = useState<PlanBrief>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draftPending, startDraft] = useTransition();
  const [uploadPending, startUpload] = useTransition();

  // Elapsed-time tracker for the long-running Analyze call (1–5 min). Drives a
  // progress bar + phase label so the coach knows the request is still alive.
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null);
  const [analyzeElapsedMs, setAnalyzeElapsedMs] = useState(0);
  useEffect(() => {
    if (!pending || analyzeStartedAt === null) return;
    const id = window.setInterval(() => {
      setAnalyzeElapsedMs(Date.now() - analyzeStartedAt);
    }, 500);
    return () => window.clearInterval(id);
  }, [pending, analyzeStartedAt]);

  // Five Pillars snapshot (only used when embedded in a client page via fixedClientId)
  const [sessionFivePillars, setSessionFivePillars] = useState<FivePillarsData>({});

  // Transcript extraction state
  const [transcriptExtractPending, startTranscriptExtract] = useTransition();
  const [transcriptSlugs, setTranscriptSlugs] = useState<Set<string>>(new Set());
  const [transcriptMentions, setTranscriptMentions] = useState<Array<{ slug: string; quote: string }>>([]);
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null);
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [healthDataSource, setHealthDataSource] = useState<string>("");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptHealthData, setTranscriptHealthData] = useState<ExtractedHealthData | null>(null);
  const [applyDataPending, startApplyData] = useTransition();
  // Manual text entry state
  const [manualText, setManualText] = useState("");
  const [manualParsePending, startManualParse] = useTransition();
  const [showManualEntry, setShowManualEntry] = useState(false);
  // Editable health data (merged from transcript + manual entry).
  // Seeded from prior snapshots so the coach starts with the latest known
  // labs / measurements / meds / conditions instead of a blank form.
  const initialHealthDataFromSnapshots = useMemo(() => {
    if (!priorSnapshots.length) return null;
    // Merge oldest → newest so most-recent values win on conflicts.
    const sorted = [...priorSnapshots].sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "")
    );
    let merged: ExtractedHealthData | null = null;
    for (const snap of sorted) {
      const m: ExtractedMeasurements = {
        height_cm: snap.measurements?.height_cm ?? null,
        weight_kg: snap.measurements?.weight_kg ?? null,
        bp_systolic: snap.measurements?.bp_systolic ?? null,
        bp_diastolic: snap.measurements?.bp_diastolic ?? null,
        hr_bpm: snap.measurements?.hr_bpm ?? null,
        waist_cm: snap.measurements?.waist_cm ?? null,
        hip_cm: snap.measurements?.hip_cm ?? null,
      };
      const next: ExtractedHealthData = {
        lab_values: snap.lab_values ?? [],
        measurements: m,
        medications: snap.medications ?? [],
        conditions: snap.conditions ?? [],
      };
      merged = mergeHealthData(merged, next);
    }
    return merged;
  }, [priorSnapshots]);
  const [editableHealthData, setEditableHealthData] = useState<ExtractedHealthData | null>(initialHealthDataFromSnapshots);
  /** Source filenames whose data is already represented in a prior snapshot.
   *  Used to skip the (slow + paid) re-extraction step when the coach
   *  re-attaches a previously-uploaded file. */
  const alreadyExtracted = useMemo(
    () => new Set(priorSnapshots.map((s) => s.source).filter(Boolean) as string[]),
    [priorSnapshots],
  );
  // Pre-analyse FM ratios computed from editableHealthData.lab_values
  const [previewRatios, setPreviewRatios] = useState<ComputedRatio[]>([]);
  const [ratiosPending, startRatiosCompute] = useTransition();

  // Prior sessions — seeded from RSC for the initial client, refreshed client-side on change
  const [priorSessions, setPriorSessions] = useState<SessionSummary[]>(initialSessions);
  useEffect(() => {
    // Don't re-fetch on first render (initialSessions already covers it)
    if (!clientId) { setPriorSessions([]); return; }
    loadClientSessionsAction(clientId)
      .then(setPriorSessions)
      .catch(() => setPriorSessions([]));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced subgraph readiness peek — refreshes as coach picks symptoms /
  // conditions, so they see what the AI will have to work with BEFORE
  // clicking Analyze. No API cost.
  useEffect(() => {
    const both = selectedSymptoms.length + selectedTopics.length;
    if (both === 0) { setReadiness(null); return; }
    let cancelled = false;
    setReadinessPending(true);
    const t = setTimeout(() => {
      peekSubgraphAction(selectedSymptoms, selectedTopics).then((r) => {
        if (!cancelled) { setReadiness(r); setReadinessPending(false); }
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setReadinessPending(false); };
  }, [selectedSymptoms.join(","), selectedTopics.join(",")]);  // eslint-disable-line

  // Auto-compute FM ratios whenever lab values change
  const labValuesKey = editableHealthData?.lab_values?.map(l => `${l.test_name}:${l.value}`).join("|") ?? "";
  useEffect(() => {
    const labs = editableHealthData?.lab_values ?? [];
    if (!labs.length) { setPreviewRatios([]); return; }
    let cancelled = false;
    startRatiosCompute(async () => {
      const res = await computeRatiosAction({ lab_values: labs });
      if (!cancelled && res.ok) setPreviewRatios(res.ratios as ComputedRatio[]);
    });
    return () => { cancelled = true; };
  }, [labValuesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared handler for both file and URL transcript results
  const applyTranscriptResult = (res: Awaited<ReturnType<typeof extractTranscriptAction>>, sourceName?: string) => {
    if (!res.ok) {
      setTranscriptError(res.error ?? "Extraction failed");
      toast.error(res.error ?? "Transcript extraction failed");
      return;
    }
    const found = res.matched_slugs ?? [];
    setTranscriptSlugs(new Set(found));
    setTranscriptMentions(res.mentions ?? []);
    const hd = res.extracted_data ?? null;
    setTranscriptHealthData(hd);
    if (hd) {
      setEditableHealthData(prev => mergeHealthData(prev, hd));
      if (sourceName) setHealthDataSource(sourceName);
    }
    setSelectedSymptoms((prev) => {
      const merged = new Set([...prev, ...found]);
      return Array.from(merged);
    });
    const parts: string[] = [];
    if (found.length) parts.push(`${found.length} symptom${found.length !== 1 ? "s" : ""}`);
    const d = res.extracted_data;
    if (d?.lab_values?.length) parts.push(`${d.lab_values.length} lab value${d.lab_values.length !== 1 ? "s" : ""}`);
    if (d?.medications?.length) parts.push(`${d.medications.length} medication${d.medications.length !== 1 ? "s" : ""}`);
    if (d?.conditions?.length) parts.push(`${d.conditions.length} condition${d.conditions.length !== 1 ? "s" : ""}`);
    const hasMeas = d?.measurements && Object.values(d.measurements).some(v => v != null);
    if (hasMeas) parts.push("measurements");
    toast.success(`Extracted from transcript: ${parts.join(", ") || "nothing found"}`);
  };

  const handleTranscriptUpload = (files: FileList | null) => {
    if (!files || files.length === 0 || !clientId) return;
    const file = files[0];
    const mime = file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain");
    const cid = clientId;
    setTranscriptError(null);
    setTranscriptFilename(file.name);
    setTranscriptUrl("");
    startTranscriptExtract(async () => {
      try {
        // Upload via fetch/FormData (no binary through Server Action)
        const savedPath = await uploadViaApi(file, cid);
        const catalogue = symptoms.map((s) => ({
          slug: s.slug,
          label: s.label,
          aliases: s.aliases,
        }));

        // Run BOTH extractions in parallel against the same uploaded file:
        //   1. extractTranscriptAction → symptoms + lab values + meds + conditions
        //   2. parseTranscriptForClientByPath → 30+ FM intake fields, five pillars,
        //      timeline events, presenting complaints
        const [symRes, profileRes] = await Promise.all([
          extractTranscriptAction(savedPath, mime, catalogue, dryRun),
          dryRun
            ? Promise.resolve({ ok: false as const, error: "skipped (dry run)" })
            : parseTranscriptForClientByPath(savedPath, mime),
        ]);

        // Apply symptoms + structured health data (existing flow)
        applyTranscriptResult(symRes, `transcript-${file.name}`);

        // Apply intake-form pre-fills + persist client profile updates
        if (profileRes.ok && profileRes.data) {
          const d = profileRes.data;

          // Pre-fill the chief complaints textarea (don't clobber existing typed text)
          if (d.presenting_complaints) {
            setComplaints((prev) => prev.trim() ? prev : d.presenting_complaints!);
          }

          // Pre-fill Five Pillars where the AI found values; preserve any
          // values the coach already entered.
          if (d.five_pillars) {
            const fp = d.five_pillars;
            setSessionFivePillars((prev) => ({
              sleep_hours: prev.sleep_hours ?? fp.sleep_hours,
              sleep_quality: prev.sleep_quality ?? fp.sleep_quality,
              stress_level: prev.stress_level ?? fp.stress_level,
              movement_days_per_week: prev.movement_days_per_week ?? fp.movement_days_per_week,
              nutrition_quality: prev.nutrition_quality ?? fp.nutrition_quality,
              connection_quality: prev.connection_quality ?? fp.connection_quality,
            }));
          }

          // Persist the wider profile fields (timeline events, family history,
          // sleep/digestion notes, dietary preference, what worked/didn't, etc.)
          // back to client.yaml. Fire-and-forget — coach doesn't block on this.
          updateClientFromTranscriptAction(cid, d).then((upd) => {
            const summary: string[] = [];
            if (d.presenting_complaints) summary.push("complaints");
            if (d.five_pillars) summary.push("five pillars");
            if (d.timeline_events?.length) summary.push(`${d.timeline_events.length} timeline events`);
            if (upd.ok && upd.updated_fields?.length) {
              summary.push(`${upd.updated_fields.length} profile fields`);
            }
            if (summary.length) {
              toast.success(`📝 Auto-filled from transcript: ${summary.join(", ")}`);
            }
          }).catch(() => {
            // Profile update is non-blocking; symptoms + complaints already applied
          });
        } else if (profileRes.ok === false && profileRes.error && !dryRun) {
          // Don't toast — symptom extraction may still have succeeded; this is
          // a secondary enrichment and silent failure here is fine.
          console.warn("[transcript] profile extraction failed:", profileRes.error);
        }
      } catch (e) {
        const msg = (e as Error).message;
        setTranscriptError(msg);
        toast.error(msg);
      }
    });
  };

  const handleTranscriptUrl = () => {
    const url = transcriptUrl.trim();
    if (!url) return;
    setTranscriptError(null);
    setTranscriptFilename(null);
    startTranscriptExtract(async () => {
      try {
        const catalogue = symptoms.map((s) => ({
          slug: s.slug,
          label: s.label,
          aliases: s.aliases,
        }));
        const res = await extractTranscriptUrlAction(url, catalogue, dryRun);
        applyTranscriptResult(res, `transcript-${url}`);
      } catch (e) {
        const msg = (e as Error).message;
        setTranscriptError(msg);
        toast.error(msg);
      }
    });
  };

  // Track which lab files are currently being extracted (by filename)
  const [extractingLabFiles, setExtractingLabFiles] = useState<Set<string>>(new Set());
  const [pendingLabFiles, setPendingLabFiles] = useState<FileList | null>(null);

  /** Upload a file via the API route (FormData/fetch — no binary through Server Actions). */
  async function uploadViaApi(file: File, cid: string): Promise<string> {
    const fd = new FormData();
    fd.append("clientId", cid);
    fd.append("file", file);
    const res = await fetch("/api/upload-client-file", { method: "POST", body: fd });
    const json = await res.json() as { ok: boolean; filePath?: string; error?: string };
    if (!json.ok || !json.filePath) throw new Error(json.error ?? "Upload failed");
    return json.filePath;
  }

  /**
   * Attach a file that already lives in the client's files/ dir without
   * re-uploading it. Resolves the absolute path on the server, adds it to
   * `uploads`, and runs lab extraction (same flow as a fresh upload).
   *
   * If the filename is already represented in a prior health snapshot AND
   * the caller didn't pass `force: true`, the extraction is skipped — the
   * snapshot data is already loaded into editableHealthData on mount.
   */
  const attachExistingFile = (
    filename: string,
    kind: "lab_report" | "food_journal",
    opts: { force?: boolean } = {},
  ) => {
    if (!clientId) return;
    if (uploads.some((u) => u.filename === filename && u.kind === kind)) {
      toast.info(`${filename}: already attached`);
      return;
    }
    const cid = clientId;
    const skipExtract = !opts.force && kind === "lab_report" && alreadyExtracted.has(filename);
    startUpload(async () => {
      const res = await resolveClientFileAction(cid, filename);
      if (!res.ok) {
        toast.error(`${filename}: ${res.error}`);
        return;
      }
      setUploads((u) => {
        if (u.some((x) => x.filename === filename && x.kind === kind)) return u;
        return [...u, { filePath: res.filePath, filename, mime_type: res.mimeType, kind }];
      });
      if (skipExtract) {
        toast.success(`${filename}: attached (using prior extraction — click Re-extract to refresh)`);
        return;
      }
      if (kind === "lab_report") {
        setExtractingLabFiles((prev) => new Set([...prev, filename]));
        try {
          const catalogue = symptoms.map((s) => ({ slug: s.slug, label: s.label, aliases: s.aliases }));
          const ex = await extractTranscriptAction(res.filePath, res.mimeType, catalogue, dryRun);
          if (ex.ok) {
            const hd = ex.extracted_data ?? null;
            if (hd) {
              setEditableHealthData((prev) => mergeHealthData(prev, hd));
              setHealthDataSource(`lab-${filename}`);
            }
            if (ex.matched_slugs?.length) {
              setSelectedSymptoms((prev) => Array.from(new Set([...prev, ...ex.matched_slugs])));
            }
            const parts: string[] = [];
            if (hd?.lab_values?.length) parts.push(`${hd.lab_values.length} lab values`);
            if (hd?.medications?.length) parts.push(`${hd.medications.length} meds`);
            if (hd?.conditions?.length) parts.push(`${hd.conditions.length} conditions`);
            if (ex.matched_slugs?.length) parts.push(`${ex.matched_slugs.length} symptoms`);
            toast.success(parts.length ? `${filename}: extracted ${parts.join(", ")}` : `${filename}: attached`);
          } else {
            toast.error(`${filename}: ${ex.error ?? "Extraction failed"}`);
          }
        } catch (e) {
          toast.error(`${filename}: extraction failed — ${(e as Error).message}`);
        } finally {
          setExtractingLabFiles((prev) => { const n = new Set(prev); n.delete(filename); return n; });
        }
      } else {
        toast.success(`${filename}: attached`);
      }
    });
  };

  const handleUpload = (
    files: FileList | null,
    kind: "lab_report" | "food_journal"
  ) => {
    if (!files || files.length === 0 || !clientId) return;
    const list = Array.from(files);
    const cid = clientId; // capture for async closure

    startUpload(async () => {
      for (const file of list) {
        const mime = file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain");

        // Step 1: upload via fetch/FormData (never passes binary through Server Action)
        let savedPath: string;
        try {
          savedPath = await uploadViaApi(file, cid);
        } catch (e) {
          toast.error(`${file.name}: upload failed — ${(e as Error).message}`);
          continue;
        }
        // Guard: skip if this filename is already in the uploads list (prevents duplicates on retry)
        setUploads((u) => {
          if (u.some(x => x.filename === file.name && x.kind === kind)) return u;
          return [...u, { filePath: savedPath, filename: file.name, mime_type: mime, kind }];
        });

        // Step 2: for lab reports, extract using the saved path (string only — no binary)
        if (kind === "lab_report") {
          setExtractingLabFiles(prev => new Set([...prev, file.name]));
          try {
            const catalogue = symptoms.map((s) => ({ slug: s.slug, label: s.label, aliases: s.aliases }));
            const res = await extractTranscriptAction(savedPath, mime, catalogue, dryRun);
            if (res.ok) {
              const hd = res.extracted_data ?? null;
              if (hd) {
                setEditableHealthData(prev => mergeHealthData(prev, hd));
                setHealthDataSource(`lab-${file.name}`);
              }
              if (res.matched_slugs?.length) {
                setSelectedSymptoms(prev => Array.from(new Set([...prev, ...res.matched_slugs])));
              }
              const parts: string[] = [];
              if (hd?.lab_values?.length) parts.push(`${hd.lab_values.length} lab value${hd.lab_values.length !== 1 ? "s" : ""}`);
              if (hd?.medications?.length) parts.push(`${hd.medications.length} medication${hd.medications.length !== 1 ? "s" : ""}`);
              if (hd?.conditions?.length) parts.push(`${hd.conditions.length} condition${hd.conditions.length !== 1 ? "s" : ""}`);
              const hasMeas = hd?.measurements && Object.values(hd.measurements).some(v => v != null);
              if (hasMeas) parts.push("measurements");
              if (res.matched_slugs?.length) parts.push(`${res.matched_slugs.length} symptom${res.matched_slugs.length !== 1 ? "s" : ""}`);
              toast.success(parts.length ? `${file.name}: extracted ${parts.join(", ")}` : `${file.name}: saved (no structured data found)`);
            } else {
              toast.error(`${file.name}: ${res.error ?? "Extraction failed"}`);
            }
          } catch (e) {
            toast.error(`${file.name}: extraction failed — ${(e as Error).message}`);
          } finally {
            setExtractingLabFiles(prev => { const n = new Set(prev); n.delete(file.name); return n; });
          }
        }
      }
    });
  };

  const onAnalyze = () => {
    setError(null);
    if (!clientId) {
      setError("Pick a client first");
      return;
    }
    if (
      selectedSymptoms.length === 0 &&
      selectedTopics.length === 0 &&
      uploads.length === 0 &&
      !complaints.trim()
    ) {
      setError("Pick at least one symptom or condition, upload a file, or enter complaints");
      return;
    }
    setAnalyzeStartedAt(Date.now());
    setAnalyzeElapsedMs(0);
    startTransition(async () => {
      try {
        const hasFivePillars = Object.values(sessionFivePillars).some((v) => v != null);
        const res = await runAssessAction({
          client_id: clientId,
          symptoms: selectedSymptoms,
          topics: selectedTopics,
          complaints,
          attachments: uploads.map((u) => ({
            path: u.filePath,
            mime_type: u.mime_type,
            kind: u.kind,
          })),
          dry_run: dryRun,
          session_date: sessionDate,
          five_pillars: hasFivePillars ? sessionFivePillars : undefined,
        });
        if (!res.ok) {
          const msg = res.error || "Analyze failed";
          setError(msg);
          toast.error(msg);
          setResult(null);
        } else {
          setResult(res);
          setPicks({});
          // Pre-fill root cause hypothesis from AI synthesis notes
          if (res.suggestions?.synthesis_notes) {
            setPlanBrief((prev) => ({
              ...prev,
              root_cause_hypothesis: prev.root_cause_hypothesis || res.suggestions!.synthesis_notes.slice(0, 500),
            }));
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const onGenerateDraft = () => {
    if (!result?.session_id || !clientId) return;
    setError(null);
    startDraft(async () => {
      try {
        const res = await generateDraftAction({
          client_id: clientId,
          session_id: result.session_id!,
          picks,
          plan_brief: Object.keys(planBrief).some((k) => !!(planBrief as Record<string, unknown>)[k])
            ? planBrief
            : undefined,
        });
        if (!res.ok) {
          const msg = res.error || "Draft generation failed";
          setError(msg);
          toast.error(msg);
        } else if (res.slug) {
          toast.success(`Draft plan created at ${res.slug}`);
          router.push(`/plans/${res.slug}`);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const selectedClient = clients.find((c) => c.client_id === clientId);

  // Step numbering: shifts down by 1 in embedded mode (no client picker card)
  const stepNum = (n: number) => fixedClientId ? `${n - 1}.` : `${n}.`;

  return (
    <div className="space-y-6">
      {/* Session date — always visible; defaults to today */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
        <span className="text-sm font-medium shrink-0">📅 Session date</span>
        <input
          type="date"
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          max={new Date().toISOString().slice(0, 10)}
        />
        <span className="text-xs text-muted-foreground">
          {sessionDate === new Date().toISOString().slice(0, 10) ? "Today" : "Past session"}
        </span>
      </div>

      {/* Step 1: client — hidden in embedded mode (fixedClientId is set by the parent) */}
      {!fixedClientId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Client</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No clients yet. Create one from the Clients page first.
              </p>
            ) : (
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {clients.map((c) => {
                  // Compute age from DOB if available, fall back to age_band
                  const ageLabel = (() => {
                    const dob = (c as { date_of_birth?: string }).date_of_birth;
                    if (dob) {
                      const d = new Date(dob);
                      const now = new Date();
                      let age = now.getFullYear() - d.getFullYear();
                      const mm = now.getMonth() - d.getMonth();
                      if (mm < 0 || (mm === 0 && now.getDate() < d.getDate())) age--;
                      return `${age} yrs`;
                    }
                    return c.age_band ?? "";
                  })();
                  const displayName = (c as { display_name?: string }).display_name;
                  return (
                    <option key={c.client_id} value={c.client_id}>
                      {displayName ? `${displayName} (${c.client_id})` : c.client_id}
                      {ageLabel ? ` — ${ageLabel}` : ""}
                      {c.sex ? ` · ${c.sex}` : ""}
                    </option>
                  );
                })}
              </select>
            )}
            {selectedClient && (
              <div className="space-y-0.5">
                {(selectedClient as { display_name?: string }).display_name && (
                  <p className="text-base font-bold text-foreground">
                    {(selectedClient as { display_name?: string }).display_name}
                  </p>
                )}
                <div className="text-xs text-muted-foreground">
                  {selectedClient.active_conditions?.length
                    ? `Conditions: ${selectedClient.active_conditions.join(", ")}`
                    : "No active conditions on file"}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Prior sessions for this client */}
      {priorSessions.length > 0 && (
        <Card className="border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">🕰 Prior sessions ({priorSessions.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorSessions.map((s, i) => {
              const planDeleted = !!s.generated_plan_slug && !s.plan_exists;
              return (
                <details key={i} className="rounded border bg-background/70">
                  <summary className="cursor-pointer flex items-center gap-3 px-3 py-2 text-sm select-none">
                    <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">{s.date ?? "—"}</span>
                    <span className="flex-1 text-xs truncate text-muted-foreground">
                      {(s.selected_symptoms?.length ?? 0) > 0 ? `${s.selected_symptoms!.length} symptoms` : "—"}
                      {(s.selected_topics?.length ?? 0) > 0 ? ` · ${s.selected_topics!.length} conditions` : ""}
                      {s.driver_count > 0 ? ` · ${s.driver_count} drivers` : ""}
                      {s.supplement_count > 0 ? ` · ${s.supplement_count} supplements` : ""}
                    </span>
                    {planDeleted ? (
                      <span className="text-[10px] text-amber-600 font-medium shrink-0">⚠️ Plan deleted</span>
                    ) : s.generated_plan_slug ? (
                      <a
                        href={`/plans/${s.generated_plan_slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-blue-600 underline shrink-0"
                      >
                        → plan
                      </a>
                    ) : null}
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-2 text-xs border-t">
                    {s.presenting_complaints && (
                      <p className="text-muted-foreground italic">{s.presenting_complaints}</p>
                    )}
                    {(s.selected_symptoms?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.selected_symptoms!.map((slug) => (
                          <span key={slug} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{slug}</span>
                        ))}
                      </div>
                    )}
                    {(s.selected_topics?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.selected_topics!.map((slug) => (
                          <span key={slug} className="rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-0.5 text-[10px]">{slug}</span>
                        ))}
                      </div>
                    )}
                    {s.synthesis_notes && (
                      <p className="text-muted-foreground border-l-2 border-muted pl-2">{s.synthesis_notes}{s.synthesis_notes.length >= 400 ? "…" : ""}</p>
                    )}
                    {planDeleted && s.session_id ? (
                      <div className="rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 p-2 space-y-1.5">
                        <p className="text-amber-700 dark:text-amber-400 font-medium">
                          The plan generated from this session was deleted.
                        </p>
                        <p className="text-amber-600 dark:text-amber-500">
                          You can regenerate a new draft plan using the AI analysis already stored for this session — no new AI call needed.
                        </p>
                        <RegeneratePlanButton
                          clientId={clientId}
                          sessionId={s.session_id}
                          onDone={(slug) => {
                            toast.success(`Draft plan created: ${slug}`);
                            router.push(`/plans/${slug}`);
                          }}
                          onError={(err) => toast.error(`Failed to regenerate plan: ${err}`)}
                        />
                      </div>
                    ) : s.generated_plan_slug ? (
                      <a href={`/plans/${s.generated_plan_slug}`} className="text-blue-600 underline">
                        Open plan → {s.generated_plan_slug}
                      </a>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Step 2: all uploads */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stepNum(2)} Uploads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* ── Consultation transcript ── */}
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">📞 Consultation transcript</p>
              {(transcriptFilename || transcriptUrl || transcriptSlugs.size > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setTranscriptSlugs(new Set());
                    setTranscriptMentions([]);
                    setTranscriptFilename(null);
                    setTranscriptUrl("");
                    setTranscriptError(null);
                    setTranscriptHealthData(null);
                    setEditableHealthData(null);
                  }}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  clear
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Upload a file <em>or</em> paste a link — symptoms, labs, meds and conditions auto-detected.
            </p>

            {/* File upload */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Upload file (.txt, .pdf)
              </label>
              <div className="flex gap-2 items-start">
                <input
                  type="file"
                  accept=".txt,.pdf,.md,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setTranscriptFilename(f.name);
                      setTranscriptUrl("");
                      setTranscriptSlugs(new Set());
                      setTranscriptMentions([]);
                      setTranscriptError(null);
                    }
                  }}
                  disabled={transcriptExtractPending}
                  className="flex-1 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-input file:bg-background file:text-xs file:font-medium"
                  id="assess-transcript-file"
                />
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById("assess-transcript-file") as HTMLInputElement;
                    handleTranscriptUpload(input?.files ?? null);
                  }}
                  disabled={transcriptExtractPending || !transcriptFilename}
                  className="text-xs px-3 py-1.5 rounded border border-input bg-background hover:bg-muted disabled:opacity-50 whitespace-nowrap"
                >
                  Extract
                </button>
              </div>
              {transcriptFilename && (
                <p className="text-[11px] text-muted-foreground">📄 {transcriptFilename}</p>
              )}
            </div>

            {/* OR divider */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex-1 border-t" />
              <span className="font-medium">OR</span>
              <div className="flex-1 border-t" />
            </div>

            {/* URL input */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Paste a link (Google Doc, any URL)
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={transcriptUrl}
                  onChange={(e) => {
                    setTranscriptUrl(e.target.value);
                    if (e.target.value) setTranscriptFilename(null);
                  }}
                  placeholder="https://docs.google.com/document/d/…"
                  disabled={transcriptExtractPending}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleTranscriptUrl}
                  disabled={transcriptExtractPending || !transcriptUrl.trim()}
                  className="text-xs px-3 py-1.5 rounded border border-input bg-background hover:bg-muted disabled:opacity-50 whitespace-nowrap"
                >
                  Extract
                </button>
              </div>
            </div>

            {transcriptExtractPending && (
              <p className="text-xs text-muted-foreground animate-pulse">🔍 Analysing transcript…</p>
            )}
            {transcriptError && (
              <p className="text-xs text-red-600">⚠ {transcriptError}</p>
            )}
            {transcriptSlugs.size > 0 && !transcriptExtractPending && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-emerald-700">
                  ✓ {transcriptSlugs.size} symptom{transcriptSlugs.size !== 1 ? "s" : ""} detected — pre-selected below
                </p>
                {transcriptMentions.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:underline">Show symptom evidence</summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {transcriptMentions.map((m, i) => (
                        <li key={i}><span className="font-mono text-[10px]">{m.slug}</span>: &ldquo;{m.quote}&rdquo;</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* ── Lab reports ── */}
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
            <p className="text-sm font-medium">🧪 Lab reports
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(PDF, image, text)</span>
            </p>
            <div className="flex items-center gap-2">
              <input
                id="assess-lab-file"
                type="file"
                multiple
                accept=".pdf,image/*,.txt,.md"
                onChange={(e) => {
                  setPendingLabFiles(e.target.files && e.target.files.length > 0 ? e.target.files : null);
                }}
                className="block flex-1 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-input file:bg-background file:text-xs file:font-medium"
                disabled={uploadPending}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploadPending || !pendingLabFiles}
                onClick={() => {
                  const input = document.getElementById("assess-lab-file") as HTMLInputElement;
                  handleUpload(input?.files ?? pendingLabFiles, "lab_report");
                  setPendingLabFiles(null);
                }}
              >
                {uploadPending ? "Extracting…" : "Extract"}
              </Button>
            </div>
            {pendingLabFiles && !uploadPending && (
              <p className="text-xs text-muted-foreground">
                {pendingLabFiles.length} file{pendingLabFiles.length !== 1 ? "s" : ""} selected — click Extract to upload &amp; extract
              </p>
            )}

            {/* ── Existing files for this client ── */}
            {fixedClientId && existingFiles.length > 0 && (() => {
              const fileExts = /\.(pdf|png|jpe?g|webp|txt|md)$/i;
              const labLike = existingFiles.filter((f) => fileExts.test(f)).sort();
              if (labLike.length === 0) return null;
              return (
                <details className="mt-2 rounded-md border bg-background/50">
                  <summary className="cursor-pointer text-xs px-2 py-1.5 font-medium text-muted-foreground hover:text-foreground select-none">
                    📁 Use a file already on this client ({labLike.length} available)
                  </summary>
                  <div className="px-2 pb-2 pt-1 space-y-1">
                    <p className="text-[11px] text-muted-foreground">
                      Skip re-upload — attach a file from a previous discovery / intake / lab upload.
                      {alreadyExtracted.size > 0 && (
                        <>
                          {" "}Files marked <span className="font-semibold text-emerald-700">✓ prior</span> already
                          have their values loaded; click <span className="font-semibold">♻️ Re-extract</span> only if you
                          want to refresh from the original PDF.
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {labLike.map((f) => {
                        const isAttached = uploads.some((u) => u.filename === f);
                        const isExtractingThis = extractingLabFiles.has(f);
                        const isPriorExtracted = alreadyExtracted.has(f);
                        return (
                          <span key={f} className="inline-flex">
                            <button
                              type="button"
                              onClick={() => attachExistingFile(f, "lab_report")}
                              disabled={uploadPending || isAttached}
                              className={[
                                "text-[11px] px-2 py-1 border transition-colors",
                                isPriorExtracted ? "rounded-l" : "rounded",
                                isAttached
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 cursor-default"
                                  : isPriorExtracted
                                    ? "bg-emerald-50/60 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                    : "bg-background border-input hover:bg-muted hover:border-foreground/30",
                                "disabled:opacity-60",
                              ].join(" ")}
                              title={
                                isAttached
                                  ? "Already attached"
                                  : isPriorExtracted
                                    ? `Attach ${f} (using prior extracted values — no API call)`
                                    : `Attach ${f} and extract lab values`
                              }
                            >
                              {isAttached ? "✓ " : isPriorExtracted ? "✓ prior · " : "📎 "}
                              {f}
                              {isExtractingThis && (
                                <span className="ml-1 inline-block w-2 h-2 border border-amber-500 border-t-transparent rounded-full animate-spin align-middle" />
                              )}
                            </button>
                            {isPriorExtracted && !isAttached && (
                              <button
                                type="button"
                                onClick={() => attachExistingFile(f, "lab_report", { force: true })}
                                disabled={uploadPending}
                                className="text-[11px] px-1.5 py-1 rounded-r border border-l-0 border-emerald-200 bg-white hover:bg-amber-50 hover:border-amber-300 disabled:opacity-60"
                                title={`Re-run extraction on ${f} (slow + uses API credit)`}
                              >
                                ♻️
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </details>
              );
            })()}
          </div>

          {/* ── Food journals ── */}
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
            <p className="text-sm font-medium">🍽 Food journals
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(PDF, image, text)</span>
            </p>
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.txt,.md"
              onChange={(e) => handleUpload(e.target.files, "food_journal")}
              className="block w-full text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-input file:bg-background file:text-xs file:font-medium"
              disabled={uploadPending}
            />
          </div>

          {/* ── Attached files list ── */}
          {(uploadPending || uploads.length > 0) && (
            <div className="space-y-1 border rounded-md p-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Attached ({uploads.length}){uploadPending ? " — saving…" : ""}
              </p>
              {uploads.map((u, i) => {
                const isExtracting = u.kind === "lab_report" && extractingLabFiles.has(u.filename);
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-[10px]">
                      {u.kind === "lab_report" ? "lab" : "food"}
                    </Badge>
                    <span className="truncate">{u.filename}</span>
                    {isExtracting && (
                      <span className="text-[10px] text-amber-600 flex items-center gap-1 shrink-0">
                        <span className="inline-block w-2.5 h-2.5 border border-amber-500 border-t-transparent rounded-full animate-spin" />
                        extracting…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setUploads(uploads.filter((_, j) => j !== i))}
                      className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Manual health data entry ── */}
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">✏️ Enter health data manually</p>
              <button
                type="button"
                onClick={() => setShowManualEntry(v => !v)}
                className="text-xs text-muted-foreground hover:underline"
              >
                {showManualEntry ? "hide" : "expand"}
              </button>
            </div>
            {!showManualEntry && (
              <p className="text-xs text-muted-foreground">
                Type anything — lab values, weight, BP, medications, diagnoses — AI will organise it.
              </p>
            )}
            {showManualEntry && (
              <div className="space-y-2">
                <textarea
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  placeholder={"Type anything, e.g.:\nweight 68kg, height 163cm\nTSH 4.2 mIU/L, ferritin 12 ng/mL, BP 118/76\nOn levothyroxine 50mcg daily\nDiagnosed Hashimoto's, insulin resistance"}
                  rows={5}
                  className="w-full text-xs rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none font-mono"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={manualParsePending || !manualText.trim()}
                    onClick={() => {
                      startManualParse(async () => {
                        try {
                          const res = await parseHealthTextAction({ text: manualText, dry_run: dryRun });
                          if (!res.ok) { toast.error(res.error ?? "Failed to parse"); return; }
                          const hd = res.extracted_data!;
                          setEditableHealthData(prev => mergeHealthData(prev, hd));
                          toast.success("Parsed — review and save below");
                          setShowManualEntry(false);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      });
                    }}
                    className="text-xs px-3 py-1 rounded border border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {manualParsePending ? "Parsing…" : "✨ Parse with AI"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditableHealthData(prev => prev ?? emptyHealthData()); setShowManualEntry(false); }}
                    className="text-xs px-3 py-1 rounded border border-input text-muted-foreground bg-white hover:bg-muted/50"
                  >
                    Open blank form
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Editable health data form ── */}
          {editableHealthData && (
            <HealthDataEditor
              data={editableHealthData}
              onChange={setEditableHealthData}
              clientId={clientId}
              source={healthDataSource || `manual-${new Date().toISOString().slice(0,10)}`}
            />
          )}

        </CardContent>
      </Card>

      {/* Step 3: symptoms */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stepNum(3)} Symptoms</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryPicker
            options={symptoms}
            value={selectedSymptoms}
            onChange={setSelectedSymptoms}
            placeholder="Search symptoms by name or alias…"
            maxHeight="22rem"
            transcriptSlugs={transcriptSlugs}
            clientSex={clientSex ?? clients.find((c) => c.client_id === clientId)?.sex ?? null}
          />
        </CardContent>
      </Card>

      {/* Step 4: conditions (formerly "topics") */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stepNum(4)} 🩺 Conditions <span className="text-sm font-normal text-muted-foreground">(optional)</span></CardTitle>
        </CardHeader>
        <CardContent>
          <InlinePicker
            options={topics}
            value={selectedTopics}
            onChange={setSelectedTopics}
            placeholder="Type to filter clinical conditions…"
            maxHeight="14rem"
          />
        </CardContent>
      </Card>

      {/* Root cause pathways from mind maps */}
      <MindMapContextPanel
        symptomSlugs={selectedSymptoms}
        topicSlugs={selectedTopics}
        clientSex={clientSex}
      />

      {/* Step 5: complaints */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stepNum(5)} Presenting complaints <span className="text-sm font-normal text-muted-foreground">(optional)</span></CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={complaints}
            onChange={(e) => setComplaints(e.target.value)}
            rows={4}
            placeholder="What did the client describe today? Anything that doesn't fit the symptoms above…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </CardContent>
      </Card>

      {/* Five Pillars snapshot — only in embedded/client-page mode */}
      {fixedClientId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{stepNum(6)} Five Pillars snapshot <span className="text-sm font-normal text-muted-foreground">(optional)</span></CardTitle>
          </CardHeader>
          <CardContent>
            <FivePillarsCapture value={sessionFivePillars} onChange={setSessionFivePillars} />
          </CardContent>
        </Card>
      )}

      {/* Analyze button */}
      <Card>
        <CardContent className="pt-6 space-y-3">

          {/* FM ratio preview above the Analyse button */}
          {ratiosPending && (
            <p className="text-xs text-muted-foreground animate-pulse">📊 Computing FM ratios…</p>
          )}
          {!ratiosPending && previewRatios.length > 0 && (
            <ComputedRatiosCard ratios={previewRatios} />
          )}

          {readiness && readiness.ok && (() => {
            const v = readiness.verdict;
            const palette = v === "empty"
              ? "bg-red-50 border-red-300 text-red-900"
              : v === "thin"
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : v === "moderate"
              ? "bg-blue-50 border-blue-300 text-blue-900"
              : "bg-emerald-50 border-emerald-300 text-emerald-900";
            const emoji = v === "empty" ? "🛑" : v === "thin" ? "⚠️" : v === "moderate" ? "🔎" : "✅";
            const headline = v === "empty"
              ? "Catalogue subgraph empty — AI will have nothing to work with"
              : v === "thin"
              ? "Thin catalogue subgraph — AI may struggle to recommend"
              : v === "moderate"
              ? "Moderate subgraph — should be enough for synthesis"
              : "Rich catalogue context — AI has plenty to work with";
            const c = readiness.counts!;
            return (
              <div className={`rounded-md border-2 px-3 py-2.5 space-y-1.5 text-xs ${palette}`}>
                <div className="font-semibold flex items-center gap-1.5">
                  <span>{emoji}</span>
                  <span>{headline}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] opacity-90">
                  <span>conditions: <strong>{c.topics}</strong></span>
                  <span>root causes: <strong>{c.mechanisms}</strong></span>
                  <span>supplements: <strong>{c.supplements}</strong></span>
                  <span>protocols: <strong>{c.protocols}</strong></span>
                  <span>evidence notes: <strong>{c.claims}</strong></span>
                </div>
                {(readiness.unmatched_symptoms?.length ?? 0) + (readiness.unmatched_topics?.length ?? 0) > 0 && (
                  <div className="text-[10px] opacity-80">
                    Not in catalogue: {[...(readiness.unmatched_symptoms ?? []), ...(readiness.unmatched_topics ?? [])].join(", ")}
                  </div>
                )}
                {(v === "empty" || v === "thin") && (
                  <p className="text-[10px] opacity-90 mt-0.5">
                    Tip: pick a more general condition (e.g. <em>hypothyroidism</em>) or related symptoms (<em>fatigue</em>, <em>brain-fog</em>) to broaden the subgraph. You can also analyse anyway — the AI will work with whatever's there.
                  </p>
                )}
              </div>
            );
          })()}
          {readinessPending && (
            <p className="text-[10px] text-muted-foreground">Checking catalogue coverage…</p>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry run (skip Anthropic — uses synthetic suggestion, $0)
          </label>
          {uploadPending && extractingLabFiles.size > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>
                Extracting lab data from {[...extractingLabFiles].join(", ")}
                … please wait before analysing.
              </span>
            </div>
          )}
          {pending && (() => {
            // Estimate ~120s typical, ~300s p95 — show progress as a fraction
            // of the typical estimate, capped at 95% so it doesn't pretend to
            // be done. Phase label changes as time elapses so the coach knows
            // the request is still alive even when the API call hasn't returned.
            const elapsedSec = Math.floor(analyzeElapsedMs / 1000);
            const mins = Math.floor(elapsedSec / 60);
            const secs = elapsedSec % 60;
            const elapsedStr = `${mins}:${secs.toString().padStart(2, "0")}`;
            const pct = Math.min(95, Math.round((analyzeElapsedMs / 120_000) * 100));
            const phase =
              elapsedSec < 8  ? "Uploading inputs"
              : elapsedSec < 20 ? "Building catalogue subgraph"
              : elapsedSec < 60 ? "Calling AI — Sonnet, 16K-token output"
              : elapsedSec < 180 ? "Still working — long synthesis, please wait"
              : "Taking unusually long — check PM2 logs if it doesn't return soon";
            return (
              <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="font-medium text-indigo-900">{phase}…</span>
                  <span className="ml-auto font-mono tabular-nums text-indigo-800">{elapsedStr}</span>
                </div>
                <div className="h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-indigo-700/80">
                  Typical: 60–120s · p95: 5min · Don&apos;t reload the page.
                </p>
              </div>
            );
          })()}
          <Button
            onClick={onAnalyze}
            disabled={pending || uploadPending || !clientId}
            className="w-full"
          >
            {pending ? "Synthesizing…" : uploadPending ? "Waiting for lab extraction…" : "🔮 Analyze with AI"}
          </Button>
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result?.ok && result.suggestions && (
        <div className="space-y-4">
          <div className="border-t pt-4">
            <h2 className="text-xl font-semibold">✨ Suggestions</h2>
            <UsageStats
              usage={result.usage}
              subgraphBytes={result.subgraph_size_bytes}
            />
            <p className="text-xs text-muted-foreground">
              session: <code>{result.session_id}</code>
            </p>
          </div>
          <SuggestionsView
            suggestions={result.suggestions}
            picks={picks}
            setPicks={setPicks}
            selectedTopics={selectedTopics}
            computedRatios={result.computed_ratios}
          />

          {/* IFM Matrix — 7-node body-systems map + lab pattern recognition */}
          <IFMMatrixCard result={result} selectedSymptoms={selectedSymptoms} />

          {/* Plan Brief — optional coaching context before generating the draft */}
          <PlanBriefCard
            brief={planBrief}
            onChange={setPlanBrief}
            synthesisNotes={result.suggestions?.synthesis_notes}
          />

          <Card>
            <CardContent className="pt-6 space-y-2">
              <Button
                onClick={onGenerateDraft}
                disabled={draftPending}
                className="w-full"
              >
                {draftPending ? "Generating draft plan…" : "📝 Generate draft plan"}
              </Button>
              {planBrief.protocol_template_id && (
                <p className="text-xs text-center text-indigo-700">
                  Template <strong>{PROTOCOL_TEMPLATES.find(t => t.id === planBrief.protocol_template_id)?.display_name}</strong> will be merged into the draft
                </p>
              )}
            </CardContent>
          </Card>
          {result.session_id && (
            <ChatPanel
              clientId={clientId}
              sessionId={result.session_id}
              dryRun={dryRun}
            />
          )}
        </div>
      )}
    </div>
  );
}

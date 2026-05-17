"use client";

/**
 * Copy-able AI authoring prompt for the /ingest page.
 *
 * Coach pastes this into a Claude / GPT chat to get back YAML in the FMDB
 * schema (any entity type — Topic, Mechanism, Symptom, Supplement, Claim,
 * Drug entry). The returned YAML drops directly into
 * `fm-database/data/<entity>/<slug>.yaml` and goes through normal
 * validate → review → approve.
 *
 * v0.74 — includes the full three-axis DrugDepletion schema
 * (condition_implications + protocol_cautions + depletes). When the
 * catalogue schema changes, update PROMPT_BODY below.
 */
import { useState } from "react";

const PROMPT_BODY = String.raw`You are extracting clinical knowledge for a Functional Medicine coaching
catalogue (FMDB v0.74). Output YAML that drops directly into
fm-database/data/<entity>/<slug>.yaml, one fenced code block per entity,
prefixed by a one-line filename hint like '# file: cromolyn-sodium.yaml'.

Entity types you can emit (THESE ARE THE ONLY ONES — do NOT invent new
entity types like "medications" or "markers"; use the ones below):

  - topics                  clinical area (Hashimoto's, perimenopause, PCOS,
                            MCAS, histamine intolerance)
  - mechanisms              physiology (HPA-axis dysregulation, leaky gut,
                            methyl-trap, mast-cell degranulation)
  - symptoms                client-facing experiences (bloating, brain fog,
                            flushing, palpitations, food sensitivities)
  - claims                  evidence-tiered assertions ("metformin depletes B12";
                            "high serum folate with high B12 = methylation block")
  - supplements             nutraceuticals / herbs / nutrients (magnesium
                            glycinate, NAC, quercetin, DAO enzyme).
                            NOTE: pharmaceutical medications are NOT supplements
                            — emit them as drug_depletions below.
  - drug_depletions         MEDICATIONS — 3-axis entity (see DRUG section below).
                            This is where cromolyn, famotidine, montelukast,
                            ketotifen, omalizumab, TKIs, statins, PPIs, etc. go.
  - lab_tests               BIOMARKERS with conventional + FM-optimal ranges.
                            This is where tryptase, MMA, holoTC, AOC1 / HNMT /
                            KIT D816V genetic variants, leukotriene E4,
                            anti-TPO, ferritin, hs-CRP, etc. go.

═══════════════════════════════════════════════════════════════════════
HARD RULES (violating these breaks ingest):
═══════════════════════════════════════════════════════════════════════

1. SLUGS: lowercase ASCII, hyphens only, no spaces or underscores.
2. EVIDENCE TIERS — pick exactly one per entity:
     strong | plausible_emerging | fm_specific_thin | confirm_with_clinician
3. SOURCE GROUNDING: every entity must include 'source_quote' (verbatim
   sentence from the input doc, where possible) + 'source_location'
   (heading or section name).
4. DO NOT INVENT cross-link slugs. If unsure, leave fields empty.
5. status: active. version: 1. updated_at: today's ISO date.
   updated_by: shivani.

═══════════════════════════════════════════════════════════════════════
DRUG_DEPLETIONS (v0.74) — THE THREE-AXIS MEDICATION ENTITY
═══════════════════════════════════════════════════════════════════════

Medications are first-class. Each drug entry captures THREE axes:

  a. depletes[]                — classical nutrient depletions
                                 (B12, magnesium, folate, etc.)
                                 with severity + mechanism + replacement dose
  b. condition_implications[]  — what diagnosis this drug implies about
                                 the client (cromolyn → MCAS; metformin → T2D)
  c. protocol_cautions[]       — what the FM protocol must respect
                                 (avoid_food, avoid_supplement, timing, etc.)

When the input doc describes a medication, ALWAYS extract all three axes
when supported. Class-level entries (PPIs, TKIs, statins) are preferred
over per-brand entries — list every brand AND every Indian brand
(Janumet, Glycomet, Telma, Eltroxin, etc.) in drug_aliases.

drug_class enum:
  thyroid_hormone | metformin | ppi | h2_blocker | statin |
  oral_contraceptive | hrt | beta_blocker | ace_inhibitor | arb |
  thiazide_diuretic | loop_diuretic | ssri | snri | benzodiazepine |
  nsaid | aspirin | corticosteroid | antibiotic | methotrexate |
  insulin | sulfonylurea | levodopa | phenytoin | valproate |
  antipsychotic | mast_cell_stabiliser |
  leukotriene_receptor_antagonist | anti_ige_biologic |
  h1_antihistamine | tyrosine_kinase_inhibitor | glp1_agonist |
  sglt2_inhibitor | dpp4_inhibitor | other

condition_implications confidence:
  high     = near-pathognomonic (cromolyn → MCAS).
             Surfaces in active_conditions as the bare label.
  moderate = common but not exclusive (metformin → T2D — also PCOS,
             prediabetes). Surfaces as "Suspected: …".
  low      = one of many indications. IGNORED downstream.

protocol_cautions kinds:
  avoid_food | avoid_supplement | avoid_practice |
  prefer_food | prefer_supplement | timing | refer | monitor

protocol_cautions severity:
  critical = blocks the plan. Letter generator drops the offending
             item entirely if it would violate this caution.
  warning  = surfaces in plan-check, doesn't block.
  info     = best-practice nudge; informs AI letter tone.

Drug schema:

  slug: <kebab>                        # required
  drug_name: <Canonical Name>          # required
  drug_aliases:                        # required — at least 3 entries
    - <brand 1>
    - <brand 2>
    - <Indian brand>
  drug_class: <enum>                   # required, from list above
  summary: |                           # 2-4 sentences. What is it,
    <why prescribed, who gets it,       #  who gets it, any warnings.
     warnings>

  depletes:                            # nutrient depletions
    - nutrient: Vitamin B12 (cobalamin)
      severity: severe                 # mild | moderate | severe
      mechanism: <1 sentence>
      monitoring_recommendation: <lab + frequency>
      typical_supplement_dose: <FM replacement>

  condition_implications:              # what this drug implies
    - label: <human-readable dx>
      confidence: high                 # high | moderate | low
      rationale: <1-2 sentence why>
      topic_slug: <or null>

  protocol_cautions:                   # what to constrain
    - kind: avoid_food
      item: <free-text — specific foods/supplements/practices>
      severity: warning                # critical | warning | info
      reason: <1-line WHY>

  timing_separations:                  # list of free-text rules
    - "Take 4h apart from calcium / iron"
  contraindicated_supplements: []      # list of supplement slugs only
  monitoring_labs:
    - <lab + frequency>
  coach_notes: |                       # 2-4 sentences plain language
    <how a coach should think at the chair>
  linked_to_topics: []
  linked_to_mechanisms: []
  sources:
    - id: <source-id>
      location: <where in doc>
      quote: <verbatim 1-sentence>
  evidence_tier: strong                # required
  version: 1
  status: active
  updated_at: <YYYY-MM-DD>
  updated_by: shivani

═══════════════════════════════════════════════════════════════════════
LAB_TESTS (v0.74) — BIOMARKERS WITH CONVENTIONAL + FM-OPTIMAL RANGES
═══════════════════════════════════════════════════════════════════════

Lab tests are first-class. Emit a lab_tests entry when the document
describes a specific marker with ranges, interpretation, or indications.

Examples: serum tryptase (MCAS workup), MMA (functional B12), holoTC
(active B12), AOC1 / HNMT genetic variants (histamine metabolism),
KIT D816V mutation (mastocytosis), leukotriene E4 / 11β-PGF2α
(mast-cell mediators), anti-TPO / anti-Tg (Hashimoto's), fT3 / fT4 /
rT3, ferritin, TSAT, hs-CRP, homocysteine, HbA1c, etc.

CRITICAL DIFFERENCE FROM CONVENTIONAL RANGES: always capture
fm_optimal_low / fm_optimal_high SEPARATELY from conventional_low /
conventional_high. Coach UI shows both side-by-side so the client can
see "your TSH 4.2 is within lab-normal (0.4–4.5) but ABOVE FM optimal
(1.0–2.0)".

DO NOT emit a lab_test if the document only mentions a marker by name
without ranges or clinical context. In that case, drop it into
linked_to_* on the relevant topic / mechanism instead.

Lab test schema:

  slug: <kebab>                        # required
  display_name: <short label>          # e.g. "TSH", "MMA", "Tryptase"
  full_name: <long name>               # e.g. "Thyroid Stimulating Hormone",
                                       #      "Methylmalonic Acid", "Serum Tryptase"
  aliases:                             # alt names + abbreviations
    - <alias 1>
  units: <unit>                        # "mIU/L", "ng/mL", "%", "µmol/L"
  sample_type: <type>                  # blood | urine | saliva | stool | breath
  conventional_low: <number or null>   # lab's printed low end of normal
  conventional_high: <number or null>
  fm_optimal_low: <number or null>     # functional-medicine target (often narrower)
  fm_optimal_high: <number or null>
  interpretation_low: <text>           # what low values mean clinically
  interpretation_high: <text>          # what high values mean clinically
  when_to_order: <text>                # FM indications for ordering this test
  fasting_required: <bool>
  linked_to_topics: []
  linked_to_mechanisms: []
  notes_for_coach: |
    <how a coach should think about this marker — plain language>
  sources:
    - id: <source-id>
      location: <where in doc>
      quote: <verbatim 1-sentence>
  evidence_tier: strong                # required
  version: 1
  status: active
  updated_at: <YYYY-MM-DD>
  updated_by: shivani

═══════════════════════════════════════════════════════════════════════
ANCHOR EXAMPLES (already in catalogue — match this depth and tone):
═══════════════════════════════════════════════════════════════════════

  cromolyn-sodium.yaml         high-conf MCAS implication +
                               5 protocol_cautions for low-histamine framing
  tyrosine-kinase-inhibitors.yaml
                               class entry with 30+ aliases (imatinib,
                               sunitinib, sorafenib, …); critical-severity
                               refer + avoid_supplement cautions
                               (St John's wort, grapefruit, high-dose
                               curcumin); 4 depletions
  metformin.yaml               2 condition_implications (T2D high,
                               PCOS moderate), B12 + folate + CoQ10
                               depletions
  proton-pump-inhibitors.yaml  GERD high + hypochlorhydria moderate,
                               B12 + Mg + Fe + Zn depletions

For lab_tests, see:
  17-oh-progesterone.yaml      conventional vs FM-optimal ranges,
                               interpretation_low / interpretation_high,
                               when_to_order specific to PCOS workup

═══════════════════════════════════════════════════════════════════════
NOW — PASTE THE INPUT DOC / TEXT BELOW, OR LIST DRUGS TO AUTHOR:
═══════════════════════════════════════════════════════════════════════

<paste source document, or list drug names like:
  - <drug 1>
  - <drug 2>
>

If a drug name is ambiguous (compounds with the same name across
markets), ask me to scope it before generating.`;

export function CopyAuthoringPromptPanel() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_BODY);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — fall through */
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-indigo-900">
            🤖 Copy AI authoring prompt
          </div>
          <div className="text-xs text-indigo-700/80 mt-0.5">
            Paste into Claude / GPT to draft entries in FMDB v0.74 schema
            (incl. 3-axis drug entries). Output YAML drops directly into{" "}
            <code className="px-1 py-0.5 rounded bg-indigo-100 font-mono text-[10px]">
              fm-database/data/&lt;entity&gt;/&lt;slug&gt;.yaml
            </code>
            .
          </div>
        </div>
        <button
          onClick={copy}
          className="shrink-0 font-semibold px-3 py-1.5 rounded-lg text-xs text-white transition-all hover:opacity-90"
          style={{ background: copied ? "#10b981" : "#4f46e5" }}
        >
          {copied ? "✓ Copied" : "📋 Copy prompt"}
        </button>
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-indigo-700 hover:underline"
      >
        {expanded ? "▼ Hide preview" : "▶ Preview prompt"}
      </button>
      {expanded && (
        <pre className="text-[10.5px] leading-snug font-mono bg-white border border-indigo-200 rounded-lg px-3 py-2 max-h-72 overflow-auto whitespace-pre-wrap">
          {PROMPT_BODY}
        </pre>
      )}
    </div>
  );
}

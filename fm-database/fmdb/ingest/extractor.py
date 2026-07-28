"""Extraction backends. Pluggable via the Extractor Protocol.

Two implementations:
- StubExtractor: returns empty result. Lets you exercise the staging /
  review / approve plumbing without an API key.
- AnthropicExtractor: real LLM extraction via the Anthropic SDK, using
  tool-use to force structured JSON output and prompt caching on the
  schema spec (which is large and stable across calls).

Pick via env var FMDB_EXTRACTOR=stub|anthropic. Default: stub.
The Anthropic backend reads ANTHROPIC_API_KEY from env.
"""

from __future__ import annotations

import json
import os
from typing import Any, Protocol

from .types import EXTRACTED_TYPES, ExtractionResult, IngestRequest


class Extractor(Protocol):
    def extract(self, req: IngestRequest) -> ExtractionResult: ...


# ----- stub backend ----------------------------------------------------------


class StubExtractor:
    """No-op extractor. Returns an empty result so the rest of the pipeline
    can be exercised end-to-end without API calls."""

    def extract(self, req: IngestRequest) -> ExtractionResult:
        return ExtractionResult()


# ----- Anthropic backend -----------------------------------------------------


# JSON schema we hand to the model via tool-use. This is a deliberately
# trimmed view of the canonical Pydantic schemas — lifecycle fields
# (version, status, updated_at, updated_by) are filled by the staging
# layer, not the LLM. Slugs are required; the validator will reject
# malformed slugs after staging.
_TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "supplements": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "category", "evidence_tier"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string"},
                    "category": {"type": "string"},
                    "forms_available": {"type": "array", "items": {"type": "string"}},
                    "typical_dose_range": {"type": "object"},
                    "timing_options": {"type": "array", "items": {"type": "string"}},
                    "take_with_food": {"type": "string"},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "linked_to_claims": {"type": "array", "items": {"type": "string"}},
                    "notes_for_coach": {"type": "string"},
                    "notes_for_client": {"type": "string"},
                    "evidence_tier": {"type": "string"},
                    "source_quote": {
                        "type": "string",
                        "description": "Verbatim sentence from the input doc supporting this entry.",
                    },
                    "source_location": {"type": "string"},
                },
            },
        },
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "summary", "evidence_tier"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "summary": {"type": "string"},
                    "common_symptoms": {"type": "array", "items": {"type": "string"}},
                    "red_flags": {"type": "array", "items": {"type": "string"}},
                    "related_topics": {"type": "array", "items": {"type": "string"}},
                    "key_mechanisms": {"type": "array", "items": {"type": "string"}},
                    "coaching_scope_notes": {"type": "string"},
                    "clinician_scope_notes": {"type": "string"},
                    "evidence_tier": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "symptoms": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "category", "description"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "category": {"type": "string"},
                    "severity": {"type": "string"},
                    "description": {"type": "string"},
                    "when_to_refer": {"type": "string"},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "linked_to_mechanisms": {"type": "array", "items": {"type": "string"}},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "mechanisms": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "category", "summary", "evidence_tier"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "category": {"type": "string"},
                    "summary": {"type": "string"},
                    "upstream_drivers": {"type": "array", "items": {"type": "string"}},
                    "downstream_effects": {"type": "array", "items": {"type": "string"}},
                    "related_mechanisms": {"type": "array", "items": {"type": "string"}},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "evidence_tier": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["slug", "statement", "evidence_tier", "rationale"],
                "properties": {
                    "slug": {"type": "string"},
                    "statement": {"type": "string"},
                    "evidence_tier": {"type": "string"},
                    "rationale": {"type": "string"},
                    "coaching_translation": {"type": "string"},
                    "out_of_scope_notes": {"type": "string"},
                    "caveats": {"type": "array", "items": {"type": "string"}},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "linked_to_supplements": {"type": "array", "items": {"type": "string"}},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "somatic_practices": {
            "type": "array",
            "description": (
                "A short, bounded body-based exercise (a 'somatic reset') that a "
                "client performs to complete an interrupted stress response. Emit "
                "one per distinct named exercise. The SAME practice is often "
                "prescribed for several symptoms — emit it ONCE and let the "
                "somatic_maps reference it by slug. "
                "CRITICAL: capture the steps as objective, observable facts. Do "
                "NOT classify the exercise into a motion 'type' or 'shape' — that "
                "classification is done downstream once the whole library exists, "
                "and guessing it here destroys the evidence. "
                "COPYRIGHT: rewrite every instruction in your own words. Never "
                "reproduce source phrasing verbatim."
            ),
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "category", "steps"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string", "description": "The exercise's name, e.g. 'Neck-Shoulder Drop Release'."},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "category": {"type": "string", "description": "breath | discharge | touch | movement | imagery | orientation | behavioural | other"},
                    "body_region": {"type": "string", "description": "head_face | jaw | throat_neck | shoulders_upper_back | arms_hands | chest_diaphragm | abdomen | pelvis | lower_back_hips | legs_feet | whole_body"},
                    "position": {"type": "string", "description": "seated | standing | lying | any_position"},
                    "summary": {"type": "string"},
                    "why_it_works": {"type": "string", "description": "The physiological rationale, coach-facing."},
                    "steps": {
                        "type": "array",
                        "description": "The exercise broken into ordered steps, in the client's language.",
                        "items": {
                            "type": "object",
                            "required": ["label", "cue"],
                            "properties": {
                                "label": {"type": "string", "description": "Short step name — 'Push', 'Breathe in', 'Let warmth build'."},
                                "cue": {"type": "string", "description": "What the client is actually told to do."},
                                "secs": {"type": "integer", "description": "Seconds for this step. OMIT if the source gives no duration — do not invent one."},
                                "action": {"type": "string", "description": "The bare verb of the movement: expand | hold | shrink | press | release | tap | circle | rest | observe | massage. Use the word that fits; this is free text, not a fixed list."},
                            },
                        },
                    },
                    "reps": {"type": "integer", "description": "Repetitions/rounds, only if the source states one."},
                    "duration_seconds": {"type": "integer", "description": "Total session length, only if stated or directly derivable."},
                    "bilateral": {"type": "boolean", "description": "True if the exercise alternates left and right sides."},
                    "timed": {"type": "boolean", "description": "False when this is a protocol applied to an activity (e.g. how to eat a meal) rather than a timed session."},
                    "equipment": {"type": "array", "items": {"type": "string"}, "description": "Anything needed — a wall, a towel, a chair."},
                    "contraindications": {"type": "array", "items": {"type": "string"}, "description": "Who should not do this, or should modify it. Include any that are obvious from the movement even if the source omits them (e.g. isometric holds and uncontrolled hypertension)."},
                    "linked_to_symptoms": {"type": "array", "items": {"type": "string"}},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "notes_for_coach": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "somatic_maps": {
            "type": "array",
            "description": (
                "The emotional/somatic reading attached to ONE symptom or topic: "
                "its associated emotional patterns, a client-facing reframe, one "
                "reflective question, and the somatic practice that accompanies it. "
                "Emit one per chapter/entry. "
                "SAFETY — this is the highest-risk content in the pipeline. These "
                "are ASSOCIATIONS observed in a source, never causal claims, and "
                "must never read as 'your emotions caused this disease'. Always "
                "populate differential_note with the physiological causes that must "
                "be excluded first. Set sensitivity to 'sensitive' for anything "
                "touching relationships, sexuality, body image or reproduction, and "
                "'coach_only' for pregnancy loss, infertility, cancer, or any entry "
                "whose framing could read as blaming a grieving person. When in "
                "doubt choose the MORE restrictive value."
            ),
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "target_kind", "target_slug", "differential_note"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string"},
                    "target_kind": {"type": "string", "description": "symptom | topic — which catalogue bucket target_slug lives in."},
                    "target_slug": {"type": "string", "description": "The existing catalogue slug this reading attaches to."},
                    "sensitivity": {"type": "string", "description": "general | sensitive | coach_only. Default to the more restrictive when unsure."},
                    "emotional_roots": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["pattern"],
                            "properties": {
                                "pattern": {"type": "string", "description": "Short name for the pattern — 'Swallowed anger'."},
                                "note": {"type": "string", "description": "The fuller description, in warm coach voice, phrased as an association not a cause."},
                            },
                        },
                    },
                    "reframe": {"type": "string", "description": "Client-facing, belief-level. Never blaming."},
                    "inquiry_question": {"type": "string", "description": "The single reflective question."},
                    "somatic_practice": {"type": "string", "description": "Slug of the somatic_practice emitted for this entry."},
                    "also_consider": {
                        "type": "object",
                        "description": "Practical adjuncts. Put supplements/remedies under their catalogue slug if you are confident one exists; otherwise put the whole item in `practical` as free text. Do NOT invent supplement slugs.",
                        "properties": {
                            "supplements": {"type": "array", "items": {"type": "string"}},
                            "home_remedies": {"type": "array", "items": {"type": "string"}},
                            "cooking_adjustments": {"type": "array", "items": {"type": "string"}},
                            "practical": {"type": "array", "items": {"type": "string"}},
                        },
                    },
                    "pattern_signals": {"type": "array", "items": {"type": "string"}, "description": "Observable cues that make this reading plausible in a given client — what a coach would look for before raising it."},
                    "differential_note": {"type": "string", "description": "REQUIRED. The physiological/structural drivers that must be excluded first. This is what stops an association being read as a cause."},
                    "coach_only_note": {"type": "string", "description": "Set when the framing must never auto-surface to a client, and say why."},
                    "notes_for_coach": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "lab_tests": {
            "type": "array",
            "description": (
                "v0.74 — individual lab biomarkers with conventional + FM-optimal "
                "ranges. Emit when the document describes a specific marker "
                "(tryptase, MMA, holoTC, AOC1, KIT D816V, leukotriene E4, "
                "anti-TPO, fT3, fT4, ferritin, hs-CRP, etc.) with ranges, "
                "interpretation, or indications. Capture FM-optimal ranges "
                "separately from conventional lab ranges so the UI can show "
                "both side-by-side."
            ),
            "items": {
                "type": "object",
                "required": ["slug", "display_name", "full_name", "units", "evidence_tier"],
                "properties": {
                    "slug": {"type": "string"},
                    "display_name": {"type": "string", "description": "Short label — e.g. 'TSH', 'MMA', 'Tryptase'."},
                    "full_name": {"type": "string", "description": "Full name — e.g. 'Thyroid Stimulating Hormone', 'Methylmalonic Acid', 'Serum Tryptase'."},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "units": {"type": "string", "description": "e.g. 'mIU/L', 'ng/mL', '%', 'µmol/L'."},
                    "sample_type": {"type": "string", "description": "blood | urine | saliva | stool | breath"},
                    "conventional_low": {"type": "number", "description": "Lab's printed low end of normal."},
                    "conventional_high": {"type": "number"},
                    "fm_optimal_low": {"type": "number", "description": "Functional-medicine optimal low (often narrower than lab normal)."},
                    "fm_optimal_high": {"type": "number"},
                    "interpretation_low": {"type": "string"},
                    "interpretation_high": {"type": "string"},
                    "when_to_order": {"type": "string", "description": "FM indications for ordering this test."},
                    "fasting_required": {"type": "boolean"},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "linked_to_mechanisms": {"type": "array", "items": {"type": "string"}},
                    "notes_for_coach": {"type": "string"},
                    "evidence_tier": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
        "drug_depletions": {
            "type": "array",
            "description": (
                "v0.74 — medication entries. The catalogue tracks medications "
                "across THREE axes, not just depletions: condition_implications "
                "(what diagnosis the drug implies), protocol_cautions (food/"
                "supplement/lifestyle constraints), and depletes (nutrient "
                "depletion)."
            ),
            "items": {
                "type": "object",
                "required": ["slug", "drug_name", "drug_class", "evidence_tier"],
                "properties": {
                    "slug": {"type": "string"},
                    "drug_name": {"type": "string"},
                    "drug_aliases": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "All brand names INCLUDING Indian brands (e.g. metformin → glycomet, obimet; sitagliptin → Januvia, Janumet).",
                    },
                    "drug_class": {
                        "type": "string",
                        "description": "One of: thyroid_hormone, metformin, ppi, h2_blocker, statin, oral_contraceptive, hrt, beta_blocker, ace_inhibitor, arb, thiazide_diuretic, loop_diuretic, ssri, snri, benzodiazepine, nsaid, aspirin, corticosteroid, antibiotic, methotrexate, insulin, sulfonylurea, levodopa, phenytoin, valproate, antipsychotic, mast_cell_stabiliser, leukotriene_receptor_antagonist, anti_ige_biologic, h1_antihistamine, tyrosine_kinase_inhibitor, glp1_agonist, sglt2_inhibitor, dpp4_inhibitor, other.",
                    },
                    "summary": {"type": "string"},
                    "depletes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "nutrient": {"type": "string"},
                                "severity": {"type": "string", "description": "mild | moderate | severe"},
                                "mechanism": {"type": "string"},
                                "monitoring_recommendation": {"type": "string"},
                                "typical_supplement_dose": {"type": "string"},
                            },
                        },
                    },
                    "condition_implications": {
                        "type": "array",
                        "description": "What diagnoses does prescribing this drug imply? confidence: high (near-pathognomonic, e.g. cromolyn → MCAS), moderate (common but not exclusive, e.g. metformin → T2D; will surface as 'Suspected: …'), low (one of many — IGNORED downstream).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "confidence": {"type": "string", "description": "high | moderate | low"},
                                "rationale": {"type": "string"},
                                "topic_slug": {"type": "string", "description": "Canonical topic slug if it exists in the catalogue, else null."},
                            },
                        },
                    },
                    "protocol_cautions": {
                        "type": "array",
                        "description": "Constraints the medication imposes on the FM protocol. critical = blocks the plan; warning = surfaces but doesn't block; info = best-practice nudge.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string", "description": "avoid_food | avoid_supplement | avoid_practice | prefer_food | prefer_supplement | timing | refer | monitor"},
                                "item": {"type": "string", "description": "Free-text constraint (e.g. 'Aged cheese, fermented foods, leftover meat, wine')."},
                                "severity": {"type": "string", "description": "critical | warning | info"},
                                "reason": {"type": "string", "description": "1-line WHY"},
                            },
                        },
                    },
                    "timing_separations": {"type": "array", "items": {"type": "string"}},
                    "contraindicated_supplements": {"type": "array", "items": {"type": "string"}},
                    "monitoring_labs": {"type": "array", "items": {"type": "string"}},
                    "coach_notes": {"type": "string"},
                    "linked_to_topics": {"type": "array", "items": {"type": "string"}},
                    "evidence_tier": {"type": "string"},
                    "source_quote": {"type": "string"},
                    "source_location": {"type": "string"},
                },
            },
        },
    },
}


_SYSTEM_PROMPT = """You are an extraction agent for a Functional Medicine catalogue.

Your job: read the user's document and extract structured candidates for
Topics, Claims, and Supplements that future coaches can author plans from.

Strict rules:

1. SLUGS: lowercase ASCII, hyphenated, no underscores or spaces. Examples:
   `magnesium-glycinate`, `tg-hdl-ratio-outperforms-fasting-glucose`,
   `perimenopause`. For claims, the slug should read like a short assertion.

2. EVIDENCE TIERS — pick exactly one per entity:
   - `strong` — peer-reviewed consensus, well-established mechanism + RCTs
   - `plausible_emerging` — credible mechanism, early trials, not consensus
   - `fm_specific_thin` — common in FM, biologically plausible, thin peer-reviewed support
   - `confirm_with_clinician` — out of coaching scope (dosing, lab interp, prescribing)

3. SOURCE GROUNDING: every entity must include `source_quote` (a verbatim
   sentence from the input doc) and ideally a `source_location` (heading
   or section name). Do not invent. If the doc doesn't support the claim,
   don't extract it.

4. SUPPLEMENT category: one of mineral, vitamin, herb, amino_acid,
   probiotic, fatty_acid, enzyme, other.

5. SUPPLEMENT forms: any of capsule, powder, tablet, liquid, gummy, lozenge.
   `typical_dose_range` is a dict keyed by form, each value
   `{min: number, max: number, unit: "mg"|"mcg"|"g"|"ml"|"drops"|"capsules"|"tablets"|"scoops"|"teaspoons"}`.

6. TIMING options: on_waking, on_empty_stomach, morning, mid_morning,
   with_breakfast, with_lunch, mid_afternoon, with_dinner, evening, bedtime.

7. take_with_food: required | optional | avoid.

8. CROSS-LINKS (`linked_to_topics`, `linked_to_claims`,
   `linked_to_supplements`, `related_topics`): use slugs you also
   extracted in this same call, OR slugs that already exist in the
   catalogue (the user may have pre-listed them in their instructions).
   If unsure, leave empty rather than inventing.

9. Prefer FEWER, HIGHER-QUALITY entities over many speculative ones.
   It is fine — and often correct — to return zero entities of a type.

10. CLAIMS ARE FIRST-CLASS. If the source enumerates "Claim 1", "Claim 2",
    "Statement A", or numbered evidence-tiered assertions, emit ONE `Claim`
    entity per numbered item. Do NOT collapse them into a Topic's
    `key_mechanisms` field. Topics describe the clinical area; Claims are
    the individual evidence-tiered assertions about it. A document with
    one topic and ten enumerated claims should produce one Topic and ten
    Claim entities, not one Topic with ten mechanisms.

11. `key_mechanisms` on a Topic is for one-to-three short physiological
    mechanism slugs (e.g., `insulin-resistance`, `hpa-axis-dysregulation`),
    NOT for full-sentence evidence claims. If you find yourself writing a
    long sentence here, it belongs in a `Claim` instead.

14. SYMPTOMS are client-facing experiences (e.g., `bloating`, `brain-fog`,
    `3am-wakeups`, `joint-pain`). Categories: gi | musculoskeletal |
    neurological | mood | sleep | skin | hormonal | metabolic |
    constitutional | cardiovascular | urinary | other. Severity:
    common | concerning | red_flag (refer-out level).
    USE ALIASES generously to capture how clients actually describe
    things ("feeling foggy", "puffy belly", "wired but tired"). When the
    document lists symptom-cluster prose like "constipation, gas, bloating,
    new food sensitivities", emit each as a separate Symptom unless one is
    clearly an alias of another.

13. MECHANISMS are physiological pathways (e.g., `hpa-axis-dysregulation`,
    `leaky-gut`, `insulin-resistance`, `gaba-a-receptor-modulation`). They
    sit between Topics (clinical areas) and Claims (assertions). Categories:
    endocrine | neurological | immune | metabolic | gut | structural |
    signaling | other. Emit a Mechanism entity when the document explains
    HOW something works at the physiological level. Topic.key_mechanisms
    and Claim.linked_to_mechanisms / Supplement.linked_to_mechanisms should
    reference these by slug. Mechanisms support `aliases` — use them to
    canonicalize variant names (e.g. `leaky-gut` with aliases
    [`intestinal-hyperpermeability`, `gut-barrier-dysfunction`]). Prefer
    enriching an existing mechanism with new aliases rather than creating
    a near-duplicate.

12. SOURCE-TYPE CALIBRATION. The user message tells you the source_type.
    If it is `llm_synthesis` or `other`, treat the document as a draft.
    NEVER assign `evidence_tier: strong` from these sources unless the
    document quotes a specific peer-reviewed study you can identify by
    author + year + journal. Default to `plausible_emerging` or
    `fm_specific_thin`. Add a caveat noting the source is a synthesis,
    not primary literature. Specific dose recommendations from these
    sources should always carry a "verify with clinician" caveat.

16. LAB TESTS (LabTest) — v0.74. Individual biomarkers are first-class
    entities. Emit a `lab_tests` entry when the document describes a
    specific marker with ranges, interpretation, or indications.
    Examples: serum tryptase (MCAS workup), MMA (functional B12), holoTC
    (active B12), AOC1 / HNMT genetic variants (histamine metabolism),
    KIT D816V mutation (mastocytosis), leukotriene E4 / 11β-PGF2α
    (mast-cell mediators), anti-TPO / anti-Tg (Hashimoto's), fT3 / fT4
    / rT3, ferritin, TSAT, hs-CRP, homocysteine, HbA1c, etc.

    CAPTURE BOTH RANGES SEPARATELY: conventional_low / conventional_high
    (the lab's printed normal range) vs fm_optimal_low / fm_optimal_high
    (the functional-medicine target — often narrower). Coach UI shows
    both side-by-side so client can see "TSH 4.2 is in lab-normal but
    above FM optimal 1.0–2.0".

    Don't emit a lab_test if the document only mentions a marker by name
    without ranges or clinical context. Drop it into `linked_to_*` on the
    relevant topic / mechanism instead.

    A LabTest's `when_to_order` field is the FM indication for ordering
    it. Use plain coach-readable language ("PCOS workup with strong
    androgen signs", "histamine intolerance / MCAS workup", etc.).

15. DRUG ENTRIES (DrugDepletion) — v0.74. Medications are first-class. When
    the document describes a medication, extract it as a `drug_depletions`
    entry. The catalogue tracks meds across THREE axes — extract ALL three
    when the document supports it:

    a. `depletes[]` — classical drug-nutrient depletions (B12, magnesium,
       CoQ10, folate, iron, zinc, etc.) with severity (mild/moderate/severe),
       mechanism, and standard FM replacement dose.

    b. `condition_implications[]` — what diagnosis does this medication
       IMPLY about the client?
         - high confidence: drug is near-exclusively prescribed for this
           condition (cromolyn → MCAS; levothyroxine → hypothyroidism;
           omalizumab → severe allergic asthma).
         - moderate confidence: drug is commonly used for this condition
           but not exclusively (metformin → T2D, but also PCOS,
           prediabetes; SSRI → depression, but also anxiety, OCD).
           Downstream surfaces these as "Suspected: …".
         - low confidence: drug has many indications; IGNORED downstream.
       Each implication needs a 1-2 sentence `rationale` + an optional
       `topic_slug` if a canonical topic exists in the catalogue.

    c. `protocol_cautions[]` — what does this medication constrain in the
       FM protocol?
         kinds: avoid_food | avoid_supplement | avoid_practice |
                prefer_food | prefer_supplement | timing | refer | monitor
         severity: critical (blocks the plan — must be addressed),
                   warning (surfaces in plan-check, doesn't block),
                   info (best-practice nudge).
       Each caution needs an `item` (free-text, specific foods /
       supplements / practices) and a 1-line `reason` (used in plan-check
       finding text).

    Use the existing seeded drugs as references for depth + tone:
    `metformin.yaml`, `cromolyn-sodium.yaml`, `tyrosine-kinase-inhibitors.yaml`,
    `proton-pump-inhibitors.yaml`. Class-level entries (PPIs, TKIs,
    statins) are preferred over per-brand entries — list every brand name
    AND every Indian brand name in `drug_aliases` so a mention of any
    one resolves to the class entry.

    `drug_class` values supported: thyroid_hormone, metformin, ppi,
    h2_blocker, statin, oral_contraceptive, hrt, beta_blocker,
    ace_inhibitor, arb, thiazide_diuretic, loop_diuretic, ssri, snri,
    benzodiazepine, nsaid, aspirin, corticosteroid, antibiotic,
    methotrexate, insulin, sulfonylurea, levodopa, phenytoin, valproate,
    antipsychotic, mast_cell_stabiliser, leukotriene_receptor_antagonist,
    anti_ige_biologic, h1_antihistamine, tyrosine_kinase_inhibitor,
    glp1_agonist, sglt2_inhibitor, dpp4_inhibitor, other.

Call the extract_entities tool exactly once with your structured result."""


class AnthropicExtractor:
    """LLM-backed extractor using Anthropic's tool-use for structured output.

    Caches the system prompt + tool schema (large, stable) so repeated
    ingest runs are cheap. Cache TTL is 5 minutes by default.
    """

    def __init__(
        self,
        model: str | None = None,
        max_tokens: int = 32768,
        api_key: str | None = None,
    ):
        try:
            import anthropic  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "anthropic SDK not installed. Run `pip install anthropic`."
            ) from e

        from anthropic import Anthropic

        self._client = Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))
        self._model = model or os.environ.get("FMDB_EXTRACTOR_MODEL", "claude-sonnet-4-6")
        self._max_tokens = max_tokens

    def extract(self, req: IngestRequest) -> ExtractionResult:
        tool = {
            "name": "extract_entities",
            "description": "Return Topics, Claims, and Supplements grounded in the document.",
            "input_schema": _TOOL_INPUT_SCHEMA,
        }

        # Build content blocks: attached PDFs/images first (so the model sees
        # them as visual context), then the text payload last.
        content: list[dict[str, Any]] = []
        for att in (req.attachments or []):
            mime = att.get("mime_type", "")
            if mime == "application/pdf":
                content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": att["data_b64"],
                    },
                    "title": att.get("filename", "document"),
                })
            elif mime.startswith("image/"):
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime,
                        "data": att["data_b64"],
                    },
                })

        user_message = (
            f"Source: {req.source_title} (id: {req.source_id}, "
            f"type: {req.source_type}, quality: {req.source_quality})\n\n"
        )
        if req.instructions:
            user_message += f"Extra instructions:\n{req.instructions}\n\n"
        user_message += "Document:\n---\n" + req.document_text + "\n---"
        content.append({"type": "text", "text": user_message})

        # Use streaming for any max_tokens > 8192 — Anthropic requires it, and
        # streaming also avoids timeouts on long extractions. We don't actually
        # consume the stream — just call get_final_message() to get the same
        # shape as messages.create() would have returned.
        with self._client.messages.stream(
            model=self._model,
            max_tokens=self._max_tokens,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                },
                {
                    "type": "text",
                    "text": "Tool schema reference:\n" + json.dumps(_TOOL_INPUT_SCHEMA, indent=2),
                    "cache_control": {"type": "ephemeral"},
                },
            ],
            tools=[tool],
            tool_choice={"type": "tool", "name": "extract_entities"},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            resp = stream.get_final_message()

        usage_obj = getattr(resp, "usage", None)
        usage = {
            "model": self._model,
            "stop_reason": getattr(resp, "stop_reason", None),
            "input_tokens": getattr(usage_obj, "input_tokens", None),
            "output_tokens": getattr(usage_obj, "output_tokens", None),
            "cache_creation_input_tokens": getattr(usage_obj, "cache_creation_input_tokens", None),
            "cache_read_input_tokens": getattr(usage_obj, "cache_read_input_tokens", None),
        }

        for block in resp.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "extract_entities":
                payload = block.input or {}
                # Build from EXTRACTED_TYPES so a newly-declared entity type can
                # never be requested in the tool schema, billed for, and then
                # silently dropped here (which is exactly what happened to
                # drug_depletions + lab_tests). sources are registered by the
                # staging layer from the IngestRequest, not read from payload.
                buckets = {e: list(payload.get(e, []) or []) for e in EXTRACTED_TYPES}
                return ExtractionResult(sources=[], usage=usage, **buckets)
        return ExtractionResult(usage=usage)


# ----- factory ---------------------------------------------------------------


def get_extractor(name: str | None = None) -> Extractor:
    name = (name or os.environ.get("FMDB_EXTRACTOR", "stub")).lower()
    if name == "stub":
        return StubExtractor()
    if name == "anthropic":
        return AnthropicExtractor()
    raise ValueError(f"unknown extractor: {name!r} (expected 'stub' or 'anthropic')")

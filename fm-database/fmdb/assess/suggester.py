"""Synthesize FM-coaching suggestions from client context + lab files.

Calls Claude with:
  - Client demographics, conditions, meds, allergies, goals
  - Selected symptoms + topics
  - Catalogue subgraph (pre-filtered by subgraph.build_subgraph)
  - Uploaded lab reports as document/image content blocks

Returns structured suggestions via tool-use, all referencing catalogue
slugs only (model is constrained by the subgraph's whitelist).
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from .results import AssessResult, AssessUsage, AssessSuggestions, ChatContext, ChatResult, compute_fit_percent


# JSON schema for the structured response. Intentionally narrow — every
# suggestion must reference a slug or a clear text rationale.
_TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "extracted_labs": {
            "type": "array",
            "description": "Lab values extracted from any uploaded reports.",
            "items": {
                "type": "object",
                "required": ["test_name", "value"],
                "properties": {
                    "test_name": {"type": "string"},
                    "value": {"type": "string"},
                    "unit": {"type": "string"},
                    "reference_range": {"type": "string"},
                    "flag": {"type": "string", "description": "low | normal | high | optimal | suboptimal | unknown"},
                    "fm_interpretation": {"type": "string", "description": "Brief FM-lens interpretation; flag if outside FM-optimal range even when within standard range."},
                    "date_drawn": {"type": "string"},
                },
            },
        },
        "likely_drivers": {
            "type": "array",
            "description": "Mechanisms most likely driving the picture, ranked. CLASSIFY EACH using the ATM cognitive model (Antecedent / Trigger / Mediator / Expression) and link them into a cascade graph via `parents`. This separates root causes from downstream effects — the FM way of thinking.",
            "items": {
                "type": "object",
                "required": ["mechanism_slug", "rank", "reasoning", "atm_role"],
                "properties": {
                    "mechanism_slug": {"type": "string", "description": "MUST be a slug from the catalogue subgraph."},
                    "rank": {"type": "integer", "description": "1 = most clinically actionable / most upstream / highest leverage. Antecedents and triggers usually rank higher than mediators; mediators higher than expressions."},
                    "reasoning": {"type": "string", "description": "Why this is a driver — reference specific client data."},
                    "supporting_evidence": {"type": "array", "items": {"type": "string"}, "description": "Quote symptoms or labs that support this hypothesis."},
                    "atm_role": {
                        "type": "string",
                        "enum": ["antecedent", "trigger", "mediator", "expression"],
                        "description": (
                            "ATM role:\n"
                            "  • antecedent — predisposing factor, often constitutional / genetic / "
                            "in-utero / early-childhood. Doesn't go away (e.g. MTHFR variant, "
                            "family history of autoimmunity, low birth weight, early gut "
                            "colonisation deficit).\n"
                            "  • trigger — precipitating event that started the cascade (e.g. "
                            "infection like EBV / dengue / COVID, food poisoning, antibiotic "
                            "course, head injury, divorce, chemo, gluten exposure, head injury, "
                            "first pregnancy, menarche, menopause).\n"
                            "  • mediator — ongoing perpetuator (e.g. chronic stress, current "
                            "food sensitivity, sleep deprivation, ongoing toxin exposure, "
                            "untreated dysbiosis, leaky gut, chronic inflammation, hpa-axis "
                            "dysregulation). MOST 'drivers' in a real client are mediators.\n"
                            "  • expression — symptom or syndrome the client presents with, "
                            "downstream of triggers + mediators (e.g. Hashimoto's antibodies, "
                            "IBS-D, eczema flare, perimenopause symptoms). The 'tip of the "
                            "iceberg'."
                        ),
                    },
                    "parents": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Mechanism slugs of OTHER drivers in this list that PRECEDE this one in the cascade. Empty for antecedents and triggers (they're root). Populated for mediators (point to triggers / antecedents that drove them) and expressions (point to mediators). E.g. expression `hashimoto-antibodies` might have parents `[gluten-exposure, leaky-gut, chronic-inflammation]`. Use ONLY mechanism slugs that appear in this same likely_drivers array.",
                    },
                    "chain_evidence": {
                        "type": "string",
                        "description": "1-2 sentences explaining why this driver sits at this position in the chain. E.g. 'Trigger — client's symptoms started after 3-week course of doxycycline in 2023, prior history was unremarkable.' Or 'Mediator — chronic work stress 4+ years documented in intake, drives cortisol patterns visible on saliva test.'",
                    },
                },
            },
        },
        "topics_in_play": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["topic_slug", "role"],
                "properties": {
                    "topic_slug": {"type": "string"},
                    "role": {"type": "string", "description": "primary | contributing"},
                    "rationale": {"type": "string"},
                    "confidence_pct": {"type": "integer", "description": "0–100 confidence that this topic is meaningfully implicated. 100 = near-certain from labs/symptoms. 50 = plausible. <30 = speculative."},
                },
            },
        },
        "additional_symptoms_to_screen": {
            "type": "array",
            "description": "Symptoms the coach didn't mention but that fit the cluster — worth asking about.",
            "items": {
                "type": "object",
                "required": ["symptom_slug"],
                "properties": {
                    "symptom_slug": {"type": "string"},
                    "why_screen": {"type": "string"},
                },
            },
        },
        "lifestyle_suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "cadence", "rationale"],
                "properties": {
                    "name": {"type": "string", "description": "Freeform practice name (e.g. 'morning sunlight')."},
                    "cadence": {"type": "string", "description": "daily | nightly | weekly | etc."},
                    "details": {"type": "string"},
                    "rationale": {"type": "string", "description": "WHY this practice for THIS client — reference a specific symptom, lab, medication, or life event from client_context. Avoid generic 'good for stress' / 'helps sleep'. If you can't tie it to a specific signal in this client's data, drop the suggestion."},
                    "addresses_mechanism": {"type": "array", "items": {"type": "string"}, "description": "mechanism slugs this targets"},
                },
            },
        },
        "nutrition_suggestions": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "e.g. 'gentle anti-inflammatory'"},
                "add": {"type": "array", "items": {"type": "string"}},
                "reduce": {"type": "array", "items": {"type": "string"}},
                "meal_timing": {"type": "string"},
                "cooking_adjustment_slugs": {"type": "array", "items": {"type": "string"}, "description": "MUST be slugs from the catalogue subgraph."},
                "home_remedy_slugs": {"type": "array", "items": {"type": "string"}, "description": "MUST be slugs from the catalogue subgraph."},
                "rationale": {"type": "string"},
            },
        },
        "supplement_suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["supplement_slug", "rationale"],
                "properties": {
                    "supplement_slug": {"type": "string", "description": "MUST be a slug from the catalogue subgraph."},
                    "form": {"type": "string"},
                    "dose": {"type": "string"},
                    "timing": {"type": "string"},
                    "duration_weeks": {"type": "integer"},
                    "titration": {"type": "string", "description": "How the client ramps to the target dose. CRITICAL: India has no compounding pharmacies, so titrate using what's available off the shelf. Use the catalogue's typical_dose_range + forms_available + dosage info to know what comes in what strength. If you need a sub-dose: (a) every-other-day → daily (simplest, default), or (b) when split-dose is medically important: 'Open the capsule and stir half the powder into water, drink it; discard the rest' OR 'split a 500mg tablet in half'. Be specific to THIS supplement's actual format. Empty string when the dose can be taken as-is from day 1."},
                    "rationale": {"type": "string"},
                    "evidence_tier_caveat": {"type": "string", "description": "If catalogue tier is fm_specific_thin or confirm_with_clinician, surface that."},
                    "contraindication_check": {"type": "string", "description": "Any flagged conflicts with client meds/conditions."},
                    "vitaone_url": {"type": "string", "description": "If this supplement maps to a product in `vitaone_inventory`, set this to that product's `url` verbatim. Empty string when no VitaOne match exists. The coach uses this to point clients at the affiliate-stocked product."},
                },
            },
        },
        "suggested_protocols": {
            "type": "array",
            "description": "FM protocols (5R, AIP, Whole30, weight-loss reset, adrenal recovery, etc.) that match this client's pattern. Score each candidate across 11 weighted factors — server-side computes the weighted overall fit_percent and shows only top 2 to the coach. Skip a protocol entirely if its indications don't fit OR any contraindication applies. Don't combine restrictive protocols (e.g. AIP + weight-loss reset).",
            "items": {
                "type": "object",
                "required": ["protocol_slug", "why_indicated", "factor_scores"],
                "properties": {
                    "protocol_slug": {"type": "string", "description": "MUST be a slug from the `protocols` array in the catalogue subgraph."},
                    "why_indicated": {"type": "string", "description": "2–4 sentences. Reference SPECIFIC client facts: chief complaint, named drivers, lab values, conditions, current medications, life events. NOT generic FM rationale."},
                    "factor_scores": {
                        "type": "object",
                        "description": "Score this protocol's fit for THIS client across 11 factors. Each is 1–5: 5 = textbook fit, 4 = strong, 3 = reasonable with caveats, 2 = weak, 1 = poor / mismatch. Be honest — don't inflate. The server computes the weighted overall fit % from these.",
                        "required": ["symptoms", "medical_safety", "labs", "goals", "gut_function", "metabolic_health", "nutrient_status", "lifestyle", "culture", "real_world_fit", "sustainability"],
                        "properties": {
                            "symptoms": {"type": "integer", "description": "Symptoms + chief complaints match. (weight 20%)"},
                            "medical_safety": {"type": "integer", "description": "Diagnoses, medical history, current medications, risk-level compatibility. Score LOW if any contraindication, drug interaction, or active disease conflict. (weight 18%)"},
                            "labs": {"type": "integer", "description": "Lab values + biomarkers support this protocol. (weight 15%)"},
                            "goals": {"type": "integer", "description": "Alignment with the client's stated health goals. (weight 10%)"},
                            "gut_function": {"type": "integer", "description": "Gut symptoms, food reactions, digestive readiness. (weight 10%)"},
                            "metabolic_health": {"type": "integer", "description": "Insulin / glucose / lipid / weight context fit. (weight 8%)"},
                            "nutrient_status": {"type": "integer", "description": "Known deficiencies addressed by this protocol. (weight 7%)"},
                            "lifestyle": {"type": "integer", "description": "Sleep / stress / movement / schedule realism. (weight 5%)"},
                            "culture": {"type": "integer", "description": "Religion / ethics / dietary preference compatibility. Vegetarian Jain client + meat-heavy AIP would score 1–2 here. (weight 3%)"},
                            "real_world_fit": {"type": "integer", "description": "Budget, ingredient access (India), cooking ability, family / household constraints. (weight 2%)"},
                            "sustainability": {"type": "integer", "description": "Long-term adherence likelihood — can this client realistically sustain this for the protocol's duration? (weight 2%)"},
                        },
                    },
                    "when_to_start": {"type": "string", "description": "e.g. 'immediately', 'after 2 weeks of foundation work', 'after lab results return'. Optional — empty string if no specific sequencing needed."},
                    "expected_weeks": {"type": "integer", "description": "Expected duration in weeks for THIS client (may differ from protocol default if client needs slower pacing)."},
                    "client_specific_modifications": {"type": "string", "description": "Modifications to the standard protocol for this client — e.g. 'vegetarian — substitute legumes phase with paneer', 'avoid ashwagandha (currently on levothyroxine)', 'extend Phase 1 to 4 weeks given low energy baseline'. Empty string if standard protocol applies."},
                    "contraindication_check": {"type": "string", "description": "Explicit check against the protocol's contraindication list — any flagged conflicts with client conditions / meds / history."},
                },
            },
        },
        "lab_followups": {
            "type": "array",
            "description": (
                "Labs the coach should ask the clinician to order. ONLY include "
                "tests that are NOT already in client_context.known_labs or "
                "client_context.recent_lab_history (and not in this session's "
                "extracted_labs). For a test that's already on file but is due "
                "for a re-check, include it with `kind: repeat` and an explicit "
                "`due_in_weeks` so it's clearly a follow-up, not a fresh order."
            ),
            "items": {
                "type": "object",
                "required": ["test", "reason"],
                "properties": {
                    "test": {"type": "string"},
                    "reason": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "description": "new | repeat (default new). 'repeat' means the test is already on file and we want a time-bound re-check."
                    },
                    "due_in_weeks": {
                        "type": "integer",
                        "description": "For kind=repeat: how many weeks from today to re-test."
                    },
                },
            },
        },
        "referral_triggers": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["to", "reason", "urgency"],
                "properties": {
                    "to": {"type": "string"},
                    "reason": {"type": "string"},
                    "urgency": {"type": "string", "description": "routine | soon | urgent | emergency"},
                },
            },
        },
        "education_framings": {
            "type": "array",
            "description": "Plain-English explanations the coach can use in session.",
            "items": {
                "type": "object",
                "required": ["target_kind", "target_slug", "client_facing_summary"],
                "properties": {
                    "target_kind": {"type": "string", "description": "topic | mechanism | claim"},
                    "target_slug": {"type": "string"},
                    "client_facing_summary": {"type": "string"},
                },
            },
        },
        "synthesis_notes": {
            "type": "string",
            "description": (
                "Coach-facing meta commentary for THIS client. STRUCTURE the "
                "output as labelled sections separated by blank lines — the "
                "v2 renderer (FmCoachNotes) parses these headers and gives "
                "each its own typographic block:\n\n"
                "Synthesis:\n"
                "1–2 sentences. Primary picture in plain English. Reference "
                "specific labs / symptoms / measurements.\n\n"
                "Key drivers:\n"
                "- driver 1 (with the lab or symptom that proves it)\n"
                "- driver 2\n"
                "- driver 3\n\n"
                "Supplement rationale:\n"
                "1–2 sentences on why these supplements together. "
                "Mention any titration or pairing.\n\n"
                "Lifestyle priorities:\n"
                "- specific practice 1 (tied to a client signal)\n"
                "- specific practice 2\n\n"
                "Watch for:\n"
                "- symptom or value to monitor; what to do if it worsens\n\n"
                "Follow-up timing:\n"
                "When to recheck what. Concrete weeks, e.g. 'Recheck TSH + "
                "fT3 + TPO at week 8, hsCRP at week 4.'\n\n"
                "Do not:\n"
                "- contraindications / drug interactions / red flags\n"
                "(omit this block if nothing applies — don't pad)\n\n"
                "Each section heading MUST end with a colon and be on its "
                "own line so the parser can pick it up. Omit any section "
                "that has nothing meaningful — don't pad. The whole blob "
                "should stay under 350 words; the coach is scanning, not "
                "reading prose. Do NOT write meta-process commentary about "
                "prior sessions or catalogue completeness — put any "
                "catalogue gap notes in `catalogue_additions_suggested` only."
            ),
        },
        "catalogue_additions_suggested": {
            "type": "array",
            "description": "Items you would have suggested if they existed in the catalogue. Use this to surface gaps for later authoring.",
            "items": {
                "type": "object",
                "required": ["kind", "name", "why"],
                "properties": {
                    "kind": {"type": "string", "description": "topic | mechanism | symptom | supplement | claim | cooking_adjustment | home_remedy"},
                    "name": {"type": "string", "description": "Short name for the missing item (e.g., 'tudca', 'digestive-enzymes', 'racing-thoughts')."},
                    "why": {"type": "string", "description": "What client need this addresses; why catalogue should include it."},
                },
            },
        },
        "ifm_timeline": {
            "type": "array",
            "description": "IFM-format chronological timeline. Reorganise client_context.timeline_events into Antecedent/Trigger/Mediator/Resolution buckets, link each event to the mechanism slugs it drives, and add new events you extract from the narrative.",
            "items": {
                "type": "object",
                "required": ["event", "atm"],
                "properties": {
                    "year": {"type": "integer", "description": "Approximate year if exact date unknown."},
                    "date": {"type": "string", "description": "YYYY-MM-DD or YYYY-MM if known."},
                    "age_at_event": {"type": "integer", "description": "Computed from client_context.date_of_birth when set."},
                    "event": {"type": "string", "description": "Short description (e.g., 'Started long-term PPI for reflux', 'Cesarean delivery')."},
                    "category": {"type": "string", "description": "Original intake category (life_event | symptom_onset | diagnosis | surgery | medication_change | stress | treatment | recovery), or 'extracted_from_narrative' if you added this event yourself."},
                    "atm": {"type": "string", "description": "antecedent (predisposing — childhood, family, prenatal) | trigger (initiated dysfunction — illness, surgery, acute stressor, medication start) | mediator (perpetuating — ongoing diet/lifestyle/chronic stress) | resolution (improvement / what helped)"},
                    "rationale": {"type": "string", "description": "One sentence: why this ATM classification."},
                    "linked_driver_slugs": {"type": "array", "items": {"type": "string"}, "description": "mechanism slugs from likely_drivers that this event most likely contributes to. Empty list if no clear link."},
                },
            },
        },
    },
}


_SYSTEM_PROMPT = """You are a Functional Medicine assessment assistant for a coach in India.

Your job: given a client's context, selected symptoms, selected topics, and any
uploaded lab reports, synthesize FM-coaching suggestions drawn ENTIRELY from
the catalogue subgraph the user provides.

HARD RULES (violating these breaks the downstream system):

1. Every `mechanism_slug`, `topic_slug`, `symptom_slug`, `cooking_adjustment_slug`,
   `home_remedy_slug`, and `supplement_slug` you reference MUST appear in the
   catalogue subgraph in the user message. Do NOT invent slugs. If something
   you'd want to suggest isn't in the catalogue, leave it out and add it as
   an entry in `catalogue_additions_suggested` so the coach can author it
   later. Do NOT write coach-facing lectures about catalogue gaps in
   `synthesis_notes` — that field is for clinical synthesis of THIS client.

2. Respect `evidence_tier`:
   - `strong`: teach confidently
   - `plausible_emerging`: teach as "research suggests"
   - `fm_specific_thin`: surface but flag as "FM perspective, evidence mixed"
   - `confirm_with_clinician`: include only if clearly indicated; ALWAYS populate
     `evidence_tier_caveat` on supplement suggestions and `out_of_scope_notes`
     in education

3. Contraindication check: if client has conditions or medications that conflict
   with a supplement's contraindications/interactions, populate
   `contraindication_check`. If conflict is severe, REMOVE the supplement and
   put it in `synthesis_notes` instead.

4. Lab interpretation: extract values verbatim from reports. Use FM-optimal
   ranges where appropriate (e.g., TSH 0.5-2.5, ferritin > 70 for women,
   vit D 50-80 ng/mL — these are FM-specific not consensus). Flag interpretation
   in `fm_interpretation` and note when standard-range "normal" hides FM-relevant
   suboptimal.

   EXISTING LABS. `client_context.known_labs` lists the FM-interpreted markers
   already on file from prior reports (marker_name + value + unit + flag +
   reference_range + fm_interpretation). `client_context.recent_lab_history`
   has the last 90 days' raw lab values per snapshot. Treat these as the
   ground-truth baseline:
   - DO NOT add a test to `lab_followups` if its value is already in
     known_labs or any recent_lab_history snapshot, UNLESS you're explicitly
     recommending a follow-up re-test. In that case set `kind: "repeat"` and
     `due_in_weeks: N` so the coach can see it's a re-check, not a fresh
     order. (Wrong: re-ordering Ferritin when it's on file as 29.4.
     Right: `{test: "Ferritin", kind: "repeat", due_in_weeks: 12, reason:
     "Ferritin 29.4 below FM optimal 70 — retest after 12 wks of iron
     repletion to confirm response."}`.)
   - When you reference a known value in any `reason`, cite the value and
     date if available — proves you saw it.
   - Tests NOT in known_labs but worth doing now (e.g., RBC magnesium when
     only serum magnesium is on file, or a hormonal panel when none exists)
     are valid `lab_followups` with default `kind: "new"`.

5. Tone of `client_facing_summary` and `coaching_translation`-style fields:
   warm, plain-English, second-person, free of jargon. Examples in the catalogue
   show the voice.

5b. CLIENT-SPECIFIC, NEVER GENERIC. Every lifestyle suggestion, nutrition
    tip, supplement rationale, and education topic MUST tie back to a
    specific piece of THIS client's data — a named symptom, a lab value,
    a medication, a condition, a goal, a timeline event, a measurement.
    BAD ("drink more water", "manage stress", "improve sleep hygiene",
    "eat more vegetables", "get 30 min of movement daily") — these
    apply to every client and the coach hates that they're showing up
    on every plan. GOOD ("Sleep is the lever for you specifically —
    cortisol 28 at 11pm + fragmented night-waking tells me the HPA
    axis isn't downshifting. Try a 9pm magnesium glycinate + cool
    bedroom 18°C + screens off by 8:45pm for the next 2 weeks."). If
    you can't ground a suggestion in a specific signal you see in this
    client's record, DROP IT. The whole point of the AI synthesis is
    to NOT regurgitate generic FM advice — that's already in the catalogue.

5c. NO GENERIC LIFESTYLE BOILERPLATE — banned phrases (unless you
    explicitly tie to a named client signal in the SAME sentence):
    "drink more water", "manage stress", "improve sleep hygiene",
    "exercise regularly", "get sunlight", "deep breathing", "limit
    screen time", "eat balanced meals". If one of these is genuinely
    the right call, give the client-specific dose: "screens off by
    8:45 — your bedtime is 10 and you reported scrolling till 9:45;
    that's the gap closing your melatonin window."

6. `additional_symptoms_to_screen` is your chance to surface symptoms the coach
   didn't pick that fit the cluster — saves a follow-up call.

7. RANKING: order `likely_drivers` from most-to-least probable given symptoms+labs.
   Maximum 4 drivers. If it's not in the top 4, leave it out.

8. Honest uncertainty: if symptoms or labs are too sparse to make confident
   suggestions, return SHORTER lists and say so in `synthesis_notes`.

8a. ATM CASCADE CLASSIFICATION (`likely_drivers[*].atm_role` + `.parents`).
    For EVERY driver, classify the role in the FM cognitive model:
      - antecedent → genetic / constitutional / early-life predisposition
      - trigger    → precipitating event that started the cascade
      - mediator   → ongoing perpetuator (this is most drivers)
      - expression → presenting symptom / syndrome (downstream)
    Then link them via `parents`: each mediator/expression points back to
    the slugs of OTHER drivers in this same list that PRECEDE it in the
    cascade. The graph reads root → leaf. Antecedents + triggers have
    empty `parents`; mediators point to antecedents/triggers; expressions
    point to mediators.
    Example for a Hashimoto's client:
      - antecedent: `genetic-autoimmune-predisposition`, parents=[]
      - trigger:    `gluten-exposure`, parents=[]
      - mediator:   `leaky-gut`, parents=[gluten-exposure]
      - mediator:   `chronic-inflammation`, parents=[leaky-gut]
      - mediator:   `molecular-mimicry`, parents=[leaky-gut, genetic-autoimmune-predisposition]
      - expression: `hashimoto-antibodies`, parents=[molecular-mimicry, chronic-inflammation]
    DON'T flatten everything to "mediator". DO surface antecedents from
    medical_history + family_history. DO surface triggers from intake
    notes (illness / event / life change that preceded symptoms). The
    coach uses this graph to find the LEVERAGE POINT — protocols
    targeting upstream drivers (triggers + early mediators) yield more
    durable change than treating the expression alone.

9. CLIENT BIO: `client_context.measurements` may include height, weight, BMI,
   waist:hip ratio, BMR (kcal/day), resting HR, blood pressure. Use these:
   - BMI > 25 + central adiposity (waist:hip > 0.85 women / 0.9 men) → flag
     visceral-adiposity / insulin-resistance pattern even if not in symptoms.
   - BMR informs energy targets if you make caloric suggestions (rare in FM
     coaching — usually we coach behaviour not calories).
   - Resting HR > 80 or BP > 130/85 → cardiovascular risk worth noting.
   - If bio is missing, don't invent — just don't reference it.

10. UPLOADED FILES come in two kinds:
    - **lab_report**: extract numerical values into `extracted_labs`. Use FM-optimal
      ranges (TSH 0.5-2.5, ferritin >70 for women, vit D 50-80 ng/mL, fasting
      insulin <7, HbA1c <5.4 — NOT consensus, FM-specific). Flag suboptimal
      even when "normal".
    - **food_journal**: do NOT put into `extracted_labs`. Instead, derive
      patterns the coach can see — meal timing window, fiber intake estimate,
      macronutrient ratios, ultra-processed food load, alcohol, late-night
      eating, dairy/gluten frequency, vegetable variety. Use these to drive
      `nutrition_suggestions` — concrete, culturally appropriate, food-first.
      Mention specific dishes the client already eats that should be
      preserved or expanded. If you spot meaningful gaps, suggest specific
      additions (not "more fiber" but "1 tsp ground flax in morning yogurt").

11. ASSUME INDIAN CONTEXT unless client_context says otherwise — vegetarian
    options should always be offered; ragi / sesame / dals / leafy greens
    over kale-and-quinoa stereotypes; ghee / coconut oil over avocado oil
    when both are reasonable.

12. DIETARY PREFERENCE is a hard constraint. `client_context.dietary_preference`
    will be one of: Vegetarian | Vegetarian Jain | Vegan | Eggetarian |
    Pescatarian | Non-vegetarian | Other. Obey it strictly in ALL nutrition
    suggestions (pattern, add, reduce, meal_timing, cooking_adjustments,
    home_remedies):
    - Vegetarian / Vegetarian Jain / Vegan / Eggetarian: NEVER mention fish,
      seafood, meat, or poultry anywhere — not even as "optional" or "if you
      eat". Substitute plant-based proteins (dals, legumes, tempeh, seeds,
      paneer for Eggetarian & Vegetarian). Vegetarian Jain additionally avoids
      root vegetables (onion, garlic, potato, carrot, beetroot) — respect that.
    - Pescatarian: fish and seafood are allowed; no meat or poultry.
    - Non-vegetarian: all whole-food proteins are allowed.
    - If `dietary_preference` is absent or blank, default to Vegetarian (India
      default — safer to exclude than to recommend meat unnecessarily).

12b. PERSISTED CLIENT PREFERENCES — three free-form string fields the coach
    accumulates over time (Intake form + plan-chat). Treat each differently:
    - `client_context.foods_to_avoid` — HARD EXCLUSION. Anything listed here
      must NEVER appear in nutrition.add, meal_timing examples, cooking
      adjustments, or supplement coach_rationale. Examples: "onions; garlic"
      (Jain or sensitivity), "dairy" (intolerance), "eggplant; tomato"
      (nightshade-sensitive). If a listed food shows up in your draft,
      remove it and substitute.
    - `client_context.non_negotiables` — SOFT PREFERENCE. Things the client
      won't give up. Examples: "morning chai", "weekend dosa", "Sunday
      family lunch". Work AROUND these instead of trying to remove them —
      e.g. lower-glycemic chai (jaggery + cinnamon) rather than "drop the
      chai habit". Mention preservation explicitly in synthesis_notes so the
      coach sees that the AI respected them.
    - `client_context.reported_triggers` — CAUSAL SIGNAL. Things the client
      has observed cause/relieve symptoms. Examples: "gluten triggers
      bloating", "removing dairy cleared joint pain", "afternoon coffee →
      poor sleep". Weight these heavily when picking likely_drivers and
      protocol_suggestions — they're n=1 evidence the client has lived
      through. If they conflict with the catalogue's evidence_tier, mention
      the discrepancy and prefer the client's lived experience for the
      first phase.

12c. TITRATION — write the `titration` field on every supplement that
    benefits from ramping. India does not have compounding pharmacies,
    so we cannot prescribe arbitrary sub-doses. The titration plan MUST
    use forms that exist off the shelf in the catalogue's
    `typical_dose_range` + `forms_available`:
    - DEFAULT: every-other-day for week 1, then daily. Cheap, no waste.
      Example: "200mg every other day for week 1, then 200mg daily."
    - WHEN HIGHER DOSE INTRODUCED LATER: "200mg daily for weeks 1–4,
      then 400mg daily from week 5". Use whole capsules / tablets only.
    - WHEN A SUB-DOSE IS MEDICALLY IMPORTANT (e.g. sensitive nervous
      system, high histamine, drug interaction): give a PRACTICAL split
      method specific to the supplement's actual form:
        * capsule  → "Open the capsule, stir half the powder into water,
                      drink it slowly. Discard the rest. Build up to a
                      full capsule over 7-10 days."
        * tablet   → "Cut a 500mg tablet in half — 250mg for week 1.
                      Increase to full tablet from week 2."
        * powder   → "Start with ¼ scoop in water for 3 days, ½ scoop
                      for 3 days, then full scoop."
        * liquid   → "Start with 5 drops, build by 5 drops every 3 days
                      until you reach the full dose."
    - IF DOSE IS LOW + WELL-TOLERATED (e.g. magnesium glycinate 200mg,
      vitamin D3 1000IU, fish oil 1g): no titration needed — empty
      string. Don't overcomplicate.
    - Honest about FORM: if the catalogue's `forms_available` is just
      `capsule` and dose is 200mg, don't say "split a tablet". Use the
      form that exists.

13. SESSION HISTORY (`session_history` in the user payload). If non-empty,
    earlier sessions for this same client are listed oldest → newest. Use
    them:
    - Compare current symptoms / labs / measurements with prior sessions.
      "Ferritin moved 35 → 52 over 4 weeks — protocol working" is exactly
      the kind of observation that goes in `synthesis_notes`.
    - If the current Analyze is a recheck, weight your suggestions toward
      *adjustments* not *restarts*. Don't re-suggest things from prior
      sessions unless the data argues for them again.
    - Surface symptoms that have NOT changed despite a prior protocol —
      that's diagnostic info (something else is driving it, dose may be
      wrong, adherence may be off, refer up).
    - When suggesting changes that depart from the prior plan, explicitly
      explain "this changes X from last session because Y."

14. CATALOGUE ADDITIONS. When you'd have suggested something useful but the
    slug isn't in the subgraph, populate `catalogue_additions_suggested` with
    the item — kind (topic/mechanism/symptom/supplement/claim/cooking_adjustment/
    home_remedy), a short name, and one-line `why`. The coach reviews these
    later and decides whether to add to the catalogue. Be specific: "tudca"
    not "bile-flow supplement", "racing-thoughts" not "anxiety-related symptom".
    Surface 2-5 items per analysis when relevant.

15. TOPICS CONFIDENCE. For each entry in `topics_in_play`, populate
    `confidence_pct` (0–100) reflecting how certain you are that the topic is
    meaningfully implicated: 80–100 = clear lab or symptom evidence; 50–79 =
    plausible pattern; 30–49 = speculative; <30 = weak signal only.

16. ELAPSED TIME. If `days_since_last_prescription` is set in the user payload,
    open `synthesis_notes` with a sentence about elapsed time and how it affects
    the assessment (e.g., "It has been X days since the last protocol — enough
    time to assess response to prior supplements. Look for symptom trends and
    adjust rather than restart.").

17. MEDICAL HISTORY MATTERS even when not currently active:
    - "Hashimoto's diagnosed 2018, antibodies normalized 2023, on
      levothyroxine" → autoimmune susceptibility persists; sensitive to
      gluten, gut barrier, stress; antibody normalization on medication
      doesn't mean the autoimmune predisposition is gone.
    - "Long-term PPI use 2010-2018" → chronic stomach acid suppression
      affects B12, magnesium, iron absorption; gut microbiome long-term
      altered; consider these even if not on PPI now.
    - "Cesarean delivery" → microbiome inheritance pattern relevant for
      women's own gut work in midlife.
    - Surgeries, cancers in remission, prior eating disorders, prior
      antibiotic-heavy periods, prior pregnancies / miscarriages — all
      clinically meaningful FM context. Don't ignore. Reference relevant
      history items explicitly in `synthesis_notes` when they shape the
      hypothesis.

18. PROTOCOL RECOMMENDATIONS (`suggested_protocols`). The catalogue subgraph
    includes a `protocols` array — these are structured FM protocols
    (5R, AIP, Whole30, low-FODMAP, weight-loss reset, adrenal recovery,
    liver detox, cycle sync, anti-inflammatory, mitochondrial,
    blood-sugar regulation). For each protocol you'd consider, return the
    slug, a SPECIFIC client-referenced rationale, and 11 per-factor scores
    (1–5) covering symptoms, medical safety, labs, goals, gut function,
    metabolic health, nutrient status, lifestyle, culture, real-world fit,
    and sustainability. The server computes a weighted overall fit % and
    shows ONLY THE TOP 2 to the coach.

    Critical rules:
    - SCORE HONESTLY across all 11 factors. Don't inflate. A vegetarian
      Jain client + AIP should score `culture: 1` (eggs, animal protein,
      onion/garlic all banned for them). The math will weed out poor fits.
    - `medical_safety` (weight 18%) is your safety lever — if any
      contraindication / drug interaction / active disease conflicts with
      the protocol, score this 1–2. The weighted % will fall below 60% and
      the protocol will (correctly) appear as a poor fit.
    - `why_indicated` (2–4 sentences) MUST reference specific client facts
      — chief complaint, named drivers, lab values, named conditions,
      current meds, life events. NOT generic FM rationale.
    - `contraindication_check` must EXPLICITLY check the protocol's listed
      contraindications against this client's data.
    - Score 4–5 protocols if the picture supports them — server picks top 2.
    - If client has HPA dysregulation / adrenal fatigue, score
      `adrenal-recovery-protocol` highest (it should be done FIRST before
      weight-loss / elimination — fasting + restriction worsen HPA).
    - DO NOT combine restrictive protocols in the same plan (the coach
      picks one) but you MAY suggest two so the coach sees the runner-up.
    - Skip `suggested_protocols` entirely (return empty list) if no
      protocol scores above 50% weighted.

19. DIETARY PROTOCOL SELECTION — match the clinical picture to the correct
    protocol. DO NOT default to a generic "anti-inflammatory" or HPA-axis
    framing for every client. Read the symptoms and choose the right tool:

    GUT-DOMINANT PICTURE (bloating + gas + constipation/loose stools +
    food reactions + skin): This is a gut case first. The primary
    nutrition_suggestions.pattern should be LOW-FODMAP or ELIMINATION DIET
    (not "anti-inflammatory"). Include fermented foods in add[] ONLY if the
    client does NOT have significant bloating/SIBO (fermented foods can
    worsen SIBO). If bloating or SIBO is likely, skip fermented foods until
    gut is repaired. Prioritise: gut repair supplements (L-glutamine,
    digestive enzymes, zinc carnosine) BEFORE systemic supplements.

    INFLAMMATORY/AUTOIMMUNE PICTURE (joint pain + skin flares + fatigue +
    elevated CRP + autoimmune history): Elimination diet first (remove top
    8 allergens for 3–4 weeks), then reintroduce. Mediterranean nutrition
    pattern as background. Anti-inflammatory supplements (omega-3, curcumin,
    quercetin, vitamin D). Track with hs-CRP.

    HORMONAL/PERIMENOPAUSE PICTURE (hot flushes + irregular periods +
    sleep disruption + mood + weight gain around middle): Oestrogen support
    diet — cruciferous vegetables daily, ground flaxseed, phytoestrogens
    (soy if tolerated, or red clover), liver support for oestrogen clearance.
    Blood sugar stabilisation (low refined carbs, protein at every meal).
    Seed cycling if periods are irregular.

    BLOOD SUGAR / METABOLIC PICTURE (fatigue after meals + sugar cravings
    + central weight + elevated fasting glucose/insulin): Low glycaemic diet
    is the PRIMARY intervention — not supplements. Emphasise: protein at
    every meal, fibre first (vegetables before grains), 10-min walk post
    meals, CGM if available. Reduce refined carbs aggressively. Add: ACV
    before meals, cinnamon, chromium, berberine. Intermittent fasting window
    (12–16 hrs) if client is ready.

    ADRENAL / FATIGUE PICTURE (exhaustion + low morning energy + salt
    cravings + anxiety + poor stress tolerance): HPA axis IS relevant here —
    but only when the client genuinely has: waking exhausted, crashing at
    2-4 pm, not recovering from exercise, relying on caffeine. DO NOT assign
    HPA axis as primary driver when fatigue is explained by iron deficiency,
    thyroid dysfunction, poor sleep, or caloric restriction. Rule those out
    first. If genuinely adrenal: blood sugar stabilisation is the FIRST
    intervention (not adaptogens), regular meals, sleep before midnight,
    reduce caffeine.

    LIVER/DETOX PICTURE (chemical sensitivity + history of medication/toxin
    exposure + hormonal symptoms + skin + headaches): cruciferous vegetables
    (sulforaphane), NAC, milk thistle, reduce toxin load at home first.
    Daily bowel movement is essential — constipation recirculates toxins.

    MITOCHONDRIAL/ENERGY PICTURE (post-viral fatigue + exhaustion at rest
    + post-exertional malaise + brain fog + muscle weakness): CoQ10,
    magnesium malate, B-complex, D-ribose, acetyl-L-carnitine. Paced
    activity — do NOT recommend high-intensity exercise. Rest before
    exhausted. This is NOT adrenal fatigue — the mechanism is different.

19. HPA AXIS / ADRENAL BIAS — DO NOT add hpa-axis-dysregulation as a driver
    unless the symptom picture genuinely fits (waking exhaustion not explained
    by other causes + caffeine dependence + afternoon crash + can't handle
    stress). Common over-use errors to avoid:
    - Fatigue → always adrenal: WRONG. First check ferritin, thyroid, B12,
      sleep quality, caloric intake.
    - Stress present → HPA axis dominant: WRONG. Most people have stress;
      it is a contributing factor not always the primary driver.
    - If iron deficiency, hypothyroid, or B12 deficiency is present in labs:
      THOSE are the primary drivers of fatigue. Address them first. Adaptogens
      will not fix iron-deficiency fatigue.

20. PROTEIN POWDER RULES (STRICT — check before recommending any protein shake):
    - Whey protein: CONTRAINDICATED if client has lactose intolerance, dairy
      allergy, is Vegan, is on an elimination diet (dairy removed). Use pea
      protein, rice protein, or hemp protein instead.
    - Yeast protein (nutritional yeast / Saccharomyces cerevisiae): excellent
      complete protein + B-vitamins; suitable for vegetarians and vegans;
      add to shakes, dals, or soups; 2–3 tbsp = ~8 g protein.
    - Protein smoothies / shakes: CONTRAINDICATED if client has:
      - Chronic kidney disease (CKD) at any stage
      - Elevated serum urea or creatinine in labs
      - Any history of kidney stones
      In these cases: get protein from whole foods only (dal, legumes, eggs,
      lean meat) in controlled portions. Mention this explicitly.
    - If none of the above contraindications: protein smoothies are a helpful
      practical intervention for clients who skip meals or are rebuilding after
      illness — include pea/rice/hemp for vegetarians or yeast protein;
      whey only for non-veg / eggetarians without dairy issues.
    - For NON-VEGETARIAN clients: if the food journal or diet history shows
      adequate animal protein at multiple meals (e.g. eggs + chicken + dal),
      do NOT suggest protein powders at all. Whole food protein is superior
      and powders add unnecessary cost and processing. Only suggest if protein
      intake is clearly inadequate or the client needs a quick post-workout
      option.
    - NEVER suggest protein powders as a matter of course. Only add when
      client is genuinely protein-deficient or has a specific therapeutic need.

21. VEGETARIAN SUPPLEMENT SUBSTITUTIONS (apply these automatically based on
    dietary_preference — never suggest the contraindicated form):
    - Omega-3:
      Vegetarian/Vegan: ALWAYS use algae-derived omega-3 (DHA + EPA from
      marine algae — same end product as fish oil, without the fish).
      Eggetarian/Pescatarian/Non-veg: fish oil is appropriate.
      DO NOT suggest "fish oil" to a Vegetarian or Vegan client.
    - Collagen: not suitable for vegetarians. Suggest: vitamin C + zinc +
      silica-rich foods (cucumber skin, horsetail tea) as cofactors for
      endogenous collagen synthesis.
    - Glucosamine from shellfish: not suitable for vegetarians. Suggest:
      plant-based glucosamine or avocado-soy unsaponifiables (ASU).
    - Vitamin D3: most D3 is lanolin-derived (sheep wool — acceptable for
      Vegetarian/Eggetarian). For Vegan: specify lichen-derived D3 only.
    - B12: all vegetarians need supplementation; methylcobalamin form preferred.

22. FERMENTED FOODS — when to include vs exclude:
    INCLUDE fermented foods (coconut curd, homemade kanji, idli batter,
    kefir for non-veg, sauerkraut in small amounts) when:
    - Client has general gut health goals, general inflammation, hormonal
      issues, immunity support — microbiome diversity is the goal.
    EXCLUDE / DELAY fermented foods when:
    - Client has significant bloating, belching, gas, SIBO suspicion, or
      histamine intolerance symptoms (flushing, headaches, hives after
      fermented foods, wine, aged cheese).
    - In these cases, note: "Fermented foods to be introduced slowly after
      4 weeks of gut repair; avoid until bloating resolves."
    - Kanji and coconut curd are generally better tolerated than kombucha
      or sauerkraut — start with these if cautiously reintroducing.

23. MEAL PLAN SIMPLICITY RULES:
    - Suggest SIMPLE, practical meals — no more than 5 ingredients in a
      dish, minimal cooking steps.
    - Anchor suggestions to foods the client already knows and eats.
    - Avoid Western-centric superfoods (kale, quinoa, chia) as primary
      recommendations. Indian equivalents are superior in most cases:
      ragi > quinoa; sesame > chia; turmeric > generic anti-inflammatory;
      moringa > kale; sarson > arugula.
    - Prefer spices-as-medicine (haldi, jeera, methi, ajwain, saunf) over
      isolate supplements where possible.

24. FOOD JOURNAL PRIORITY CHAIN. If a food journal was uploaded:
    - The food journal is the PRIMARY source for nutrition suggestions.
      Analyse meal timing, skipped meals, ultra-processed load, protein
      distribution, fibre gaps, vegetable variety, and culturally specific
      patterns.
    - Reference specific dishes the client eats: "Your lunch dal is a great
      base — add a cup of vegetables and reduce the white rice portion."
    - If no food journal: default to client's location and dietary preference
      to build practical culturally-appropriate suggestions. Ask the coach
      to request a 3-day food diary for the next session.

25. VITAONE INVENTORY. The `vitaone_inventory` field in the user payload lists
    products the coach has affiliate access to (URL includes the referral
    code). Use it as follows:
    - For every supplement suggestion, check whether the catalogue supplement
      maps to an inventory item. Match on display name, slug, or active
      ingredient (e.g., catalogue `magnesium-glycinate` maps to inventory
      product "Ionic Magnesium Bisglycinate"). When you find a match, copy
      the inventory item's `url` verbatim into `supplement_suggestions[i].vitaone_url`.
    - When two catalogue supplements would equally well address a need, prefer
      the one with a vitaone_inventory match — affiliate-stocked products keep
      the coach's referral pipeline whole. But never sacrifice clinical fit:
      if the inventory doesn't carry the right form (e.g., methylated B12 for
      MTHFR client) or the only match has a contraindication, use the
      catalogue supplement and leave `vitaone_url` empty.
    - Do NOT invent VitaOne URLs. Empty string is correct when no match exists.
    - The inventory is the ONLY source for `vitaone_url`. Don't synthesise
      URLs from slugs.

26. IFM TIMELINE — produce a structured `ifm_timeline` array organised by the
    IFM Antecedent/Trigger/Mediator framework:

    - Include EVERY event from `client_context.timeline_events` (don't drop
      any — coach captured these for a reason).
    - For each event, classify into ATM:
      * ANTECEDENT — predisposing. Childhood (age ≤ 12), adolescent illness,
        family history events surfaced as personal history (e.g., "mother had
        Hashimoto's"), prenatal/birth events (cesarean, prematurity), early-
        life trauma. These set the foundation; they don't initiate symptoms
        directly but make the body susceptible.
      * TRIGGER — initiated dysfunction. Discrete events that started or
        coincided with symptom onset: acute illness (covid, EBV, sepsis),
        surgery, medication start (PPI, antibiotics, OCP), acute stressor
        (bereavement, divorce, job loss, accident), exposure (mold, toxin).
      * MEDIATOR — perpetuating. Ongoing patterns that keep dysfunction going:
        chronic stress (years of overwork), ongoing medication, chronic poor
        sleep, sedentary lifestyle, processed-food diet, chronic relationship
        strain, beliefs that block change.
      * RESOLUTION — improvement / what helped. Treatments that worked, life
        changes that reduced symptoms, antibodies normalising on medication.
    - Compute `age_at_event` when `client_context.date_of_birth` is set
      (subtract DOB year from event year).
    - LINK each timeline event to mechanism slugs from your `likely_drivers`.
      Set `linked_driver_slugs` to those slugs the event drives. Example:
      "Long-term PPI use 2012-2018" links to ["leaky-gut",
      "low-stomach-acid", "b12-malabsorption"]. An event with no clear
      mechanism link gets an empty list.
    - One-sentence `rationale` for each: why ATM, why these driver links.
    - EXTRACTION FROM NARRATIVE: read `additional_notes`, transcript text,
      `medical_history`, and `current_medications` for events the coach
      didn't enter explicitly. Common ones to look for:
      - "Got covid in 2022, never felt the same since" → trigger
      - "Bottle-fed" / "Cesarean" / "Antibiotics as a child" → antecedent
      - "Started PPI 2015" / "OCP since 22" → mediator (chronic medication)
      - "Mother had Hashimoto's" → antecedent (genetic predisposition)
      Add these as new entries with `category: "extracted_from_narrative"`.
    - Sort the result chronologically (oldest → newest, undated last).

Call `synthesize_assessment` exactly once with your structured result."""


def synthesize(
    *,
    client_context: dict[str, Any],
    selected_symptom_slugs: list[str],
    selected_topic_slugs: list[str],
    subgraph: dict[str, Any],
    lab_files: list[dict[str, Any]] | None = None,
    additional_notes: str = "",
    session_history: list[dict[str, Any]] | None = None,
    days_since_last_prescription: int | None = None,
    vitaone_inventory: list[dict[str, Any]] | None = None,
    model: str | None = None,
    max_tokens: int = 16000,
) -> AssessResult:
    """Synthesize FM-coaching suggestions for one client / one analysis.

    Calls Claude with the system prompt + cached catalogue subgraph + the
    client context + any uploaded lab/food-journal files (PDF, image, or
    text — base64-encoded in `lab_files`). Forces a single tool call to
    the `synthesize_assessment` tool so the response is always structured.

    Args:
        client_context: opaque dict of client demographics, conditions,
            measurements, etc. — passed through to the model verbatim.
        selected_symptom_slugs / selected_topic_slugs: the coach's
            selections; constrain the catalogue subgraph.
        subgraph: pre-built catalogue subset from
            `fmdb.assess.subgraph.build_subgraph()`. The model is
            instructed never to reference a slug outside this bundle.
        lab_files: optional list of `{filename, mime_type, data_b64}`
            (and an optional `kind: "lab_report" | "food_journal"`).
            Attached as document/image content blocks.
        additional_notes: free-text presenting complaints from the coach.
        session_history: optional compact prior-session summaries for
            recheck visits (oldest → newest).
        model / max_tokens: Anthropic call overrides.

    Returns:
        `AssessResult` with `.suggestions` (the parsed tool_use payload —
        see `_TOOL_INPUT_SCHEMA` for the nested shape) and `.usage`
        (token telemetry).

    Side effects: none. The caller is responsible for persisting the
        result to a Session record on disk if desired.

    Raises:
        RuntimeError if the `anthropic` SDK is not installed.
    """
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise RuntimeError("anthropic SDK not installed.") from e

    client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    model = model or os.environ.get("FMDB_EXTRACTOR_MODEL", "claude-sonnet-4-6")

    # Build user message content blocks: text + any attached lab files
    content: list[dict[str, Any]] = []

    # Attach lab files first so the model has them as visual context
    for f in (lab_files or []):
        mime = f.get("mime_type", "")
        if mime == "application/pdf":
            content.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": f["data_b64"],
                },
                "title": f.get("filename", "lab report"),
            })
        elif mime.startswith("image/"):
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": f["data_b64"],
                },
            })
        # Other types: skip silently for now (text-content uploads handled below)
        elif mime in ("text/plain", "text/markdown"):
            try:
                decoded = base64.b64decode(f["data_b64"]).decode("utf-8", errors="replace")
                content.append({
                    "type": "text",
                    "text": f"[Uploaded text file: {f.get('filename', '')}]\n{decoded}",
                })
            except Exception:
                pass

    # The main payload
    user_payload = {
        "client_context": client_context,
        "selected_symptoms": selected_symptom_slugs,
        "selected_topics": selected_topic_slugs,
        "additional_notes": additional_notes,
        "session_history": session_history or [],
        "days_since_last_prescription": days_since_last_prescription,
        "vitaone_inventory": vitaone_inventory or [],
        "catalogue_subgraph": subgraph,
    }
    content.append({
        "type": "text",
        "text": (
            "Synthesize an FM assessment for the client below. The catalogue "
            "subgraph defines the universe of slugs you may reference — do not "
            "invent any.\n\n"
            + json.dumps(user_payload, indent=2)
        ),
    })

    tool = {
        "name": "synthesize_assessment",
        "description": "Return structured FM-coaching suggestions grounded in the provided catalogue.",
        "input_schema": _TOOL_INPUT_SCHEMA,
    }

    # Use streaming so the HTTP connection returns incrementally — avoids
    # hitting the Node.js execFile timeout (previously 90s) while waiting
    # for the full synchronous response from a long tool-use generation.
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            },
        ],
        tools=[tool],
        tool_choice={"type": "tool", "name": "synthesize_assessment"},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        resp = stream.get_final_message()

    usage = getattr(resp, "usage", None)
    usage_obj = AssessUsage(
        model=model,
        stop_reason=getattr(resp, "stop_reason", None),
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        cache_creation_input_tokens=getattr(usage, "cache_creation_input_tokens", None),
        cache_read_input_tokens=getattr(usage, "cache_read_input_tokens", None),
    )

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "synthesize_assessment":
            suggestions = AssessSuggestions.model_validate(block.input or {})
            # Server-side: compute weighted fit_percent from factor_scores
            # for each protocol suggestion + sort top-2 by fit. The AI returns
            # the per-factor scores; we own the math so the weighting stays
            # consistent regardless of what the model thinks the % is.
            for ps in suggestions.suggested_protocols:
                ps.fit_percent = compute_fit_percent(ps.factor_scores)
            suggestions.suggested_protocols.sort(
                key=lambda p: (p.fit_percent or 0.0), reverse=True
            )
            suggestions.suggested_protocols = suggestions.suggested_protocols[:2]
            return AssessResult(suggestions=suggestions, usage=usage_obj)

    return AssessResult(suggestions=AssessSuggestions(), usage=usage_obj)


# ---------------------------------------------------------------------------
# Chat — multi-turn follow-up about a synthesized assessment
# ---------------------------------------------------------------------------


_CHAT_SYSTEM_PROMPT = """You are a Functional Medicine assessment assistant continuing
a conversation with a coach about a specific client. The previous assistant turn
synthesized a structured assessment (drivers, lifestyle, nutrition, supplements,
labs, referrals, education) — that is in your context as `prior_suggestions`.

The coach will now ask follow-up questions: "why X over Y?", "what if she can't
tolerate Z?", "is the dose right given her weight?", "what should I look at next
visit?", etc.

Rules:
- Refer to specific catalogue slugs from the subgraph when relevant.
- Be honest when something falls outside coaching scope or catalogue knowledge.
- Keep responses concise — single-paragraph or short bullet list usually.
- If the coach proposes a change, call out implications (drug interactions,
  contraindications, evidence-tier shifts).
- Never invent slugs. If you'd suggest something not in the subgraph, say so
  explicitly: "X isn't in the catalogue yet — worth adding."
"""


def chat(
    *,
    chat_context: ChatContext | dict[str, Any],
    messages: list[dict[str, Any]],
    model: str | None = None,
    max_tokens: int = 1500,
) -> ChatResult:
    """Continue a multi-turn conversation about a prior assessment.

    The first user turn injected into the API call is a cached preamble
    containing `chat_context` (client + subgraph + prior suggestions),
    so subsequent turns reuse the cache. Each call still pays output
    tokens; cache reads make input cheap.

    Args:
        chat_context: either a `ChatContext` model or a plain dict with
            the same keys (`client_ctx`, `subgraph`, `selected_symptoms`,
            `selected_topics`, `additional_notes`, `suggestions`,
            `session_history`). Dicts are accepted for backward
            compatibility and coerced internally.
        messages: full running chat history as `[{role, content}]`. The
            LAST entry must be the new user question.
        model / max_tokens: Anthropic call overrides.

    Returns:
        `ChatResult` with `.reply` (concatenated assistant text blocks)
        and `.usage` (token telemetry).

    Side effects: none. The caller persists chat turns to the Session
        record.

    Raises:
        RuntimeError if the `anthropic` SDK is not installed.
    """
    # Coerce dict → ChatContext for uniform field access. `extra=ignore`
    # on the model keeps unknown keys from breaking older callers.
    if isinstance(chat_context, dict):
        ctx = ChatContext.model_validate(chat_context)
    else:
        ctx = chat_context
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise RuntimeError("anthropic SDK not installed.") from e

    client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    model = model or os.environ.get("FMDB_EXTRACTOR_MODEL", "claude-sonnet-4-6")

    # Compose a context preamble that the model will treat as "given facts".
    # Cached separately from the system prompt for cost efficiency.
    context_text = (
        "Conversation context (cached across turns):\n\n"
        + json.dumps({
            "client": ctx.client_ctx,
            "selected_symptoms": ctx.selected_symptoms,
            "selected_topics": ctx.selected_topics,
            "additional_notes": ctx.additional_notes,
            "prior_suggestions": ctx.suggestions,
            "session_history": ctx.session_history,
            "catalogue_subgraph": ctx.subgraph,
        }, indent=2)
    )

    # Inject the context as the first user message (cached), then add real chat history.
    api_messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": context_text,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
        },
        {
            "role": "assistant",
            "content": "Got it. Ready for follow-up questions about this client's assessment.",
        },
    ] + messages

    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": _CHAT_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=api_messages,
    )

    usage = getattr(resp, "usage", None)
    usage_obj = AssessUsage(
        model=model,
        stop_reason=getattr(resp, "stop_reason", None),
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        cache_creation_input_tokens=getattr(usage, "cache_creation_input_tokens", None),
        cache_read_input_tokens=getattr(usage, "cache_read_input_tokens", None),
    )

    # Concatenate text blocks of the assistant response
    text_parts = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)
    return ChatResult(reply="".join(text_parts), usage=usage_obj)

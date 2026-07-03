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
from pathlib import Path
from typing import Any

from .results import AssessResult, AssessUsage, AssessSuggestions, ChatContext, ChatResult, compute_fit_percent


# ── v0.74 — drug catalogue loader (alias-aware) ────────────────────────────
# Reads fm-database/data/drug_depletions/*.yaml once per process. The
# entries' condition_implications + protocol_cautions are surfaced to the
# Assess synthesiser so drug → diagnosis + drug → constraint reasoning
# happens server-side, not implicit in the model's training. Same logic is
# duplicated in scripts/render-client-letter.py (letter prompts) and
# scripts/intake-token-action.py (intake submit handler) — keeping the
# implementations parallel is intentional for now; lift to a shared
# Python module if a third caller appears.

_DRUG_INDEX_CACHE: list[dict[str, Any]] | None = None


def _load_drug_catalogue() -> list[dict[str, Any]]:
    """Load every drug_depletions/*.yaml once and cache it."""
    global _DRUG_INDEX_CACHE
    if _DRUG_INDEX_CACHE is not None:
        return _DRUG_INDEX_CACHE
    import yaml  # type: ignore
    out: list[dict[str, Any]] = []
    cat_dir = Path(__file__).resolve().parent.parent.parent / "data" / "drug_depletions"
    if cat_dir.exists():
        for p in cat_dir.glob("*.yaml"):
            if p.name.startswith("_"):
                continue
            try:
                d = yaml.safe_load(p.read_text()) or {}
                if isinstance(d, dict):
                    out.append(d)
            except Exception:
                continue
    _DRUG_INDEX_CACHE = out
    return out


def _collect_drug_context(client_ctx: dict[str, Any]) -> dict[str, Any]:
    """For each med on the client, return matched drug-catalogue entries with
    `condition_implications` and `protocol_cautions` flattened for AI use.

    Output shape:
      {
        "matched": [
          {
            "matched_medication": "Janumet 50/500 BD",
            "drug_slug": "metformin",
            "drug_name": "Metformin",
            "condition_implications": [{label, confidence, rationale, topic_slug}],
            "protocol_cautions": [{kind, item, severity, reason}],
            "depletes": [{nutrient, severity, ...}],
          }, ...
        ],
        "unmatched_meds": ["Estrogen patch", ...],   # for AI awareness
      }
    """
    drugs = _load_drug_catalogue()
    if not drugs:
        return {"matched": [], "unmatched_meds": []}

    # Flatten client meds → list of strings (handle dict-shaped repeaters too).
    meds: list[str] = []
    raw = client_ctx.get("current_medications") or client_ctx.get("medications") or []
    if isinstance(raw, list):
        for m in raw:
            if isinstance(m, dict):
                n = (m.get("name") or "").strip()
                if n: meds.append(n)
            elif m:
                meds.append(str(m))
    elif raw:
        meds.append(str(raw))

    # Also include layered medication categories captured at intake
    # (thyroid_medication, glp1_medications, acid_suppressants, statins_bp_diabetes,
    # psych_medications, …). These live under `medications_layered` and would
    # otherwise be invisible to drug-depletion / condition-implication matching —
    # e.g. Thyronorm sits here, not in current_medications.
    layered = client_ctx.get("medications_layered") or {}
    if isinstance(layered, dict):
        for entries in layered.values():
            if not isinstance(entries, list):
                continue
            for m in entries:
                if isinstance(m, dict):
                    n = (m.get("name") or "").strip()
                    if n:
                        meds.append(n)
                elif m:
                    meds.append(str(m))

    def match_drug(med_text: str) -> dict[str, Any] | None:
        text = med_text.lower()
        best: tuple[int, dict[str, Any]] | None = None
        for d in drugs:
            aliases = [d.get("drug_name") or ""] + list(d.get("drug_aliases") or [])
            for a in aliases:
                a = (a or "").strip().lower()
                if a and a in text and (best is None or len(a) > best[0]):
                    best = (len(a), d)
        return best[1] if best else None

    matched_out: list[dict[str, Any]] = []
    unmatched: list[str] = []
    seen_slugs: set[str] = set()
    for med in meds:
        drug = match_drug(med)
        if not drug:
            unmatched.append(med)
            continue
        slug = drug.get("slug") or ""
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        matched_out.append({
            "matched_medication": med,
            "drug_slug": slug,
            "drug_name": drug.get("drug_name") or slug,
            "condition_implications": drug.get("condition_implications") or [],
            "protocol_cautions": drug.get("protocol_cautions") or [],
            "depletes": drug.get("depletes") or [],
        })
    return {"matched": matched_out, "unmatched_meds": unmatched}


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
                    "intake_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Short coach-readable phrases citing the intake observations that justified this driver. Populate WHEN client_context.intake_insights or any structured intake field (medications, COVID history, environmental exposures, bowel pattern, etc.) drove this inference. Each entry should be a single observation, e.g. 'PPI use 3+ years (acid_suppressants)', 'Wakes at 3am consistently (wake_time_pattern)', 'On Ozempic 0.5mg weekly (glp1_medications)'. Empty list when this driver came from symptoms or labs only with no intake contribution. The coach reads these inline as a 💡 audit chip; she can edit / remove freely.",
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
                    "intake_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Short coach-readable phrases citing the intake observations that justified this practice (see likely_drivers.intake_evidence for the convention). Empty list when not intake-driven.",
                    },
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
                    "start_week": {"type": "integer", "description": "Which protocol week this supplement is INTRODUCED (default 1). STAGE the protocol — never dump every supplement on the client at week 1. Week 1 carries ONLY the foundational items (magnesium, vitamin D, the core gut / calming basics) — aim for 3-5 supplements max at week 1. Layer the remaining supplements in at weeks 3, 5, 7 as the client adapts and the gut settles. Order by dependency: gut-prep and minerals first, then targeted / methylation / detox support once foundations are tolerated. A client should never be asked to START more than ~5 supplements in the same week. Use 1 only for genuinely foundational supplements; everything else gets a later week."},
                    "titration": {"type": "string", "description": "How the client ramps to the target dose. CRITICAL: India has no compounding pharmacies, so titrate using what's available off the shelf. Use the catalogue's typical_dose_range + forms_available + dosage info to know what comes in what strength. If you need a sub-dose: (a) every-other-day → daily (simplest, default), or (b) when split-dose is medically important: 'Open the capsule and stir half the powder into water, drink it; discard the rest' OR 'split a 500mg tablet in half'. Be specific to THIS supplement's actual format. Empty string when the dose can be taken as-is from day 1."},
                    "rationale": {"type": "string"},
                    "evidence_tier_caveat": {"type": "string", "description": "If catalogue tier is fm_specific_thin or confirm_with_clinician, surface that."},
                    "contraindication_check": {"type": "string", "description": "Any flagged conflicts with client meds/conditions. For supplements the client is ALREADY taking (per client_context.current_supplements), this is where you call out interactions with current_medications, inappropriate-for-profile concerns (e.g. high-dose iron without confirmed deficiency, ashwagandha + thyroid meds), or duplicate/poly-pharmacy issues. Empty string if no concerns."},
                    "is_existing": {"type": "boolean", "description": "True when this supplement is in client_context.current_supplements — i.e. the client is already taking it. The coach uses this to render a 'continue' or 'adjust' badge instead of a 'new' badge."},
                    "continue_or_change": {"type": "string", "enum": ["new", "continue", "adjust", "stop"], "description": "When is_existing=true, declare the decision: 'continue' (keep as-is), 'adjust' (form/dose/timing change), or 'stop' (contraindication / inappropriate / duplicate). For brand-new recommendations use 'new'."},
                    "vitaone_url": {"type": "string", "description": "If this supplement maps to a product in `vitaone_inventory`, set this to that product's `url` verbatim. Empty string when no VitaOne match exists. The coach uses this to point clients at the affiliate-stocked product."},
                    "intake_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Short coach-readable phrases citing the intake observations that justified this supplement (see likely_drivers.intake_evidence for the convention). Examples: 'PPI use (acid_suppressants) → B12 + Mg depletion suspected', 'Hair widening part (hair_loss_pattern) → iron / ferritin', 'On GLP-1 (glp1_medications) → digestive bitters / enzymes'. Empty list when not intake-driven.",
                    },
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
                    "intake_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Short coach-readable phrases citing the intake observations that justified ordering this lab (see likely_drivers.intake_evidence for the convention). Examples: 'Sister has Hashimoto's at 32 (family_history)', 'Long-COVID brain fog (covid_long_symptoms)', 'On levothyroxine (thyroid_medication) — TPO + reverse T3 for completeness'. Empty list when not intake-driven.",
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
                "Coach-facing meta commentary for THIS client, written as "
                "STRUCTURED MARKDOWN with H2 (`##`) section headings and "
                "simple `-` bullet lists. The coach scans this on the plan "
                "page — subheadings + bullets, never a wall of prose.\n\n"
                "Use EXACTLY these five section headings (in this order, "
                "omit any section that genuinely has nothing to say — "
                "don't pad):\n\n"
                "## Why this plan\n"
                "- 2–4 bullets. Primary clinical picture in plain English. "
                "Reference specific labs / symptoms / measurements that "
                "drove this plan.\n\n"
                "## Key drivers identified\n"
                "- driver 1: 1-line rationale (the lab or symptom that "
                "proves it)\n"
                "- driver 2: 1-line rationale\n"
                "- driver 3: 1-line rationale\n\n"
                "## Why these supplements\n"
                "- supplement_slug: 1-line rationale (why now, what it "
                "targets, any pairing/titration note)\n"
                "- supplement_slug: 1-line rationale\n\n"
                "## What to monitor\n"
                "- symptom or lab value to watch; concrete recheck timing "
                "(e.g. 'Recheck TSH + fT3 + TPO at week 8')\n"
                "- what to do if a value worsens\n\n"
                "## Coach reminders\n"
                "- contraindications / drug interactions / red flags / "
                "ATM-triad notes / scope flags / client-specific cautions\n"
                "(omit this entire section if nothing applies)\n\n"
                "FORMAT RULES:\n"
                "- Headings MUST start with `## ` (two hash + space) on "
                "their own line so the markdown renderer picks them up.\n"
                "- Use only `-` bullets at one level of nesting. No "
                "deeper sub-bullets. No numbered lists.\n"
                "- Don't pepper bold/italic everywhere; let the heading "
                "carry the structure.\n"
                "- Whole blob under ~350 words. Coach is scanning.\n"
                "- Do NOT write meta-process commentary about prior "
                "sessions or catalogue completeness — put any catalogue "
                "gap notes in `catalogue_additions_suggested` only."
            ),
        },
        "ayurveda": {
            "type": "object",
            "description": (
                "Ayurvedic constitution + plan layer. POPULATE ONLY when "
                "client_context.ayurveda_enabled is true; otherwise OMIT this "
                "key entirely. Scope is lifestyle-coaching ONLY — never "
                "bhasmas, panchakarma (vaman/virechan/basti/rakta moksha), "
                "gem/metal/colour therapy, or anything needing a vaidya."
            ),
            "properties": {
                "vata_score": {"type": "integer", "description": "0-100 CURRENT-STATE (vikruti) Vata load, inferred from the client's current intake (sleep, bowel, skin, hair, thermal, energy, stress, cycle, weight-trend). vata+pitta+kapha ≈ 100."},
                "pitta_score": {"type": "integer", "description": "0-100 current-state Pitta load."},
                "kapha_score": {"type": "integer", "description": "0-100 current-state Kapha load."},
                "vikruti_label": {"type": "string", "description": "Current imbalance in plain Ayurvedic terms, e.g. 'Vata strongly aggravated, secondary Kapha heaviness'. ALWAYS derive from current intake data."},
                "vikruti_doshas": {"type": "array", "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]}, "description": "The currently-AGGRAVATED dosha(s), most-aggravated first. This drives the plan-checker's remedy-safety flag, so be accurate. e.g. ['vata','kapha']."},
                "prakruti_label": {"type": "string", "description": "Lifelong CONSTITUTION (coach confirms). If client_context.dosha_self_assessment (the lifelong-frame quiz) is non-empty, derive by tallying its picks. If it's EMPTY, still give a PROVISIONAL best-read suggestion from lifelong-leaning signals (constitutional build from height/weight/BMI, long-standing conditions, skin/hair tendencies, notes) — the coach wants a starting point, not a blank. Lean on STABLE lifelong patterns, not acute current symptoms (those are vikruti). Leave empty only when there is genuinely no signal."},
                "prakruti_confidence": {"type": "string", "enum": ["pending_quiz", "low", "moderate", "high"], "description": "From the quiz → 'moderate'/'high' by answer consistency. Provisional inference (no quiz) → 'low'. 'pending_quiz' (with empty label) ONLY when there is no signal at all to suggest from."},
                "agni_state": {"type": "string", "enum": ["sama", "vishama", "tikshna", "manda", ""], "description": "Digestive fire: sama=balanced, vishama=irregular/variable (Vata), tikshna=sharp/excess (Pitta), manda=slow/heavy (Kapha). '' if unclear."},
                "ama_present": {"type": "boolean", "description": "Signs of ama (undigested metabolic residue): bloating, tongue coating, heaviness, sluggishness, incomplete evacuation, brain fog."},
                "ama_note": {"type": "string", "description": "Which ama signs are present. Empty if none."},
                "evidence": {
                    "type": "array",
                    "description": "Cite EVERY dosha read to a specific client_context source field — this keeps it educate-not-diagnose and lets the coach audit/correct.",
                    "items": {
                        "type": "object",
                        "required": ["trait", "dosha", "source_field"],
                        "properties": {
                            "trait": {"type": "string", "description": "The observed trait, e.g. 'inverted sleep / insomnia'."},
                            "dosha": {"type": "string", "enum": ["vata", "pitta", "kapha"]},
                            "observation": {"type": "string", "description": "The actual client value."},
                            "source_field": {"type": "string", "description": "The client_context field this came from, e.g. 'sleep_notes', 'bristol_stool_typical', 'dosha_self_assessment'."},
                        },
                    },
                },
                "dual_root_cause_note": {"type": "string", "description": "Express the client's FM root cause ALSO in Ayurvedic vocabulary, one sentence — e.g. 'HPA-axis/circadian dysregulation + gut dysbiosis = Vata derangement of the daily rhythm with vishama agni and ama.' Empty if no clear root."},
                "advisory": {"type": "string", "description": "Coach-facing flag. When prakruti_confidence is 'low' or 'pending_quiz', set a ONE-LINE advisory telling the coach the constitution read is too weak to anchor a constitution-specific plan — recommend confirming it via the dosha quiz first, OR reconsidering whether to include the Ayurveda layer for this client yet. Empty string when prakruti_confidence is 'moderate'/'high'."},
                "section": {
                    "type": "object",
                    "description": "The draft Plan.ayurveda the coach will edit, then it flows into consolidated + lifestyle_guide letters. Lifestyle scope only.",
                    "properties": {
                        "current_imbalance": {"type": "string", "description": "= vikruti_label (coach-editable copy)."},
                        "balancing_focus": {"type": "string", "description": "Warm, client-facing one-liner. No clinical jargon — this is read by the client."},
                        "dietary_guidance": {"type": "string", "description": "Dosha-aware six-tastes / qualities guidance for THIS client's vikruti. If vikruti includes Kapha, keep portions light/warm even while pacifying Vata — don't pile on heavy/oily foods."},
                        "dinacharya": {
                            "type": "array",
                            "description": "Daily-routine practices that pacify the aggravated dosha(s).",
                            "items": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}, "cadence": {"type": "string"}, "details": {"type": "string"}}},
                        },
                        "remedy_slugs": {"type": "array", "items": {"type": "string"}, "description": "MUST be home_remedy slugs from the catalogue subgraph. Pick ONLY remedies whose `balances_dosha` covers an aggravated dosha AND whose `aggravates_dosha` does NOT intersect vikruti_doshas — never recommend a remedy that worsens a dosha the client is already high in (the plan-checker will flag it otherwise)."},
                        "seasonal_note": {"type": "string", "description": "Ritucharya — adjust for the current season and the client's city/country."},
                    },
                },
            },
        },
        "tissue_salts": {
            "type": "object",
            "description": (
                "Schüssler / biochemic tissue-salt plan layer. POPULATE ONLY "
                "when client_context.schussler_salts_enabled is true; otherwise "
                "OMIT this key entirely. Gentle adjunct ONLY — every salt_slug "
                "MUST be from the subgraph's `tissue_salts` list; never invent one."
            ),
            "properties": {
                "overview": {"type": "string", "description": "Warm, client-facing one-liner introducing the tissue-salt suggestions, framed as a gentle optional support alongside the plan (not a medicine)."},
                "salts": {
                    "type": "array",
                    "description": "1-4 tissue salts whose indications / keynotes best match THIS client's picture. Fewer is better — pick the most-fitting, don't list a salt for every symptom. ONLY slugs present in the subgraph `tissue_salts` list.",
                    "items": {
                        "type": "object",
                        "required": ["salt_slug", "reason"],
                        "properties": {
                            "salt_slug": {"type": "string", "description": "A tissue_salt slug from the subgraph (core cell salt like 'mag-phos' / 'kali-phos', or a Bio-Combination like 'bio-combination-15')."},
                            "reason": {"type": "string", "description": "One sentence — why this salt fits this client, tied to their specific symptoms / picture."},
                            "intake_evidence": {"type": "array", "items": {"type": "string"}, "description": "Intake observations that drove this pick, format 'observation (source_field)'. Empty list if not intake-driven."},
                        },
                    },
                },
            },
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

1a. ROOT-CAUSE FIRST (Fix B 2026-05-23). Most clients present with 5-10
    diagnoses (Hashimoto's + PCOS + IR + IBS + migraine + Vit D + anxiety
    + eczema, etc.). DO NOT design 10 parallel protocols. If
    `client_context.intake_insights.root_cause` is populated, that label is
    the FM keystone — treat it as the upstream driver and anchor your
    `likely_drivers` list to it (the root should appear as the #1-ranked
    driver, with related mechanisms ranked behind it). Frame downstream
    conditions in `synthesis_notes` as "will improve as we address the
    root" rather than parallel targets. If no root_cause is supplied,
    identify ONE upstream driver yourself and lead `likely_drivers` with it
    — never present a flat list of unrelated diagnoses. The supplement +
    lifestyle + lab plan should be PROPORTIONATE: a focused 3-5 item
    protocol addressing the root, not a 12-item bag covering every
    diagnosis simultaneously.

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

3a. THE MEDICATION LIST IS COMPLETE. `client_context.current_medications`
    (plus the structured medication categories) is the client's FULL
    medication list. If a medication is not listed, assume the client is
    NOT taking it. Do NOT add synthesis_notes or referral_triggers asking
    the coach to "clarify medication status" or "confirm whether the client
    is on X" — the intake form already asked, and a blank means none.
    Reason from what IS documented: an untreated-looking picture (e.g. a
    Hashimoto's client with no thyroid medication) is a clinical FACT to
    work with, not an information gap to flag. Only flag a verify-item when
    two intake fields directly contradict each other.

3b. DRUG CONTEXT (v0.74). The user message contains a `drug_context` field
    with `matched` entries — each is a drug from the client's current
    medications that resolved against the FM drug catalogue. Each match
    carries:
      - `condition_implications`: diagnoses the drug implies (use these to
        ground your `likely_drivers` and to anchor synthesis_notes —
        e.g. cromolyn → MCAS / histamine intolerance, even when the coach
        hasn't named it; metformin → confirm insulin resistance lens).
      - `protocol_cautions`: HARD constraints on the plan. Severity:
          `critical` = MUST honour; if your suggestion violates it, drop
            the suggestion or rework. Always cite the caution in
            `contraindication_check` for the affected supplement, or in
            `synthesis_notes` for plan-level guidance.
          `warning`  = honour unless the coach has explicit override.
          `info`     = best practice; surface as a one-line tip in
            `synthesis_notes` or supplement `coach_rationale`.
      - `depletes`: nutrient depletions to monitor + replace. ALWAYS
        suggest the replacement supplement (with the `typical_supplement_dose`
        as the starting dose) unless contraindicated. Add the monitoring
        lab to `lab_followups` if not already there.
    Treat `drug_context.matched` as authoritative. If a caution says
    "avoid quercetin > 1000 mg/day in MCAS clients", do not suggest
    quercetin at 1500 mg, full stop. If a caution says "avoid St John's
    wort with TKIs", flag it as `critical` in `contraindication_check`
    and refuse to include the supplement.
    `drug_context.unmatched_meds` lists medications that didn't resolve
    against the catalogue — note them in `catalogue_additions_suggested`
    with `kind: drug_depletion` so the coach knows the gap.

3c. FOOD-FIRST — a hard precondition on EVERY supplement suggestion.
    Before you add any supplement, ask: "Can this nutrient be delivered by
    a food this client will realistically eat, at a dose that meets the
    need?" If YES → do NOT suggest the supplement. Instead put the FOOD in
    `nutrition.add` with the nutrient named explicitly, e.g.
    "2 Brazil nuts daily — selenium for thyroid (replaces a selenium
    supplement)". Supplements are a fallback for when food cannot
    realistically close the gap, not the default.
      • Food CAN cover it (→ food, not supplement): selenium → 2 Brazil
        nuts/day; magnesium (maintenance) → pumpkin seeds + cooked greens;
        vitamin C → amla / guava; potassium → coconut water; many B
        vitamins → whole foods; iodine → sea vegetables.
      • Supplement IS still first-line when food genuinely cannot do it:
        a real measured deficiency needing rapid correction (e.g.
        ferritin 12 → iron supplement); a therapeutic dose far above food
        levels (e.g. vitamin D 5000 IU for a deficient client; berberine);
        poor absorption (hypochlorhydria, gut disease); or a compound with
        no meaningful food source. In these cases keep the supplement but
        say WHY food won't suffice in `coach_rationale`.
      • When a supplement is genuinely borderline, suggest the food in
        `nutrition.add` AND keep the supplement but mark it in
        `coach_rationale` as "optional — only if she can't get it from
        food consistently".
    This reflects the coach's standing rule (2026-05-20): food is
    prioritised over supplements wherever food can do the job.

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
   - GROUPING RULE — the coach renders lab_followups in two sections:
     "Order now" (immediate panel handed to the client today) and "Recheck
     in N weeks" (time-bound re-tests). To land in the right bucket:
       * If the lab is needed at session start → `kind: "new"`, OMIT
         `due_in_weeks` (or set it to 0).
       * If it's a recheck of a protocol response → `kind: "repeat"` AND
         set `due_in_weeks` to a realistic interval (typically 6 for
         inflammation/glucose markers, 8–12 for hormones, 12 for nutrient
         status). Never set `due_in_weeks` on a `kind: "new"` entry — it
         confuses the grouping and the coach has handed clients lists
         mixing "right now" with "in 3 months".

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
    - **Kitchen remedies**: when a fitting home remedy appears in the catalogue
      subgraph (a digestive churan for bloating, a calming tea for poor sleep,
      a cooling water for heat, a nutrient juice for low iron), add its slug to
      `nutrition_suggestions.home_remedy_slugs`. Prefer 0-2 well-matched ones —
      they render as the client's daily "drinks & digestives". Only use slugs
      present in the subgraph; never invent them.

11. ASSUME INDIAN CONTEXT unless client_context says otherwise — vegetarian
    options should always be offered; ragi / sesame / dals / leafy greens
    over kale-and-quinoa stereotypes; ghee / coconut oil over avocado oil
    when both are reasonable.

11z. INTAKE EXTRAS — `client_context.intake_extras` is a structured bundle
    of EVERY intake-form field beyond the basics (which are already at
    top level). Subsections only present when the client filled them:
      - `weight_history` — highest/lowest adult weight, current trend,
        what triggered any sharp change. Use for metabolic + thyroid
        + stress framing.
      - `medications_layered` — STRUCTURED med categories with dose,
        duration, side-effects. Way richer than the free-text
        `current_medications`. Cross-check supplement suggestions against
        these (e.g. PPI long-term → B12 / Mg depletion; GLP-1 →
        digestive enzymes / B-complex; antibiotics in last 12mo →
        probiotic repletion priority).
      - `covid` — infection count + long-symptoms + vaccine + reactions.
        Drives post-COVID neuroinflammation / dysautonomia / fatigue
        hypotheses.
      - `family.specific_conditions` — chip-list of inheritable risks
        (T2DM <50, breast cancer, cardiovascular early, autoimmune,
        depression, etc.). Promotes specific screening / lab orders.
      - `body_systems` — bowel/bristol/hair/skin/nail/acne/pain/oral
        signs / belly_fat_pattern / histamine / chemical_sensitivity /
        postprandial / cold-heat tolerance. EACH carries diagnostic
        signal: e.g. tongue coating → fungal load; diffuse hair thinning
        → ferritin/thyroid/protein; pins-and-needles → B12/glucose;
        central adiposity → insulin resistance. Reference specific
        observations in driver reasoning.
      - `sleep_depth` — time to fall asleep, wake pattern, snore/apnoea,
        restless legs, tracker ownership. Wake at 3am consistently
        is a cortisol pattern. Snore is OSA suspicion. Restless legs
        is iron / dopamine.
      - `energy` — caffeine dependency / morning state / crash pattern.
        "Cannot function without caffeine" + "afternoon crash" is HPA
        + reactive hypoglycaemia.
      - `stress_work` — stress response style (shut down / fight-flight)
        + work_pattern (sedentary / nights / commute). HPA framing.
      - `environment` — sun exposure / sunscreen / vit D supp / barefoot
        outdoors / toxic exposures. Drives vit D recommendations,
        grounding, toxin-clearance protocols.
      - `reproductive_depth` — period_pain_severity, PMDD signs,
        perimenopause inventory, contraception history, pregnancies
        (count, complications, breastfeeding), repro_diagnoses. Adds
        depth beyond cycle_context. Pregnancy / lactation status is
        a SAFETY GATE for supplement choices.
      - `past_history` — childhood history + what worked / hasn't.
        Honour what hasn't worked (don't re-suggest); what worked is
        a head start.
      - `readiness` — readiness_confidence (1-10), recent_labs_done
        chip-list, willing_to_share_labs, willing_to_test_further.
        Low readiness → simplify the protocol; willing-to-test-further=no
        → drop expensive lab follow-ups, prefer in-clinic basics.

    Use specific values from these subsections as `intake_evidence`
    entries on drivers / supplements / lifestyle suggestions. Each
    observation that drives a recommendation gets cited (e.g. "Wake at
    3am consistently (sleep_depth.wake_pattern) → cortisol pattern").

11y. EXTERNAL REPORTS — `client_context.external_reports` is a list of
    parsed reports from the Reports tab (genetic / food_sensitivity /
    OAT / imaging / DEXA / etc.). Treat each report's `key_findings`
    + `summary` the same way you treat functional_test_findings —
    promote into drivers + recommendations.
      - `food_sensitivity` reports carry `reactive_foods` bucketed by
        severity (severe_high / moderate / mild_borderline). Move
        severe_high items into nutrition.reduce AND add them to the
        client's effective foods_to_avoid for the meal plan. Don't
        silently ignore.
      - `genetic_test` reports may carry `fm_relevant_variants` (MTHFR,
        COMT, VDR, GST, MAO, BDNF, etc.) — use these to justify
        methylated-B choices, slow-COMT precaution against high-dose
        adaptogens, vit D dose if VDR variant, etc.
      - `organic_acids` reports carry yeast_fungal / bacterial_dysbiosis
        / mitochondrial_function / neurotransmitter_metabolism / oxalates
        / detox_capacity. Cite specific markers in driver reasoning.

11a. FUNCTIONAL TEST FINDINGS — `client_context.functional_test_findings`
    is a list of parsed reports (DUTCH / GI-MAP / Sova / BugSpeaks /
    Genova / OAT etc.) the coach has uploaded. Each entry carries:
    - `test_type` + `test_date`
    - `summary` (2-3 sentence Sonnet-generated overview)
    - `flagged_drivers` — mechanism slugs the parser already flagged
      (e.g. dysbiosis, leaky-gut, candida-overgrowth, scfa-deficiency,
      cortisol-pattern-disruption, oestrogen-metabolism-imbalance).
      These are STRONG signals, not weak hypotheses — promote them
      into `likely_drivers` with appropriate ranks, citing the test
      date in the reasoning.
    - `clinical_recommendations` — actionable items from the parser
      (probiotic protocols, dietary shifts, follow-up tests). Weave
      these into `supplement_suggestions` / `nutrition_suggestions` /
      `lab_followups`. Don't just paraphrase; tailor to THIS client's
      other findings.
    - `key_findings` dict — structured per-panel detail (h_pylori,
      pathogens_detected, opportunistic_overgrowth, commensal_dysbiosis,
      bacterial_dysbiosis, yeast_fungal, estrogen_metabolism, etc.).
      Quote specific findings when they justify a recommendation
      (e.g. "Candida tropicalis detected → S. boulardii 5–10B CFU").

    A plan that uploaded a gut-microbiome panel but barely mentions
    gut dysbiosis is a failure — the coach paid $X to run the test;
    surface the findings prominently in synthesis_notes AND in at
    least 2-3 supplement/nutrition/lab suggestions. Same for DUTCH
    (hormone metabolites) and OAT (organic acids) — if a panel is on
    file, its findings should be load-bearing in the resulting plan.

    A `functional_test_findings` entry can ALSO be a genetic or
    food-sensitivity report (uploaded via the Functional Test panel
    rather than the Reports tab). Such entries carry the SAME
    type-specific fields described in 11y — `genetic_variants`
    (gene / variant / genotype / zygosity / fm_relevance),
    `methylation_summary`, `detox_summary`, `reactive_foods`,
    `food_groups_affected`. Treat them exactly as 11y instructs,
    wherever they appear. The folder a report sits in must NOT change
    how you act on it.

11z. REWORK SUGGESTION — `client_context.rework_suggestion`, when present,
    is the distilled output of a GENETIC or rework report the coach
    uploaded (`triggered_by` names the source). It carries:
    - `rationale` — the clinical story tying the genetics together.
    - `suggested_changes` — a list of {op, target_kind, target_slug,
      description, reason}. `op` is usually "add" (a supplement / topic /
      lab the genetics call for) or "escalate".
    This is coach-confirmed, genetics-grounded intelligence — treat it as
    AUTHORITATIVE, the same weight as functional_test flagged_drivers.
    For every `suggested_changes` entry:
    - op=add + target_kind=supplement → include that supplement in
      `supplement_suggestions` (if it resolves in the catalogue subgraph;
      if not, add to `catalogue_additions_suggested`). Cite the genetic
      reason in `coach_rationale`.
    - op=add + target_kind=topic → fold into `topics_in_play`.
    - op=add + target_kind=lab_order → add to `lab_followups`.
    - op=escalate → reflect the dose/intensity change in the relevant
      suggestion.
    A plan generated for a client who HAS a rework_suggestion but ignores
    its genetic supplement recommendations is a failure — the coach ran a
    genetic test specifically to drive the protocol. Honour the FOOD-FIRST
    rule (3c) even here: if a genetics-suggested nutrient is better met by
    food, put the food in nutrition.add instead.

11b. CURRENT SUPPLEMENTS — `client_context.current_supplements` lists what
    the client is already taking (OTC vitamins, minerals, herbs, probiotics,
    ayurvedic mixes). EVERY entry on that list MUST get an explicit decision
    in `supplement_suggestions`. Don't silently skip a supplement just
    because it's already in their cupboard. Three valid decisions per entry:
    - CONTINUE: appropriate for the FM picture → include in
      supplement_suggestions with `is_existing: true` and a `continue_or_change:
      "continue"`-style note in `coach_rationale`. Coach needs the supplement
      visible in the protocol so it carries forward into the letter.
    - ADJUST: right supplement, wrong form/dose/timing → suggest the
      corrected version with `coach_rationale` explicitly calling out the
      change (e.g. "switch from magnesium oxide to glycinate — better
      absorption for sleep + neuropathic pain").
    - STOP / FLAG: contraindicated with a current medication, inappropriate
      for the profile (e.g. high-dose iron without confirmed deficiency,
      St John's wort on SSRIs, ashwagandha during pregnancy or with
      hyperthyroidism), or pure poly-pharmacy duplication. Surface as a
      red flag in `additional_symptoms_to_screen` or in the relevant driver's
      reasoning, AND mention in `synthesis_notes` so the coach sees it.

    Cross-check every current supplement against current_medications for
    interactions (turmeric + blood thinners, magnesium + amlodipine BP-lowering
    synergy, ashwagandha + thyroid meds, vitamin K + warfarin, etc.). Flag
    interactions even when "minor" — the coach decides, you surface.

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

    Between-session messages live on history entries as `client_message`
    (the body) plus a `channel` tag:
      - `channel="client_whatsapp"` — the client wrote this themselves
        on WhatsApp. This is GOLD: real-world feedback on adherence,
        what's working, what's hard, new symptoms, life events that
        derail the protocol. Examples worth acting on:
          • "Not eating enough veggies, impact on stools" → propose a
            veg-juice habit or a fibre supplement in `lifestyle` /
            `nutrition.add` and reflect it in the next meal plan.
          • "Travelling next 2 weeks" → simplify protocol for that
            window; add to `notes_for_coach`.
          • "Down 1kg, feeling lighter" → reinforce what's working in
            `synthesis_notes`; don't disrupt.
        Quote the client's own words in `synthesis_notes` when citing
        these — "Dhanishta said …" — so the coach can verify against
        the WhatsApp thread.
      - `channel="coach_whatsapp"` — outbound. The coach already sent
        this; mostly useful as context, not a new fact.
      - `channel="coach_notes"` — coach typed observations into the
        client page. Treat as primary evidence.
    If the client_message contradicts an old plan element (e.g. low
    veg intake while the prior plan emphasised salads), surface the
    mismatch in `synthesis_notes` and propose the substitution. Don't
    silently ignore between-session voice.

    Each history entry ALSO carries a `coach_notes` field — the coach's
    own write-up for that session: chief complaint, history of present
    illness, the IFM 7-node baseline she scored, family history, what
    has / hasn't worked before, and her qualitative read of the client
    (mood, affect, body language, motivation, relationship dynamics).
    This is HIGH-VALUE primary evidence — it is the coach's clinical
    judgement, the one thing you cannot infer from symptom slugs or
    labs. Weight it heavily:
      - The IFM baseline tells you which functional-medicine nodes she
        already judged dysfunctional — align your `likely_drivers` and
        `topics_in_play` with it, or explain in `synthesis_notes` why
        you diverge.
      - Her qualitative read (e.g. "burnt out, flat affect, pushing
        through on willpower") should shape lifestyle / stress / pacing
        suggestions and the tone of `education`.
      - "What hasn't worked" is a hard constraint — do not re-suggest it.
    If `coach_notes` and the structured data disagree, surface it in
    `synthesis_notes` rather than silently picking one.

    IFM BASELINE. `client_context.ifm_baseline`, when present, is the
    coach's (or a prior mapping pass's) functional-medicine read of the
    client across the 7 IFM nodes — assimilation, defense_repair, energy,
    biotransformation, transport, communication, structural — each scored
    1 (optimal) to 5 (severe dysfunction), with a per-node `rationale`, a
    `primary_node`, and a `cascade` description. Treat it as the coach's
    settled clinical framing of WHERE the dysfunction sits:
      - Your `likely_drivers` and `topics_in_play` should be coherent
        with the high-scoring nodes and especially the `primary_node`.
        If your top driver lands on a node the baseline scored 1–2,
        either you're missing something or the baseline is — say so
        explicitly in `synthesis_notes`.
      - Sequence interventions along the `cascade`: address the
        primary/root node first, don't chase a downstream node.
      - It does NOT replace labs or symptoms — it's the organising
        frame. Reconcile, don't blindly defer.

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
      Vegan: ALWAYS algae-derived omega-3 (DHA + EPA from marine algae) —
      NEVER fish oil.
      Vegetarian: default to algae-derived omega-3, UNLESS
      `client_context.animal_derived_supplements_ok` == "yes" — then fish oil
      is PREFERRED (higher EPA/DHA per dose, cheaper than algae). If that flag
      is "no", blank, or absent, use algae.
      Eggetarian/Pescatarian/Non-veg: fish oil is appropriate.
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

27. INTAKE-EVIDENCE TRACEABILITY — populate the `intake_evidence` array on
    every recommendation type (`likely_drivers`, `lifestyle_suggestions`,
    `supplement_suggestions`, `lab_followups`) WHENEVER an intake observation
    drove the inference. This is the coach's audit trail — she needs to see
    WHY you recommended something. Rules:

    - Pull from `client_context.intake_insights` (patterns, red_flags,
      top_hypotheses, coach_notes_for_ai) AND from any structured intake
      field: medication category lists (glp1_medications, acid_suppressants,
      nsaids_daily, antibiotics_last_12mo, etc.), covid_vaccine_history,
      covid_long_symptoms, bowel_pattern, bristol_stool_typical,
      hair_loss_pattern, pain_locations, work_pattern, weight_trend_current,
      etc.
    - Each entry is ONE SHORT COACH-READABLE PHRASE that names the
      observation in plain English and parenthetically tags the source
      field. Examples (use this format):
        "PPI use 3+ years (acid_suppressants)"
        "On Ozempic 0.5mg (glp1_medications)"
        "Wakes at 3am consistently (wake_time_pattern)"
        "Family Hashimoto's at 32 (family_specific_conditions)"
        "Long-COVID brain fog (covid_long_symptoms)"
        "3 antibiotic courses last year (antibiotics_last_12mo)"
        "Coach correction: client stopped GLP-1 2 weeks ago (coach_notes_for_ai)"
    - If a recommendation came from symptoms or labs only (no intake
      contribution), use an empty list `[]`. Don't fabricate citations.
    - If multiple intake observations contributed, list them — up to 4
      items per recommendation. Most-decisive observation first.
    - Coach corrections in `intake_insights.coach_notes_for_ai` OVERRIDE
      AI inferences from raw fields — if the coach said "client stopped X",
      treat X as not-current and skip recommendations that assumed it.
      Cite the coach correction as your evidence.

28. AYURVEDA CONSTITUTION + SECTION — populate the `ayurveda` object ONLY when
    `client_context.ayurveda_enabled` is true. If it's false or absent, OMIT
    the `ayurveda` key entirely (don't emit an empty object). When enabled:

    THE CARDINAL RULE — prakruti vs vikruti:
    - VIKRUTI (current imbalance) is INFERRED from the client's CURRENT intake:
      sleep_notes, bristol_stool_typical, bowel_pattern, digestion_notes,
      cold_heat_tolerance, skin_signs, hair_texture_change, energy_pattern,
      energy_crashes, morning_state, stress_response/stress_type,
      histamine_signals, weight_trend_current, menstrual_notes, active_conditions.
      Fill vata/pitta/kapha scores, vikruti_label, and vikruti_doshas from this.
    - PRAKRUTI (lifelong constitution):
      * If `client_context.dosha_self_assessment` (a {trait_key: dosha} dict) is
        NON-EMPTY: this is the gold standard. Tally the picks, name the dominant
        (or dominant pair) as prakruti_label, set prakruti_confidence
        "moderate"/"high" by how consistent the answers are.
      * If that dict is EMPTY: still offer a PROVISIONAL suggestion so the coach
        has a starting point — set prakruti_label to your best read from the
        lifelong-leaning signals you DO have (body frame from height/weight/BMI,
        long-standing conditions in active_conditions / medical_history, skin/
        hair tendencies, the notes), and set prakruti_confidence = "low". Mark it
        clearly as provisional in your evidence/notes. Recommend the quiz to
        confirm. Only use prakruti_confidence = "pending_quiz" (with an empty
        label) when there is GENUINELY no signal at all.
      * CAUTION when suggesting provisionally: a stressed / perimenopausal /
        sleep-deprived client can read falsely Vata or Pitta from current state.
        Lean on the most STABLE, lifelong-leaning signals (constitutional build,
        chronic lifelong patterns) for prakruti; treat acute current symptoms as
        vikruti. When a trait is ambiguous between the two, weight it to vikruti
        and keep prakruti confidence low. The coach always confirms prakruti.
      * LOW-CONFIDENCE FLAG: whenever prakruti_confidence is 'low' or
        'pending_quiz', you MUST populate `ayurveda.advisory` with a one-line
        flag telling the coach the constitution read is too weak to anchor a
        constitution-specific plan — recommend confirming it via the dosha quiz
        first, or reconsidering whether to include the Ayurveda layer for this
        client yet. This is an explicit nudge for the coach to decide, not a
        silent low score.

    AGNI + AMA + DUAL ROOT CAUSE:
    - Read agni_state (sama/vishama/tikshna/manda) and ama from the digestive
      picture. Weak/irregular agni + ama is the Ayurvedic articulation of an FM
      root cause — surface it in `dual_root_cause_note`, mapping the FM root you
      identified in `likely_drivers` into Ayurvedic vocabulary in one sentence.

    EVIDENCE — cite every dosha read to a `source_field` (same audit discipline
    as INTAKE-EVIDENCE TRACEABILITY). No uncited dosha claims.

    THE SECTION (`ayurveda.section`) — this becomes the draft Plan.ayurveda the
    coach edits, flowing into consolidated + lifestyle_guide letters:
    - dietary_guidance + dinacharya + remedy_slugs all target the VIKRUTI (what's
      aggravated now), not the prakruti.
    - REMEDY ROUTE: each home_remedy in the subgraph has a `route` —
      'internal' (eaten/drunk: teas, churans, infused waters, juices) or
      'external' (applied to the body: oil massage / abhyanga, nasya nasal
      drops, oil pulling, eyewash, steam, foot soaks, compresses, pastes).
      EXTERNAL remedies are practices — prefer placing them in `dinacharya`
      (the daily routine) and frame them as something the client DOES/applies,
      never as something to drink or swallow. INTERNAL remedies go in
      remedy_slugs as drinks/preparations. (You may still list an external
      remedy in remedy_slugs, but the routine is the better home for it.)
    - remedy_slugs: pick ONLY home_remedy slugs from the subgraph whose
      `balances_dosha` covers an aggravated dosha AND whose `aggravates_dosha`
      does NOT intersect vikruti_doshas. A remedy that pacifies Vata but
      aggravates Kapha is WRONG for a Vata+Kapha client — the plan-checker will
      flag it, so don't pick it.

    SUPPLEMENT ENERGETICS — when ayurveda_enabled, dosha-tagged supplements in
    the subgraph carry `balances_dosha` / `aggravates_dosha` / `virya` (heating/
    cooling) just like remedies. Apply the SAME rule to `supplement_suggestions`:
    prefer supplements whose energetics pacify the aggravated dosha and avoid
    those whose `aggravates_dosha` intersects the client's vikruti_doshas (the
    plan-checker now flags these for supplements too). When a clinically-needed
    supplement is energetically off (e.g. a heating herb for a Pitta-aggravated
    client), note it in `contraindication_check` and suggest a pacifying anupana
    (carrier) or timing rather than dropping the supplement outright.

    SCOPE — lifestyle coaching only. Constitution as education + diet/routine/
    kitchen-remedies. NEVER bhasmas, panchakarma, gem/metal/colour therapy, or
    anything requiring a vaidya.

29. TISSUE SALTS (Schüssler / biochemic) — populate the `tissue_salts` object
    ONLY when `client_context.schussler_salts_enabled` is true. If it's false or
    absent, OMIT the key entirely. When enabled:
    - The subgraph carries a `tissue_salts` list (the 12 core cell salts + any
      matching Bio-Combinations). Pick `salt_slug` values ONLY from that list —
      NEVER invent a slug or recommend a salt that isn't there.
    - Match by reading each salt's `key_indications` + `notes_for_coach` (the
      Boericke keynotes) against THIS client's picture. Pick the 1-4 BEST-fitting
      salts — not one per symptom. Anchors: cramping / spasmodic pain → mag-phos;
      nervous exhaustion / burnout / grief → kali-phos; first-stage inflammation
      or fever → ferrum-phos; acidity / sour reflux → natrum-phos; thick white
      catarrh → kali-mur; painful or irregular periods → bio-combination-15.
    - Each salt needs a one-sentence `reason` tying it to the client's symptoms,
      plus `intake_evidence` citing the driving observations (same audit
      discipline as INTAKE-EVIDENCE TRACEABILITY) — empty list if not intake-driven.
    - SCOPE — tissue salts are a GENTLE traditional adjunct (all are
      evidence_tier fm_specific_thin), never a primary treatment and never a
      substitute for the supplement protocol or medical care. Keep `overview`
      warm and client-facing.

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

    # v0.74 — drug-derived constraints. Match the client's current
    # medications against fm-database/data/drug_depletions/ and inject
    # both condition_implications + protocol_cautions into the prompt
    # so the synthesiser respects them when generating drivers,
    # supplements, lifestyle, labs and referrals.
    drug_context = _collect_drug_context(client_context)

    # The main payload
    user_payload = {
        "client_context": client_context,
        "selected_symptoms": selected_symptom_slugs,
        "selected_topics": selected_topic_slugs,
        "additional_notes": additional_notes,
        "session_history": session_history or [],
        "days_since_last_prescription": days_since_last_prescription,
        "vitaone_inventory": vitaone_inventory or [],
        "drug_context": drug_context,
        "catalogue_subgraph": subgraph,
    }
    content.append({
        "type": "text",
        "text": (
            "Synthesize an FM assessment for the client below. The catalogue "
            "subgraph defines the universe of slugs you may reference — do not "
            "invent any.\n\n"
            # Compact separators (no indent) — the payload is ~450K+ tokens and
            # indent=2 whitespace was ~20% pure waste ($0.30+/call) with zero
            # quality difference (the model parses compact JSON identically).
            + json.dumps(user_payload, separators=(",", ":"), default=str)
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

    # Truncation guard (audit Phase-1b): if the call hit the output token cap
    # the tool_use payload is partial — model_validate would silently fill the
    # missing drivers/supplements/labs with empty defaults, and the caller would
    # cache that blank result as a "success". Fail loudly so the shim emits
    # ok:false and nothing is cached.
    if usage_obj.stop_reason == "max_tokens":
        raise RuntimeError(
            "assessment truncated — hit the output token limit; not saved. "
            "Retry with fewer symptoms/topics."
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

    # No synthesize_assessment tool block in the response — the model didn't
    # produce an assessment. Don't return a blank result the caller would cache
    # as success (audit Phase-1b).
    raise RuntimeError(
        "assessment synthesis produced no result (model returned no "
        "synthesize_assessment block) — not saved."
    )


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
- Brand variants (VitaOne / Thorne / etc.) of an existing supplement use
  the canonical catalogue slug plus `display_name` + `buy_link` overrides
  on the plan entry — they are NEVER separate slugs.
- Foods (brazil nuts, methi, beetroot, amla, eggs, bone broth, etc.) belong
  in `nutrition.add` / `nutrition.reduce`, NEVER in `supplement_protocol`.
  Foods have no YAML in `data/supplements/`; they break the validator.
"""


def _compact_index(subgraph: Any) -> dict[str, list[str]]:
    """Slim ``slug: name`` index over a built subgraph.

    Chat used to re-send the FULL subgraph (~170K tokens of records with
    sources, doses, quotes) every turn — and since coach turns are minutes
    apart, the ephemeral cache (5-min TTL) never hit, so every turn paid full
    price plus a +25% cache-write surcharge for nothing. The follow-up rarely
    needs the full records: the prior assessment (with its rationale + chosen
    doses) is already in context. The model only needs to know WHICH slugs
    exist so it can reference real ones and refuse to invent new ones. This
    index gives exactly that at ~1/10th the tokens.
    """
    if not isinstance(subgraph, dict):
        return {}

    def names(items: Any) -> list[str]:
        out: list[str] = []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            slug = it.get("slug")
            if not slug:
                continue
            label = (
                it.get("display_name")
                or it.get("statement")
                or it.get("label")
                or ""
            )
            out.append(f"{slug}: {label[:120]}" if label else slug)
        return out

    return {
        "topics": names(subgraph.get("topics")),
        "mechanisms": names(subgraph.get("mechanisms")),
        "symptoms": (
            names(subgraph.get("selected_symptoms"))
            + names(subgraph.get("candidate_symptoms"))
        ),
        "supplements": names(subgraph.get("supplements")),
        "claims": names(subgraph.get("claims")),
        "cooking_adjustments": names(subgraph.get("cooking_adjustments")),
        "home_remedies": names(subgraph.get("home_remedies")),
        "protocols": names(subgraph.get("protocols")),
        "tissue_salts": names(subgraph.get("tissue_salts")),
    }


def chat(
    *,
    chat_context: ChatContext | dict[str, Any],
    messages: list[dict[str, Any]],
    model: str | None = None,
    max_tokens: int = 1500,
) -> ChatResult:
    """Continue a multi-turn conversation about a prior assessment.

    The first user turn injects a context preamble built from `chat_context`
    (client + prior suggestions + a compact slug index, NOT the full subgraph —
    see `_compact_index`). Keeping that preamble small is what makes each turn
    cheap; we don't rely on prompt caching here because coach turns are minutes
    apart and the ephemeral cache (5-min TTL) almost never hits.

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
    # We send a COMPACT slug index instead of the full catalogue subgraph: the
    # prior assessment (with rationale + doses) is the substance the follow-up
    # reasons over; the model only needs the slug list to reference real
    # entities and refuse to invent new ones. This is ~1/10th the tokens of the
    # full subgraph and is why chat dropped from ~$0.55/turn to ~$0.08/turn.
    context_text = (
        "Conversation context (given facts):\n\n"
        # Compact separators — same token-saving as the synthesize payload.
        + json.dumps({
            "client": ctx.client_ctx,
            "selected_symptoms": ctx.selected_symptoms,
            "selected_topics": ctx.selected_topics,
            "additional_notes": ctx.additional_notes,
            "prior_suggestions": ctx.suggestions,
            "session_history": ctx.session_history,
            "catalogue_slugs": _compact_index(ctx.subgraph),
        }, separators=(",", ":"), default=str)
    )

    # Inject the context as the first user message (cached), then add real chat history.
    api_messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": context_text,
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

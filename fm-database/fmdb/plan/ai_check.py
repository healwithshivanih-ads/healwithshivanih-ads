"""AI sanity-check layer on top of the deterministic plan checker.

The deterministic checker (fmdb/plan/checker.py) catches structural issues:
missing slug refs, contraindications, confirm_with_clinician supplements,
form mismatches. It cannot evaluate whether the plan is *coherent* — does
the protocol actually address the stated assessment? Are supplements
justified by the listed drivers? Does the coach_rationale match what the
catalogue says about a supplement's mechanisms? Does anything in the
client's medical_history make a suggestion risky?

That's what this module does. It builds a focused catalogue context
(only entities the plan actually references), hands it to Claude with a
tool-use schema forcing structured output, and returns a dict of concerns
the coach should review before publishing.

Cost: ~$0.02–0.05 per check with prompt caching (the system prompt and
catalogue context block are cached per `cache_control: ephemeral` so
repeated checks of the same plan are cheap).
"""

from __future__ import annotations

import json
import os
from typing import Any

from ..validator import Loaded
from .models import Client, Plan


# ---------------------------------------------------------------------------
# Build the focused catalogue subgraph for THIS plan
# ---------------------------------------------------------------------------


def _collect_plan_refs(plan: Plan) -> dict[str, set[str]]:
    """Pull every catalogue slug the plan references, grouped by entity kind."""
    topics = set(plan.primary_topics) | set(plan.contributing_topics)
    symptoms = set(plan.presenting_symptoms) | set(plan.tracking.symptoms_to_monitor)
    mechanisms = {hd.mechanism for hd in plan.hypothesized_drivers}
    supplements = {item.supplement_slug for item in plan.supplement_protocol}
    cooking = set(plan.nutrition.cooking_adjustments)
    remedies = set(plan.nutrition.home_remedies)

    # Education modules can target topics/mechanisms/claims
    claims: set[str] = set()
    for em in plan.education:
        if em.target_kind == "topic":
            topics.add(em.target_slug)
        elif em.target_kind == "mechanism":
            mechanisms.add(em.target_slug)
        elif em.target_kind == "claim":
            claims.add(em.target_slug)

    return {
        "topics": topics,
        "mechanisms": mechanisms,
        "symptoms": symptoms,
        "supplements": supplements,
        "cooking_adjustments": cooking,
        "home_remedies": remedies,
        "claims": claims,
    }


def _build_plan_subgraph(plan: Plan, cat: Loaded) -> dict[str, Any]:
    """Return compact dicts for every catalogue entity referenced by this plan,
    plus any claims that mention the referenced topics/supplements/mechanisms
    (the model needs those to evaluate translation accuracy)."""
    refs = _collect_plan_refs(plan)

    topic_by_slug = {t.slug: t for t in cat.topics}
    mech_by_slug = {m.slug: m for m in cat.mechanisms}
    sym_by_slug = {s.slug: s for s in cat.symptoms}
    supp_by_slug = {s.slug: s for s in cat.supplements}
    ca_by_slug = {ca.slug: ca for ca in cat.cooking_adjustments}
    hr_by_slug = {hr.slug: hr for hr in cat.home_remedies}
    claim_by_slug = {c.slug: c for c in cat.claims}

    # Alias-aware mechanism lookup (mechanisms carry .aliases)
    mech_alias = {m.slug: m.slug for m in cat.mechanisms}
    for m in cat.mechanisms:
        for a in m.aliases:
            mech_alias[a] = m.slug

    # Resolve mechanism refs through aliases
    resolved_mechs = {mech_alias.get(s, s) for s in refs["mechanisms"]}
    refs["mechanisms"] = resolved_mechs

    def _topic(t):
        return {
            "slug": t.slug,
            "display_name": t.display_name,
            "summary": (t.summary or "")[:400],
            "common_symptoms": t.common_symptoms[:10],
            "key_mechanisms": t.key_mechanisms,
            "evidence_tier": t.evidence_tier.value,
            "coaching_scope_notes": (t.coaching_scope_notes or "")[:300],
            "clinician_scope_notes": (getattr(t, "clinician_scope_notes", "") or "")[:300],
        }

    def _mech(m):
        return {
            "slug": m.slug,
            "display_name": m.display_name,
            "category": m.category.value,
            "summary": (m.summary or "")[:400],
            "upstream_drivers": m.upstream_drivers,
            "downstream_effects": m.downstream_effects,
            "linked_to_topics": m.linked_to_topics,
            "evidence_tier": m.evidence_tier.value,
        }

    def _sym(s):
        return {
            "slug": s.slug,
            "display_name": s.display_name,
            "severity": s.severity.value,
            "category": s.category.value,
            "description": (s.description or "")[:200],
            "when_to_refer": (s.when_to_refer or "")[:200],
            "linked_to_topics": s.linked_to_topics,
            "linked_to_mechanisms": s.linked_to_mechanisms,
        }

    def _supp(s):
        return {
            "slug": s.slug,
            "display_name": s.display_name,
            "category": s.category.value,
            "evidence_tier": s.evidence_tier.value,
            "linked_to_topics": s.linked_to_topics,
            "linked_to_mechanisms": getattr(s, "linked_to_mechanisms", []),
            "linked_to_claims": s.linked_to_claims,
            "contraindications": s.contraindications.model_dump(mode="json"),
            "interactions": s.interactions.model_dump(mode="json"),
            "notes_for_coach": (s.notes_for_coach or "")[:400],
        }

    def _ca(ca):
        return {
            "slug": ca.slug,
            "display_name": ca.display_name,
            "category": ca.category.value,
            "summary": (ca.summary or "")[:300],
            "cautions": ca.cautions,
        }

    def _hr(hr):
        return {
            "slug": hr.slug,
            "display_name": hr.display_name,
            "category": hr.category.value,
            "summary": (hr.summary or "")[:300],
            "indications": hr.indications,
            "contraindications": hr.contraindications,
        }

    def _claim(c):
        return {
            "slug": c.slug,
            "statement": (c.statement or "")[:300],
            "evidence_tier": c.evidence_tier.value,
            "coaching_translation": (c.coaching_translation or "")[:300],
            "linked_to_topics": c.linked_to_topics,
            "linked_to_supplements": c.linked_to_supplements,
        }

    # Pull claims that reference any topic/mechanism/supplement in scope
    claim_set = set(refs["claims"])
    for c in cat.claims:
        if (set(c.linked_to_topics) & refs["topics"]
                or set(getattr(c, "linked_to_mechanisms", [])) & refs["mechanisms"]
                or set(c.linked_to_supplements) & refs["supplements"]):
            claim_set.add(c.slug)

    return {
        "topics": [_topic(topic_by_slug[s]) for s in refs["topics"] if s in topic_by_slug],
        "mechanisms": [_mech(mech_by_slug[s]) for s in refs["mechanisms"] if s in mech_by_slug],
        "symptoms": [_sym(sym_by_slug[s]) for s in refs["symptoms"] if s in sym_by_slug],
        "supplements": [_supp(supp_by_slug[s]) for s in refs["supplements"] if s in supp_by_slug],
        "cooking_adjustments": [_ca(ca_by_slug[s]) for s in refs["cooking_adjustments"] if s in ca_by_slug],
        "home_remedies": [_hr(hr_by_slug[s]) for s in refs["home_remedies"] if s in hr_by_slug],
        "claims": [_claim(claim_by_slug[s]) for s in claim_set if s in claim_by_slug],
    }


def _client_snapshot(client: Client | None) -> dict[str, Any]:
    if client is None:
        return {"_note": "no client record loaded — client-fit checks limited"}
    return {
        "client_id": client.client_id,
        "age_band": client.age_band,
        "sex": client.sex,
        "active_conditions": client.active_conditions,
        "medical_history": client.medical_history,
        "current_medications": client.current_medications,
        "known_allergies": client.known_allergies,
        "goals": client.goals,
        "notes": (client.notes or "")[:500],
    }


def _plan_snapshot(plan: Plan) -> dict[str, Any]:
    """Compact view of the plan for the model — strip provenance/lifecycle noise."""
    return {
        "slug": plan.slug,
        "client_id": plan.client_id,
        "plan_period_weeks": plan.plan_period_weeks,
        "primary_topics": plan.primary_topics,
        "contributing_topics": plan.contributing_topics,
        "presenting_symptoms": plan.presenting_symptoms,
        "hypothesized_drivers": [
            {"mechanism": d.mechanism, "reasoning": d.reasoning}
            for d in plan.hypothesized_drivers
        ],
        "lifestyle_practices": [
            {"name": p.name, "cadence": p.cadence, "details": p.details}
            for p in plan.lifestyle_practices
        ],
        "nutrition": plan.nutrition.model_dump(mode="json"),
        "education": [em.model_dump(mode="json") for em in plan.education],
        "supplement_protocol": [
            {
                "supplement_slug": s.supplement_slug,
                "form": s.form,
                "dose": s.dose,
                "timing": s.timing,
                "duration_weeks": s.duration_weeks,
                "coach_rationale": s.coach_rationale,
            }
            for s in plan.supplement_protocol
        ],
        "lab_orders": [{"test": l.test, "reason": l.reason} for l in plan.lab_orders],
        "referrals": [
            {"to": r.to, "reason": r.reason, "urgency": r.urgency.value}
            for r in plan.referrals
        ],
        "tracking": plan.tracking.model_dump(mode="json"),
        "notes_for_coach": (plan.notes_for_coach or "")[:500],
    }


# ---------------------------------------------------------------------------
# System prompt + tool schema
# ---------------------------------------------------------------------------


_SYSTEM_PROMPT = """You are a sanity-check reviewer for functional-medicine
plans authored by a coach (single-author model, NBHWC/FMCA scope). Your job
is to surface issues a deterministic checker CANNOT catch.

A separate deterministic checker has already run and handles all of the
following — DO NOT re-flag any of these:
- Missing or unknown slug references
- Supplement contraindications against client's active_conditions / medications
- Supplements tagged `evidence_tier: confirm_with_clinician` without acknowledgement
- Form/dose-unit mismatches against the supplement entity

You should focus on FOUR categories of concern:

1. COHERENCE — does the protocol address the assessment?
   - Are there primary_topics with NO corresponding supplement/practice/education?
   - Are there supplements with no driver/topic justification (orphans)?
   - Are there hypothesized_drivers with no follow-through (no supplement,
     no lifestyle practice, no education targeting that mechanism)?
   - Does the plan_period_weeks make sense for the protocol's intensity?

2. CLIENT_FIT — does anything in client context raise a flag?
   - Conditions in `medical_history` that should temper a suggestion
     (e.g., Hashimoto's + adaptogens like ashwagandha; PCOS + high-dose
     iodine; history of kidney stones + high-dose vitamin C).
   - Goals contradicted by the protocol.
   - Sex/age-band mismatches (e.g., perimenopause topic for a 25-year-old).
   - Allergies overlooked.
   - Note: the deterministic checker handles ACTIVE conditions and
     CURRENT meds — you should attend to MEDICAL_HISTORY (past/in-remission)
     which it does NOT cross-check.

3. TRANSLATION — does the coach_rationale align with what the catalogue
   says about each supplement?
   - Does the rationale invoke a mechanism the catalogue actually links
     to that supplement?
   - Does the rationale make claims stronger than the supplement's
     evidence_tier supports?
   - Is the rationale specific enough to be defensible, or is it generic
     ("supports gut health")?

4. COMPLETENESS — for each primary_topic, is there at least one
   intervention (supplement, practice, nutrition adjustment, or
   education module)?

Severity gradient:
- "critical": do not publish until fixed (real risk to client).
- "warning":  review before publishing (likely needs adjustment).
- "info":     consider this (style or minor improvement).

Style rules:
- Be CONCISE. One concern per real issue. Do not pad.
- If the plan is genuinely clean in a category, omit it from `concerns`.
- Empty `concerns` list is a valid output.
- `where` should pinpoint the exact section and item, e.g.
  "supplement_protocol[2]: ashwagandha" or "hypothesized_drivers[0]:
  hpa-axis-dysregulation".
- `coherence_score` and `client_fit_score`: 1 (poor) to 5 (excellent).
- `overall_assessment`: 2-3 sentences total. No more.

Call the report_concerns tool exactly once."""


_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["concerns", "overall_assessment", "coherence_score", "client_fit_score"],
    "properties": {
        "concerns": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["severity", "category", "message", "where"],
                "properties": {
                    "severity": {"type": "string", "enum": ["critical", "warning", "info"]},
                    "category": {
                        "type": "string",
                        "enum": ["coherence", "evidence", "client_fit", "translation", "completeness"],
                    },
                    "message": {"type": "string"},
                    "where": {"type": "string"},
                    "suggested_fix": {"type": "string"},
                },
            },
        },
        "overall_assessment": {"type": "string"},
        "coherence_score": {"type": "integer", "minimum": 1, "maximum": 5},
        "client_fit_score": {"type": "integer", "minimum": 1, "maximum": 5},
    },
}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def ai_check_plan(
    plan: Plan,
    client: Client | None,
    catalogue: Loaded,
    *,
    model: str | None = None,
    max_tokens: int = 8000,
) -> dict[str, Any]:
    """Call Claude to sanity-check a plan. Returns the structured tool output
    plus usage telemetry under `_usage`.

    Does NOT mutate the plan — caller is responsible for persisting the
    result onto plan.ai_sanity_check.
    """
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise RuntimeError(
            "anthropic SDK not installed. Run `pip install anthropic`."
        ) from e

    client_sdk = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    model_name = model or os.environ.get(
        "FMDB_AI_CHECK_MODEL",
        os.environ.get("FMDB_EXTRACTOR_MODEL", "claude-sonnet-4-5"),
    )

    subgraph = _build_plan_subgraph(plan, catalogue)
    plan_view = _plan_snapshot(plan)
    client_view = _client_snapshot(client)

    # Build the user content. The catalogue subgraph is the BIG block — cache it
    # so repeat checks of the same plan only re-read it.
    catalogue_block = (
        "Catalogue subgraph for entities referenced by this plan:\n"
        + json.dumps(subgraph, indent=2)
    )
    plan_block = (
        "Plan under review:\n" + json.dumps(plan_view, indent=2)
        + "\n\nClient snapshot:\n" + json.dumps(client_view, indent=2)
    )

    tool = {
        "name": "report_concerns",
        "description": "Return structured sanity-check findings.",
        "input_schema": _TOOL_SCHEMA,
    }

    with client_sdk.messages.stream(
        model=model_name,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            },
        ],
        tools=[tool],
        tool_choice={"type": "tool", "name": "report_concerns"},
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": catalogue_block,
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": plan_block},
            ],
        }],
    ) as stream:
        resp = stream.get_final_message()

    usage_obj = getattr(resp, "usage", None)
    usage = {
        "model": model_name,
        "stop_reason": getattr(resp, "stop_reason", None),
        "input_tokens": getattr(usage_obj, "input_tokens", None),
        "output_tokens": getattr(usage_obj, "output_tokens", None),
        "cache_creation_input_tokens": getattr(usage_obj, "cache_creation_input_tokens", None),
        "cache_read_input_tokens": getattr(usage_obj, "cache_read_input_tokens", None),
    }

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "report_concerns":
            payload = dict(block.input or {})
            payload["_usage"] = usage
            payload.setdefault("concerns", [])
            return payload

    # Model didn't call the tool — return empty result with usage attached.
    return {
        "concerns": [],
        "overall_assessment": "AI did not return structured output.",
        "coherence_score": 0,
        "client_fit_score": 0,
        "_usage": usage,
    }

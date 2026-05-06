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

from .results import AssessResult, AssessUsage, ChatContext, ChatResult


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
            "description": "Mechanisms most likely driving the picture, ranked.",
            "items": {
                "type": "object",
                "required": ["mechanism_slug", "rank", "reasoning"],
                "properties": {
                    "mechanism_slug": {"type": "string", "description": "MUST be a slug from the catalogue subgraph."},
                    "rank": {"type": "integer", "description": "1 = most likely."},
                    "reasoning": {"type": "string"},
                    "supporting_evidence": {"type": "array", "items": {"type": "string"}, "description": "Quote symptoms or labs that support this hypothesis."},
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
                    "rationale": {"type": "string"},
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
                    "rationale": {"type": "string"},
                    "evidence_tier_caveat": {"type": "string", "description": "If catalogue tier is fm_specific_thin or confirm_with_clinician, surface that."},
                    "contraindication_check": {"type": "string", "description": "Any flagged conflicts with client meds/conditions."},
                },
            },
        },
        "lab_followups": {
            "type": "array",
            "description": "Labs the coach should ask the clinician to order.",
            "items": {
                "type": "object",
                "required": ["test", "reason"],
                "properties": {
                    "test": {"type": "string"},
                    "reason": {"type": "string"},
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
            "description": "Coach-facing meta commentary: what's confident, what's a stretch, what to watch out for.",
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
   you'd want to suggest isn't in the catalogue, leave it out and mention it
   in `synthesis_notes` so it can be added later.

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

5. Tone of `client_facing_summary` and `coaching_translation`-style fields:
   warm, plain-English, second-person, free of jargon. Examples in the catalogue
   show the voice.

6. `additional_symptoms_to_screen` is your chance to surface symptoms the coach
   didn't pick that fit the cluster — saves a follow-up call.

7. RANKING: order `likely_drivers` from most-to-least probable given symptoms+labs.
   Maximum 4 drivers. If it's not in the top 4, leave it out.

8. Honest uncertainty: if symptoms or labs are too sparse to make confident
   suggestions, return SHORTER lists and say so in `synthesis_notes`.

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

14. CATALOGUE ADDITIONS. When you'd have suggested something useful but the
    slug isn't in the subgraph, populate `catalogue_additions_suggested` with
    the item — kind (topic/mechanism/symptom/supplement/claim/cooking_adjustment/
    home_remedy), a short name, and one-line `why`. The coach reviews these
    later and decides whether to add to the catalogue. Be specific: "tudca"
    not "bile-flow supplement", "racing-thoughts" not "anxiety-related symptom".
    Surface 2-5 items per analysis when relevant.

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

12. MEDICAL HISTORY MATTERS even when not currently active:
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
    model: str | None = None,
    max_tokens: int = 8192,
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

    resp = client.messages.create(
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

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "synthesize_assessment":
            return AssessResult(suggestions=block.input or {}, usage=usage_obj)

    return AssessResult(suggestions={}, usage=usage_obj)


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

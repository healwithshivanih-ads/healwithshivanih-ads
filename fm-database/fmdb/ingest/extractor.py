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

from .types import ExtractionResult, IngestRequest


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
                return ExtractionResult(
                    sources=[],  # source is registered separately by the staging layer
                    topics=list(payload.get("topics", [])),
                    mechanisms=list(payload.get("mechanisms", [])),
                    symptoms=list(payload.get("symptoms", [])),
                    claims=list(payload.get("claims", [])),
                    supplements=list(payload.get("supplements", [])),
                    usage=usage,
                )
        return ExtractionResult(usage=usage)


# ----- factory ---------------------------------------------------------------


def get_extractor(name: str | None = None) -> Extractor:
    name = (name or os.environ.get("FMDB_EXTRACTOR", "stub")).lower()
    if name == "stub":
        return StubExtractor()
    if name == "anthropic":
        return AnthropicExtractor()
    raise ValueError(f"unknown extractor: {name!r} (expected 'stub' or 'anthropic')")

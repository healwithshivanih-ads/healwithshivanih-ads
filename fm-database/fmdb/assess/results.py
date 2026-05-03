"""Typed result models for the assess layer.

These Pydantic models give the engine API a stable, documented shape for
the values returned by `suggester.synthesize()` and `suggester.chat()`.
Both Streamlit and the Next.js shims now consume `AssessResult` /
`ChatResult` rather than raw dicts.

Wire compatibility: each model mirrors the historical dict shape exactly
so `result.model_dump(exclude_none=False)` round-trips to the same JSON
that callers were already serializing. The shim scripts call `.model_dump()`
at the stdout boundary, so the TypeScript `AssessResult` / `ChatResult`
types in `fm-database-web/src/lib/fmdb/anthropic-types.ts` continue to
parse without change.

The inner `suggestions` payload (the tool_use output) is left as
`dict[str, Any]` for now — typing every nested suggestion shape is a
larger refactor that would require migrating `Session.ai_analysis` from
`dict` to a typed model on disk. Tracked as a TODO at the end of this
file.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AssessUsage(BaseModel):
    """Token / cost telemetry from a single Anthropic call.

    All fields are nullable because cache fields may be absent on
    non-cached calls and the dry-run path emits zeros without a real
    model response.
    """

    model: str | None = None
    stop_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


class AssessResult(BaseModel):
    """Return value of `suggester.synthesize()`.

    `suggestions` is the parsed `tool_use` payload from the
    `synthesize_assessment` tool — see `_TOOL_INPUT_SCHEMA` in
    `suggester.py` for the full nested shape (likely_drivers,
    topics_in_play, lifestyle_suggestions, ...).
    """

    suggestions: dict[str, Any] = Field(default_factory=dict)
    usage: AssessUsage = Field(default_factory=AssessUsage)


class ChatResult(BaseModel):
    """Return value of `suggester.chat()`.

    `reply` is the assistant's text response (text blocks concatenated).
    """

    reply: str = ""
    usage: AssessUsage = Field(default_factory=AssessUsage)


class ChatContext(BaseModel):
    """Inputs needed to continue a conversation about a prior assessment.

    Created by the caller after a successful `synthesize()` and passed
    on every `chat()` turn. The model is permissive (extra keys ignored)
    so callers can attach diagnostic fields without a schema change.
    """

    model_config = {"extra": "ignore"}

    client_ctx: dict[str, Any] = Field(default_factory=dict)
    subgraph: dict[str, Any] = Field(default_factory=dict)
    selected_symptoms: list[str] = Field(default_factory=list)
    selected_topics: list[str] = Field(default_factory=list)
    additional_notes: str = ""
    suggestions: dict[str, Any] = Field(default_factory=dict)
    session_history: list[dict[str, Any]] = Field(default_factory=list)


# TODO(later): promote `suggestions` / `ai_analysis` to a typed
# `AssessSuggestions` model with sub-models for LikelyDriver,
# TopicInPlay, LifestyleSuggestion, NutritionSuggestion,
# SupplementSuggestion, etc. Requires migrating
# `fmdb.plan.models.Session.ai_analysis: dict` to the typed model and
# rewriting any caller that pokes at suggestion fields by string key.
# Defer until that read-side coupling is mapped — premature now.

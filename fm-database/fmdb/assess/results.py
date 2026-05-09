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
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _coerce_none_strings(data: Any) -> Any:
    """Pre-process a model's raw input dict: replace None with '' for any
    field whose name doesn't end with known nullable suffixes.
    Called as a model_validator(mode='before') on every inner suggestion model
    so the AI can freely emit null for optional string fields without
    triggering a ValidationError.
    """
    if not isinstance(data, dict):
        return data
    return {
        k: ("" if v is None and isinstance(k, str) and not k.endswith(
            ("_score", "_count", "_weeks", "_pct", "_tokens")
        ) else v)
        for k, v in data.items()
    }


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


# ---------------------------------------------------------------------------
# Sub-models for the AssessSuggestions payload
# ---------------------------------------------------------------------------


class ExtractedLab(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    test_name: str
    value: str
    unit: str = ""
    reference_range: str = ""
    flag: str = ""          # low | normal | high | optimal | suboptimal | unknown
    fm_interpretation: str = ""
    date_drawn: str | None = None


class LikelyDriver(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    mechanism_slug: str
    rank: int
    reasoning: str
    supporting_evidence: list[str] = Field(default_factory=list)


class TopicInPlay(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    topic_slug: str
    role: str               # primary | contributing
    rationale: str = ""
    confidence_pct: int | None = None


class AdditionalSymptomToScreen(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    symptom_slug: str
    why_screen: str = ""


class LifestyleSuggestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    name: str
    cadence: str
    details: str = ""
    rationale: str = ""
    addresses_mechanism: list[str] = Field(default_factory=list)


class NutritionSuggestions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    pattern: str = ""
    add: list[str] = Field(default_factory=list)
    reduce: list[str] = Field(default_factory=list)
    meal_timing: str = ""
    cooking_adjustment_slugs: list[str] = Field(default_factory=list)
    home_remedy_slugs: list[str] = Field(default_factory=list)
    rationale: str = ""


class SupplementSuggestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    supplement_slug: str
    form: str = ""
    dose: str = ""
    timing: str = ""
    duration_weeks: int | None = None
    rationale: str = ""
    evidence_tier_caveat: str = ""
    contraindication_check: str = ""
    vitaone_url: str = ""  # Set when this suggestion maps to a product in vitaone_inventory.


class LabFollowup(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    test: str
    reason: str


class ReferralTrigger(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    to: str
    reason: str
    urgency: str            # routine | soon | urgent | emergency


class EducationFraming(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    target_kind: str        # topic | mechanism | claim
    target_slug: str
    client_facing_summary: str


class CatalogueAdditionSuggested(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    kind: str               # topic | mechanism | symptom | supplement | claim | ...
    name: str
    why: str


class IFMTimelineEvent(BaseModel):
    """A timeline event classified into the IFM Antecedent/Trigger/Mediator model.

    Combines events captured at intake (client.timeline_events) with any new
    events the AI extracts from the narrative (transcript / additional_notes).
    Each event is linked back to the mechanism slugs it most likely drives.
    """
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    year: int | None = None
    date: str | None = None              # YYYY-MM-DD or YYYY-MM if known
    age_at_event: int | None = None      # computed when DOB available
    event: str
    category: str = ""                    # original intake category, or 'extracted_from_narrative'
    atm: str                              # antecedent | trigger | mediator | resolution
    rationale: str = ""                   # one-line explanation of the ATM call
    linked_driver_slugs: list[str] = Field(default_factory=list)  # mechanism slugs from likely_drivers


class AssessSuggestions(BaseModel):
    """Parsed tool_use payload from synthesize_assessment."""

    model_config = ConfigDict(extra="ignore")

    extracted_labs: list[ExtractedLab] = Field(default_factory=list)
    likely_drivers: list[LikelyDriver] = Field(default_factory=list)
    topics_in_play: list[TopicInPlay] = Field(default_factory=list)
    additional_symptoms_to_screen: list[AdditionalSymptomToScreen] = Field(default_factory=list)
    lifestyle_suggestions: list[LifestyleSuggestion] = Field(default_factory=list)
    nutrition_suggestions: NutritionSuggestions = Field(default_factory=NutritionSuggestions)
    supplement_suggestions: list[SupplementSuggestion] = Field(default_factory=list)
    lab_followups: list[LabFollowup] = Field(default_factory=list)
    referral_triggers: list[ReferralTrigger] = Field(default_factory=list)
    education_framings: list[EducationFraming] = Field(default_factory=list)
    synthesis_notes: str = ""
    catalogue_additions_suggested: list[CatalogueAdditionSuggested] = Field(default_factory=list)
    ifm_timeline: list[IFMTimelineEvent] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level result models
# ---------------------------------------------------------------------------


class AssessResult(BaseModel):
    """Return value of `suggester.synthesize()`.

    `suggestions` is the parsed `tool_use` payload from the
    `synthesize_assessment` tool, fully typed as `AssessSuggestions`.
    """

    suggestions: AssessSuggestions = Field(default_factory=AssessSuggestions)
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

    model_config = ConfigDict(extra="ignore")

    client_ctx: dict[str, Any] = Field(default_factory=dict)
    subgraph: dict[str, Any] = Field(default_factory=dict)
    selected_symptoms: list[str] = Field(default_factory=list)
    selected_topics: list[str] = Field(default_factory=list)
    additional_notes: str = ""
    suggestions: dict[str, Any] = Field(default_factory=dict)
    session_history: list[dict[str, Any]] = Field(default_factory=list)

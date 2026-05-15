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

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


def _empty_int_to_none(data: Any, fields: tuple[str, ...]) -> Any:
    """Pre-process: replace '' (empty string) with None for given numeric fields.
    The AI sometimes emits "" instead of null for unknown integers (e.g. unknown
    year of an event). Pydantic int|None then rejects the empty string."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    for f in fields:
        v = out.get(f)
        if isinstance(v, str) and v.strip() == "":
            out[f] = None
    return out


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
    """One contributing mechanism with ATM (Antecedent / Trigger / Mediator)
    classification — the FM cognitive model. ATM separates what predisposed
    the client (antecedent), what precipitated the cascade (trigger), and
    what is perpetuating it (mediator). `parents` connects drivers into a
    cascade graph so the UI can render trigger → mediator → expression.
    """
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    mechanism_slug: str
    rank: int
    reasoning: str
    supporting_evidence: list[str] = Field(default_factory=list)
    # ATM classification (FM cognitive model). Optional for backward compat
    # but the AI is instructed to populate it for every driver.
    atm_role: str | None = None  # "antecedent" | "trigger" | "mediator" | "expression"
    parents: list[str] = Field(default_factory=list)  # mechanism slugs that PRECEDED this in the cascade
    chain_evidence: str = ""  # 1-2 sentences: why this position, what makes it root vs downstream


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
    # v2.4: surface explicit continue/adjust/stop decisions for supplements
    # the client is already taking. Coach renders different badges per
    # decision so she can scan the protocol in seconds.
    is_existing: bool = False
    continue_or_change: str = "new"  # "new" | "continue" | "adjust" | "stop"


class FactorScores(BaseModel):
    """Per-factor 1–5 fit scores, used to compute the weighted overall %.

    Weights (must sum to 100):
      - symptoms              (20%) — chief complaints + presenting symptoms match
      - medical_safety        (18%) — diagnoses + meds + history + risk-level compatibility
      - labs                  (15%) — biomarkers + lab values support this protocol
      - goals                 (10%) — alignment with stated client goals
      - gut_function          (10%) — gut symptoms / food reactions fit
      - metabolic_health       (8%) — insulin / glucose / lipid / weight context
      - nutrient_status        (7%) — known deficiencies addressed
      - lifestyle              (5%) — sleep / stress / movement / schedule realism
      - culture                (3%) — religion / ethics / dietary preference
      - real_world_fit         (2%) — budget / access / cooking ability / family
      - sustainability         (2%) — long-term adherence likelihood

    Score scale (1–5):
      5 = perfect / textbook fit
      4 = strong fit
      3 = reasonable fit, some caveats
      2 = weak fit
      1 = poor fit / mismatch
    """
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    symptoms: int = 3
    medical_safety: int = 3
    labs: int = 3
    goals: int = 3
    gut_function: int = 3
    metabolic_health: int = 3
    nutrient_status: int = 3
    lifestyle: int = 3
    culture: int = 3
    real_world_fit: int = 3
    sustainability: int = 3


# Weights (must sum to 100).
_FACTOR_WEIGHTS: dict[str, float] = {
    "symptoms": 20.0,
    "medical_safety": 18.0,
    "labs": 15.0,
    "goals": 10.0,
    "gut_function": 10.0,
    "metabolic_health": 8.0,
    "nutrient_status": 7.0,
    "lifestyle": 5.0,
    "culture": 3.0,
    "real_world_fit": 2.0,
    "sustainability": 2.0,
}


def compute_fit_percent(scores: FactorScores) -> float:
    """Weighted-average fit %. Each factor is 1–5; weights sum to 100.

    Result range: 20% (all 1s) to 100% (all 5s).
    """
    total = 0.0
    for k, w in _FACTOR_WEIGHTS.items():
        s = max(1, min(5, int(getattr(scores, k, 3))))
        total += s * w
    # total ranges 100 (all 1s) to 500 (all 5s) → divide by 5 → 20–100
    return round(total / 5.0, 1)


class ProtocolSuggestion(BaseModel):
    """One FM protocol the AI recommends for this client.

    Surfaced in the Assess UI as a card that the coach can use to anchor
    the plan (e.g. "this is a 5R candidate" or "this is a metabolic-reset
    candidate"). Each suggestion explains the why-indicated against this
    SPECIFIC client + checks contraindications.

    Scoring: AI returns 11 per-factor scores (1–5). Server-side computes
    the weighted overall fit_percent. UI shows only the top 2 by
    fit_percent, with a breakdown disclosure showing each factor.
    """
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    protocol_slug: str
    why_indicated: str
    factor_scores: FactorScores = Field(default_factory=FactorScores)
    fit_percent: float | None = None  # computed server-side from factor_scores
    when_to_start: str = ""
    expected_weeks: int | None = None
    client_specific_modifications: str = ""
    contraindication_check: str = ""


class LabFollowup(BaseModel):
    model_config = ConfigDict(extra="ignore")
    _coerce = model_validator(mode="before")(_coerce_none_strings)
    test: str
    reason: str
    # "new" (default — coach should order it) or "repeat" (already on file,
    # this is a follow-up re-check). When kind=repeat, due_in_weeks should
    # be set so the coach can scheduling the re-test relative to today.
    kind: Optional[str] = None
    due_in_weeks: Optional[int] = None


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

    @field_validator("year", "age_at_event", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

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
    suggested_protocols: list[ProtocolSuggestion] = Field(default_factory=list)
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

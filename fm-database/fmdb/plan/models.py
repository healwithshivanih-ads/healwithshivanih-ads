"""Pydantic models for Client and Plan.

Lives in fmdb/plan/ rather than fmdb/models.py because the storage location,
audit trail, and PHI handling are different from catalogue entities.

Design choices:
- Single-author model (per Shivani 2026-04-29). No clinician sign-off.
  The `evidence_tier: confirm_with_clinician` tag in catalogue entries is
  the surface where the AI sanity check warns against authoring without
  clinician input.
- Practices and tracking habits are FREEFORM strings in v1, NOT entity
  references. Promote to entities only after observing duplication across
  multiple plans (same philosophy as nutrition.add).
- Supplements, topics, mechanisms, symptoms, cooking_adjustments,
  home_remedies are ALL referenced by slug — validator cross-checks
  these against the catalogue at sanity-check time.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..enums import EntityStatus, PlanStatus, ReferralUrgency


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class Measurements(BaseModel):
    """Bio measurements at intake. Add a Session record for ongoing tracking
    (next turn) — for now, this is the baseline snapshot."""
    model_config = ConfigDict(extra="forbid")

    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    waist_cm: Optional[float] = None
    hip_cm: Optional[float] = None
    resting_heart_rate: Optional[int] = None       # bpm
    blood_pressure_systolic: Optional[int] = None  # mmHg
    blood_pressure_diastolic: Optional[int] = None # mmHg
    measured_on: Optional[date] = None             # when these were taken
    notes: str = ""

    # ---- computed properties (no extra input needed) ----

    @property
    def bmi(self) -> Optional[float]:
        if self.height_cm and self.weight_kg and self.height_cm > 0:
            h_m = self.height_cm / 100
            return round(self.weight_kg / (h_m * h_m), 1)
        return None

    @property
    def waist_hip_ratio(self) -> Optional[float]:
        if self.waist_cm and self.hip_cm and self.hip_cm > 0:
            return round(self.waist_cm / self.hip_cm, 2)
        return None

    def bmr_mifflin_st_jeor(self, age_years: int, sex: str) -> Optional[float]:
        """Basal Metabolic Rate via Mifflin-St Jeor (kcal/day).

        Men:   10*W + 6.25*H - 5*age + 5
        Women: 10*W + 6.25*H - 5*age - 161
        Other: average of the two
        """
        if not (self.height_cm and self.weight_kg and age_years):
            return None
        base = 10 * self.weight_kg + 6.25 * self.height_cm - 5 * age_years
        if sex == "M":
            return round(base + 5, 0)
        if sex == "F":
            return round(base - 161, 0)
        return round(base - 78, 0)  # midpoint for "other"


class Client(BaseModel):
    """Minimal client record. Lives at ~/fm-plans/clients/<client_id>.yaml.

    Privacy-conscious by default:
    - `client_id` is opaque (e.g. "cl-12345"); not the legal name.
    - `age_band` rather than exact birthdate (5-year band, e.g. "45-50").
    - `display_name` is optional and intended for a coach's eyes only —
      can be a pseudonym.
    """
    model_config = ConfigDict(extra="forbid")

    client_id: str
    display_name: str = ""              # for coach's reference; can be pseudonym
    intake_date: date
    age_band: str                       # e.g. "45-50"
    sex: str                            # F | M | other
    active_conditions: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)  # past diagnoses, in-remission conditions, surgeries, prior dx with current status
    current_medications: list[str] = Field(default_factory=list)
    known_allergies: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    notes: str = ""
    measurements: Measurements = Field(default_factory=Measurements)
    photo_filename: Optional[str] = None    # filename relative to client dir; populated after dir restructure (next turn)
    version: int = 1
    status: EntityStatus = EntityStatus.active
    created_at: datetime
    updated_at: datetime
    updated_by: str

    # Helper: estimate age from age_band midpoint (e.g. "45-50" → 47).
    # Used for BMR calculation when exact age isn't recorded.
    def estimated_age(self) -> Optional[int]:
        try:
            parts = self.age_band.replace("–", "-").split("-")
            if len(parts) == 2:
                lo, hi = int(parts[0]), int(parts[1])
                return (lo + hi) // 2
            return int(self.age_band)
        except Exception:
            return None

    @field_validator("client_id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"client_id must be lowercase alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"client_id has malformed hyphens: {v!r}")
        return v


# ---------------------------------------------------------------------------
# Plan sub-models
# ---------------------------------------------------------------------------


class HypothesizedDriver(BaseModel):
    """Coach's hypothesis: this mechanism is likely driving this client's picture."""
    model_config = ConfigDict(extra="forbid")
    mechanism: str                       # mechanism slug
    reasoning: str                       # why this is in play for this client


class PracticeItem(BaseModel):
    """Freeform lifestyle practice (sunlight, breathwork, walks, screen-cutoff)."""
    model_config = ConfigDict(extra="forbid")
    name: str                            # freeform — promote to Practice entity later if dup
    cadence: str                         # daily | nightly | weekly | mid-morning | etc.
    details: str = ""


class NutritionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pattern: str = ""                    # short label like "gentle anti-inflammatory"
    add: list[str] = Field(default_factory=list)             # freeform foods to add
    reduce: list[str] = Field(default_factory=list)          # freeform foods to reduce
    meal_timing: str = ""
    cooking_adjustments: list[str] = Field(default_factory=list)  # CookingAdjustment slugs
    home_remedies: list[str] = Field(default_factory=list)        # HomeRemedy slugs


class EducationModule(BaseModel):
    """A topic / mechanism / claim the coach plans to teach this client."""
    model_config = ConfigDict(extra="forbid")
    target_kind: str                     # "topic" | "mechanism" | "claim"
    target_slug: str
    client_facing_summary: str = ""      # what the coach will actually say


class SupplementItem(BaseModel):
    """A specific supplement entry in the plan."""
    model_config = ConfigDict(extra="forbid")
    supplement_slug: str
    form: str = ""
    dose: str = ""                       # freeform — "200-400 mg" or "1 tsp"
    timing: str = ""
    take_with_food: str = ""
    duration_weeks: Optional[int] = None
    titration: str = ""
    coach_rationale: str = ""            # why for this client


class LabOrderItem(BaseModel):
    """A lab test the coach is asking the client to obtain through their clinician.

    `test` is freeform for v1 — will become a slug when the LabTest entity
    type is built (per CLAUDE.md roadmap)."""
    model_config = ConfigDict(extra="forbid")
    test: str
    reason: str = ""


class ReferralItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to: str                              # role/specialty (e.g. "menopause-certified clinician")
    reason: str
    urgency: ReferralUrgency = ReferralUrgency.routine


class TrackingHabit(BaseModel):
    """Something the client tracks daily/weekly/etc. Freeform in v1."""
    model_config = ConfigDict(extra="forbid")
    name: str
    cadence: str


class Tracking(BaseModel):
    model_config = ConfigDict(extra="forbid")
    habits: list[TrackingHabit] = Field(default_factory=list)
    symptoms_to_monitor: list[str] = Field(default_factory=list)   # symptom slugs
    recheck_questions: list[str] = Field(default_factory=list)


class CatalogueSnapshot(BaseModel):
    """Pin the catalogue version this plan was authored against."""
    model_config = ConfigDict(extra="forbid")
    git_sha: Optional[str] = None        # set if available; nullable so dev plans don't fail
    snapshot_date: date


class StatusEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: PlanStatus
    by: str
    at: datetime
    reason: str = ""


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------


class UploadedFileRef(BaseModel):
    """A pointer to a file that was uploaded during a session.
    The file itself lives at ~/fm-plans/clients/<client_id>/files/<filename>.
    """
    model_config = ConfigDict(extra="forbid")
    filename: str
    kind: str                   # "lab_report" | "food_journal" | "photo" | "other"
    uploaded_at: datetime
    notes: str = ""


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str                   # "user" | "assistant"
    content: str
    at: Optional[datetime] = None


class Session(BaseModel):
    """A single coach-client touchpoint. Captures the inputs (symptoms,
    topics, files, measurements) and the AI output (analysis + chat) at
    a moment in time. Sessions are append-only — once saved, never edited.

    Stored at ~/fm-plans/clients/<client_id>/sessions/<session_id>.yaml
    """
    model_config = ConfigDict(extra="forbid")

    session_id: str             # e.g. "cl-001-2026-04-29-001"
    client_id: str
    date: date
    created_at: datetime

    # Inputs
    selected_symptoms: list[str] = Field(default_factory=list)
    selected_topics: list[str] = Field(default_factory=list)
    presenting_complaints: str = ""           # free-text intake / what client said today
    uploaded_files: list[UploadedFileRef] = Field(default_factory=list)
    measurements_snapshot: Optional["Measurements"] = None     # bio AT session time

    # AI output (if Analyze was run)
    ai_analysis: dict = Field(default_factory=dict)            # full synthesize() output
    chat_log: list[ChatTurn] = Field(default_factory=list)
    api_usage: dict = Field(default_factory=dict)              # tokens, cost

    # Outcome
    generated_plan_slug: Optional[str] = None
    coach_notes: str = ""
    next_session_planned: Optional[date] = None

    @field_validator("session_id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"session_id must be lowercase alphanumeric with hyphens, got {v!r}")
        return v


class Plan(BaseModel):
    """A specific client's plan, assembled from catalogue entities + client context."""
    model_config = ConfigDict(extra="forbid")

    slug: str                            # plan id, e.g. "cl-12345-2026-04-29-peri-foundations"
    schema_version: int = 1
    client_id: str                       # references Client.client_id

    # plan period
    plan_period_start: date
    plan_period_weeks: int
    plan_period_recheck_date: date

    # ---- assessment (coach) ----
    primary_topics: list[str] = Field(default_factory=list)         # topic slugs
    contributing_topics: list[str] = Field(default_factory=list)    # topic slugs
    presenting_symptoms: list[str] = Field(default_factory=list)    # symptom slugs
    hypothesized_drivers: list[HypothesizedDriver] = Field(default_factory=list)

    # ---- coach-authored sections ----
    lifestyle_practices: list[PracticeItem] = Field(default_factory=list)
    nutrition: NutritionPlan = Field(default_factory=NutritionPlan)
    education: list[EducationModule] = Field(default_factory=list)

    # ---- prescriptive (coach for now; AI sanity-check warns on confirm_with_clinician) ----
    supplement_protocol: list[SupplementItem] = Field(default_factory=list)
    lab_orders: list[LabOrderItem] = Field(default_factory=list)
    referrals: list[ReferralItem] = Field(default_factory=list)

    # ---- tracking ----
    tracking: Tracking = Field(default_factory=Tracking)

    # ---- attached resources (Resource slugs from ~/fm-resources/) ----
    # Surfaced in the client-facing render and intended to travel with the
    # plan as a handout bundle. Coach attaches via the 📎 Resources tab.
    attached_resources: list[str] = Field(default_factory=list)

    # ---- provenance ----
    status: PlanStatus = PlanStatus.draft
    status_history: list[StatusEvent] = Field(default_factory=list)
    catalogue_snapshot: CatalogueSnapshot
    ai_sanity_check: dict = Field(default_factory=dict)    # filled by `plan check` command
    notes_for_coach: str = ""                              # private working notes
    version: int = 1
    created_at: datetime
    updated_at: datetime
    updated_by: str
    supersedes: Optional[str] = None     # slug of plan this replaces (if any)

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"plan slug must be lowercase alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"plan slug has malformed hyphens: {v!r}")
        return v

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
    """Bio measurements at intake (legacy flat snapshot — kept for backward compat).
    New code should write to Client.measurements_log instead."""
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


class MeasurementEntry(BaseModel):
    """A dated measurement snapshot for time-series tracking.
    Stored in Client.measurements_log — one entry per measurement event."""
    model_config = ConfigDict(extra="forbid")

    date: str                                       # YYYY-MM-DD
    weight_kg: Optional[float] = None
    waist_cm: Optional[float] = None
    hip_cm: Optional[float] = None
    height_cm: Optional[float] = None
    blood_pressure_systolic: Optional[int] = None
    blood_pressure_diastolic: Optional[int] = None
    resting_heart_rate: Optional[int] = None
    notes: str = ""


class TimelineEvent(BaseModel):
    """A key event in the client's personal health timeline.
    Used by the AI to understand when things started and what triggered them."""
    model_config = ConfigDict(extra="forbid")

    year: Optional[int] = None                     # approximate year if exact date unknown
    date: Optional[str] = None                     # YYYY-MM or YYYY-MM-DD if known
    event: str                                      # description of the event
    category: str = "life_event"
    # category values: symptom_onset | life_event | treatment | diagnosis
    #                  stress | recovery | surgery | medication_change


class FivePillarsAssessment(BaseModel):
    """Quick baseline assessment of the five foundational health pillars.
    These are assessed at intake and updated at each session.
    Ratings: 1=very poor, 5=excellent."""
    model_config = ConfigDict(extra="forbid")

    # Pillar 1: Sleep
    sleep_hours: Optional[float] = None            # average hours per night
    sleep_quality: Optional[int] = None            # 1-5
    sleep_issues: str = ""                         # night waking, insomnia, snoring, etc.

    # Pillar 2: Stress / nervous system
    stress_level: Optional[int] = None             # 1-5 (1=low, 5=very high)
    stress_type: str = ""                          # fight/flight (anxious) | freeze (exhausted/numb) | mixed

    # Pillar 3: Movement
    movement_days_per_week: Optional[int] = None
    movement_type: str = ""                        # walking, gym, yoga, sedentary, etc.
    movement_intensity: str = ""                   # light | moderate | intense

    # Pillar 4: Nutrition quality (overall, not specific diet)
    nutrition_quality: Optional[int] = None        # 1-5

    # Pillar 5: Connection / relationships / purpose
    connection_quality: Optional[int] = None       # 1-5
    connection_notes: str = ""                     # isolation, strong support, work-life balance, etc.

    notes: str = ""


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
    date_of_birth: Optional[date] = None   # preferred; used to compute exact age
    age_band: str = ""                  # legacy / derived from DOB; kept for backward compat
    sex: str                            # F | M | other
    active_conditions: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)  # past diagnoses, in-remission conditions, surgeries, prior dx with current status
    current_medications: list[str] = Field(default_factory=list)
    known_allergies: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    notes: str = ""
    # Dietary preferences — used when generating the client-facing meal plan letter
    dietary_preference: str = ""   # Vegetarian | Non-vegetarian | Vegan | Eggetarian | Pescatarian | Other
    foods_to_avoid: str = ""       # Free form: "brinjal, bitter gourd, raw onion"
    non_negotiables: str = ""      # Things they won't give up: "morning chai, weekly mutton"
    city: str = ""                 # e.g. "Mumbai", "Chennai" — used for seasonal/regional meal planning
    country: str = ""              # e.g. "India", "UK" — used for seasonal produce and recipes
    mobile_number: Optional[str] = None   # for duplicate-check; stored hashed or partial if needed
    email: Optional[str] = None           # client email — used by "Send to client" feature
    next_contact_date: Optional[str] = None  # YYYY-MM-DD follow-up reminder date
    family_history: Optional[str] = None  # hereditary diseases / family health history

    # ── Location / CRM ────────────────────────────────────────────────────────
    address_line1: str = ""              # street address
    address_line2: str = ""              # apartment, suite, landmark
    state: str = ""                      # state / province / region
    pincode: str = ""                    # postal / ZIP code

    # ── FM Intake — deeper clinical picture ───────────────────────────────────
    # These go beyond the basic conditions list to capture the clinical context
    # the AI needs to reason accurately about root causes.
    digestion_notes: str = ""            # bowel frequency/consistency, bloating timing, reflux, burping
    sleep_notes: str = ""                # timing, quality, night waking (3am = cortisol/blood sugar), dreams
    energy_pattern: str = ""             # morning vs afternoon vs evening energy; crashes; second wind
    menstrual_notes: str = ""            # cycle length, PMS symptoms/timing, pain, flow, mood shifts (women)

    # ── Cycle sync (women clients) ─────────────────────────────────────
    # Used by the plan generator to phase-sync nutrition + movement.
    # cycle_status drives behaviour: 'menstruating' → use LMP + length to
    # compute current phase; 'perimenopausal' → flag as irregular,
    # phase-compute with low confidence; 'postmenopausal' → skip phase,
    # use stable post-meno protocols; 'not_applicable' → ignore entirely.
    cycle_status: Optional[str] = None      # menstruating | perimenopausal | postmenopausal | not_applicable
    last_menstrual_period: Optional[date] = None  # ISO date of LMP — start of most recent cycle
    cycle_length_days: Optional[int] = None       # typical cycle length, default 28 if unset
    cycle_regularity: Optional[str] = None        # regular | irregular | very_irregular
    menopause_started: Optional[date] = None      # date menopause was reached (12+ months no period)

    stress_response: str = ""            # fight/flight (anxious, wired) vs freeze (exhausted, numb) vs mixed
    childhood_history: str = ""          # antibiotic use, gut infections, trauma, ACEs, chronic childhood illness
    toxic_exposures: str = ""            # mold, heavy metals, chemical exposures, long-term medication history
    what_has_worked: str = ""            # past interventions (diet, supplements, lifestyle) that helped
    what_hasnt_worked: str = ""          # things tried that made no difference or worsened symptoms

    # ── Five pillars baseline ─────────────────────────────────────────────────
    five_pillars: Optional[FivePillarsAssessment] = None

    # ── Health timeline ───────────────────────────────────────────────────────
    # Structured timeline of key events — when did things start, what triggered them.
    # This is often the single most diagnostic piece of information in an FM intake.
    timeline_events: list[TimelineEvent] = Field(default_factory=list)

    # ── Measurements ──────────────────────────────────────────────────────────
    # measurements_log: time-series (one entry per measurement event)
    # measurements: legacy flat snapshot (kept for backward compat — do not remove)
    measurements_log: list[MeasurementEntry] = Field(default_factory=list)
    measurements: Measurements = Field(default_factory=Measurements)
    photo_filename: Optional[str] = None    # filename relative to client dir; populated after dir restructure (next turn)
    lab_markers: list[dict] = Field(default_factory=list)  # computed FM ratios from most recent lab analysis
    lab_markers_date: Optional[str] = None
    # Longitudinal health data snapshots — one entry per appointment/data-entry event.
    # Each dict: {date, source, measurements:{...}, lab_values:[{test_name,value,unit}],
    #             medications:[str], conditions:[str]}
    health_snapshots: list[dict] = Field(default_factory=list)
    version: int = 1
    status: EntityStatus = EntityStatus.active
    created_at: datetime
    updated_at: datetime
    updated_by: str

    def exact_age(self) -> Optional[int]:
        """Compute exact age in years from date_of_birth. Returns None if DOB not set."""
        if not self.date_of_birth:
            return None
        from datetime import date as _date
        today = _date.today()
        dob = self.date_of_birth
        age = today.year - dob.year
        if (today.month, today.day) < (dob.month, dob.day):
            age -= 1
        return age

    def cycle_context(self) -> Optional[dict]:
        """Compute today's cycle context for the plan generator.

        Returns a dict like:
          {
            'status': 'menstruating' | 'perimenopausal' | 'postmenopausal',
            'phase': 'menstrual' | 'follicular' | 'ovulatory'
                     | 'early_luteal' | 'late_luteal'
                     | 'postmenopausal' | None,
            'cycle_day': int | None,         # 1-based day of current cycle
            'cycle_length': int,              # 28 default
            'days_until_next_period': int | None,
            'regularity': str | None,
            'confidence': 'high' | 'low',     # low for perimenopausal / no-LMP
            'note': str,                      # human-readable summary
          }
        Returns None when status is None / 'not_applicable' or sex isn't F.
        """
        if (self.sex or "").upper() not in ("F", "FEMALE"):
            return None
        status = (self.cycle_status or "").strip().lower()
        if not status or status == "not_applicable":
            return None

        cycle_len = int(self.cycle_length_days or 28)
        regularity = self.cycle_regularity or "regular"

        if status == "postmenopausal":
            return {
                "status": "postmenopausal",
                "phase": "postmenopausal",
                "cycle_day": None,
                "cycle_length": cycle_len,
                "days_until_next_period": None,
                "regularity": None,
                "confidence": "high",
                "note": "Post-menopause — stable protocol (phytoestrogens, blood sugar, strength training, gut for oestrogen recycling).",
            }

        if not self.last_menstrual_period:
            # Status set but LMP missing — flag as low-confidence.
            return {
                "status": status,
                "phase": None,
                "cycle_day": None,
                "cycle_length": cycle_len,
                "days_until_next_period": None,
                "regularity": regularity,
                "confidence": "low",
                "note": "Cycle status known but no LMP date captured — ask coach to update.",
            }

        from datetime import date as _date
        today = _date.today()
        days_since_lmp = (today - self.last_menstrual_period).days
        if days_since_lmp < 0:
            return None  # LMP is in the future (data error)

        cycle_day = (days_since_lmp % cycle_len) + 1   # 1-based
        days_until_next = cycle_len - cycle_day + 1

        # Phase windows (28-day cycle by default; scale linearly for other lengths)
        # using fractional thresholds so a 32-day cycle still maps cleanly.
        f = cycle_day / cycle_len
        if cycle_day <= 5:
            phase = "menstrual"
        elif f <= 0.45:
            phase = "follicular"
        elif f <= 0.55:
            phase = "ovulatory"
        elif f <= 0.78:
            phase = "early_luteal"
        else:
            phase = "late_luteal"

        confidence = "low" if status == "perimenopausal" or regularity != "regular" else "high"

        phase_notes = {
            "menstrual": "Iron-rich foods (red meat / lentils / dates / blackstrap molasses), gentle movement, magnesium glycinate at night, more rest.",
            "follicular": "Lighter fresher meals, protein for steady energy, HIIT and strength training fine, fermented foods welcome.",
            "ovulatory": "Anti-inflammatory bias (curcumin, leafy greens), high-intensity training fine, light + bright meals, cruciferous veg for E2 clearance.",
            "early_luteal": "Complex carbs return (sweet potato, ragi), B6 + magnesium for PMS prevention, moderate movement.",
            "late_luteal": "Blood-sugar stability paramount — protein every meal, no fasting, restorative movement only (yoga, walks), reduce refined carbs.",
        }

        return {
            "status": status,
            "phase": phase,
            "cycle_day": cycle_day,
            "cycle_length": cycle_len,
            "days_until_next_period": days_until_next,
            "regularity": regularity,
            "confidence": confidence,
            "note": phase_notes.get(phase, ""),
        }

    def estimated_age(self) -> Optional[int]:
        """Best-effort age: exact from DOB if available, midpoint of age_band otherwise."""
        exact = self.exact_age()
        if exact is not None:
            return exact
        try:
            parts = self.age_band.replace("–", "-").split("-")
            if len(parts) == 2:
                lo, hi = int(parts[0]), int(parts[1])
                return (lo + hi) // 2
            return int(self.age_band)
        except Exception:
            return None

    def age_display(self) -> str:
        """Human-readable age string for display."""
        if self.date_of_birth:
            age = self.exact_age()
            return f"{self.date_of_birth.isoformat()} (age {age})" if age is not None else str(self.date_of_birth)
        return self.age_band or "—"

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
    five_pillars: Optional[FivePillarsAssessment] = None
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

    # ---- attached protocols (Protocol slugs from fm-database/data/protocols/) ----
    # The structured FM playbooks the coach committed to (5R / AIP / etc.)
    # picked from AI suggestions in /assess. Drives meal plan / supplement /
    # exercise / lifestyle letter generation — protocol's foods_to_emphasise,
    # foods_to_remove, supplements_typically_used, phases, and cautions are
    # injected into the letter prompts as binding constraints.
    attached_protocols: list[str] = Field(default_factory=list)

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

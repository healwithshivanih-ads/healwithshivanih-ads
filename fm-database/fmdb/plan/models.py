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


# ── Intake form repeaters (v0.72) ─────────────────────────────────────────────
# Used by the v2 intake form's contraception history + pregnancies repeaters.
# All fields Optional so client.yaml round-trips cleanly when only partial data
# is captured (which is most clients).

class ContraceptionEntry(BaseModel):
    """A single hormonal contraception / IUD / implant entry on the
    client's intake — used to reconstruct lifetime hormonal exposure."""
    model_config = ConfigDict(extra="forbid")

    type: str = ""                  # combined pill / progesterone-only pill / hormonal IUD /
                                    # copper IUD / implant / depo / patch / vaginal ring /
                                    # barrier / none
    started_year: Optional[int] = None
    stopped_year: Optional[int] = None     # None means "still on it"
    side_effects: list[str] = Field(default_factory=list)


class PregnancyEntry(BaseModel):
    """A single pregnancy entry on the client's intake. Each pregnancy is its
    own row so we capture per-pregnancy complications (preeclampsia in one,
    GDM in another, etc.)."""
    model_config = ConfigDict(extra="forbid")

    year: Optional[int] = None
    outcome: str = ""                # live birth / miscarriage / termination / stillbirth
    complications: list[str] = Field(default_factory=list)  # gestational diabetes /
                                     # pre-eclampsia / gestational hypertension / hyperemesis /
                                     # postpartum thyroiditis / postpartum depression / anaemia / other
    birth_type: str = ""             # vaginal / C-section / forceps / N/A
    breastfeeding_months: Optional[int] = None


class MedicationCategoryEntry(BaseModel):
    """A structured entry for the v2 intake form's "Have you ever taken X?"
    layered medication prompts (GLP-1s, PPIs, NSAIDs, hormonal contraception,
    thyroid meds, psych meds, biologics, statins/BP/diabetes).

    The chip on the form picks the bucket; this captures the details that
    expand under the chip.
    """
    model_config = ConfigDict(extra="forbid")

    name: str = ""                   # which drug (Ozempic, Pantoprazole, etc.)
    dose: str = ""                   # free text
    started: str = ""                # "2 years ago" / "since 2021" / etc.
    still_taking: Optional[bool] = None
    side_effects: str = ""           # free text


class IntakeInsightHypothesis(BaseModel):
    """A single FM-driver hypothesis derived by Haiku from the structured
    intake. Surfaced in the IntakeInsightsCard on the client overview AND
    fed to downstream AI calls (assess / rework / letter / sanity check)
    so they all see the same starter map."""
    model_config = ConfigDict(extra="forbid")

    driver: str                      # short label, e.g. "post-antibiotic dysbiosis"
    confidence: float = 0.5          # 0-1
    reasoning: str = ""              # one sentence


class IntakeRootCause(BaseModel):
    """Fix B 2026-05-23 — the ROOT CAUSE of the client's clinical picture.

    FM philosophy: instead of stacking 4 protocols to "fix" 10 conditions
    in parallel, identify the upstream driver and frame the rest as
    downstream effects that will improve as the root is addressed.

    For Maya Iyer (Hashimoto's + PCOS + IR + IBS-D + migraine + Vit D
    deficiency + IDA + anxiety + eczema + perimenstrual mood) the AI
    would identify e.g. "HPT-axis dysregulation driving systemic
    inflammation and metabolic disruption" as the root — with PCOS, IR,
    eczema, perimenstrual mood, and migraine all flowing downstream.

    Letters and plans then lead with the root and frame everything else
    as "these will improve as we address X" rather than parallel-treat
    every condition.

    Optional — older intake_insights records without this section still
    load cleanly via the default. Coach can also override the AI's pick
    via coach_notes_for_ai which flows back through downstream calls.
    """
    model_config = ConfigDict(extra="forbid")

    label: str                       # one-line root: "HPT-axis dysregulation driving …"
    reasoning: str = ""              # 2-4 sentences: WHY this is the root
    downstream_effects: list[str] = Field(default_factory=list)
    # ↑ List of conditions/symptoms framed as flowing FROM the root.
    #   e.g. ["PCOS — likely improves as thyroid stabilises",
    #         "IBS-D — gut-brain axis cascade from chronic inflammation",
    #         "Perimenstrual migraine — hormone-cycle-modulated"]
    confidence: float = 0.5          # 0-1


class IntakeInsights(BaseModel):
    """AI-generated clinical summary of the structured intake. Generated once
    by Haiku after intake submission, refreshed on demand by the coach via the
    🔄 Refresh button in IntakeInsightsCard. Lives on Client.intake_insights.

    The four lists are deliberately small (3-5 items each) — this is the
    map, not the full picture. Coach reads it in 90 seconds before a session.

    coach_notes_for_ai is editable by the coach without regenerating the AI
    summary — corrections / additions flow into every downstream AI call
    (assess / rework / letter / sanity check).
    """
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    model: str = "claude-haiku-4-5"
    # Fix B 2026-05-23 — root_cause is the new FM-philosophy section.
    # Older intake_insights records have this as None; the renderer
    # falls back to the existing top_hypotheses[0] when absent so no
    # historical data needs to be regenerated.
    root_cause: IntakeRootCause | None = None
    patterns: list[str] = Field(default_factory=list)            # 3-5 specific FM patterns
    red_flags: list[str] = Field(default_factory=list)           # protocol-gating concerns
    top_hypotheses: list[IntakeInsightHypothesis] = Field(default_factory=list)
    verify_in_session: list[str] = Field(default_factory=list)   # questions for first call
    coach_notes_for_ai: str = ""                                 # editable; flows into downstream AI


class FivePillarsAssessment(BaseModel):
    """Quick baseline assessment of the five foundational health pillars.
    These are assessed at intake and updated at each session.
    Ratings: 1=very poor, 5=excellent."""
    # extra="ignore" — older intake submissions wrote `stress` and
    # `movement_days` (since renamed to `stress_level` and
    # `movement_days_per_week` in the form serializer). Without this,
    # loading those legacy sessions fails Pydantic and breaks the
    # whole client view ("Failed to fetch" on the Plan tab).
    model_config = ConfigDict(extra="ignore")

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

    notes: Optional[str] = ""


class Client(BaseModel):
    """Minimal client record. Lives at ~/fm-plans/clients/<client_id>.yaml.

    Privacy-conscious by default:
    - `client_id` is opaque (e.g. "cl-12345"); not the legal name.
    - `age_band` rather than exact birthdate (5-year band, e.g. "45-50").
    - `display_name` is optional and intended for a coach's eyes only —
      can be a pseudonym.
    """
    # `extra="ignore"` — historically this was forbid, but every new
    # surface that wrote into client.yaml (uploadReportAction's
    # external_reports list, intake form's evolving sections, etc.)
    # tripped the validator and crashed assess loads. ignore lets us
    # ship features without race-coupling the model. The validator
    # warns on truly-unknown fields elsewhere.
    model_config = ConfigDict(extra="ignore")

    client_id: str
    display_name: str = ""              # for coach's reference; can be pseudonym
    assigned_coach: str = ""            # coach name, e.g. "Shivani" — populates client-facing copy dynamically
    intake_date: date
    date_of_birth: Optional[date] = None   # preferred; used to compute exact age
    age_band: str = ""                  # legacy / derived from DOB; kept for backward compat
    sex: str                            # F | M | other
    active_conditions: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)  # past diagnoses, in-remission conditions, surgeries, prior dx with current status
    current_medications: list[str] = Field(default_factory=list)
    # v2.4 — supplements split from medications so the AI doesn't confuse
    # OTC vitamins/herbs with prescription drugs (e.g. when checking
    # contraindications or building the supplement protocol).
    current_supplements: list[str] = Field(default_factory=list)
    known_allergies: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    notes: str = ""
    # Dietary preferences — used when generating the client-facing meal plan letter
    dietary_preference: str = ""   # Vegetarian | Non-vegetarian | Vegan | Eggetarian | Pescatarian | Other
    # Whether a vegetarian-spectrum client accepts supplements that may
    # contain animal-derived ingredients — fish-oil omega-3, gelatin
    # capsule shells, collagen, cod-liver oil, bovine-derived actives.
    # Asked at intake ONLY when dietary_preference is veg / eggetarian /
    # vegan / jain. Values: "yes" | "no" | "unsure" | "" (not asked).
    # Consumed by: plan checker (suppresses the animal-supplement WARNING
    # when "yes"), the supplement-protocol builder, and the letter
    # generator (so it never recommends fish oil to a "no" client).
    animal_derived_supplements_ok: str = ""
    foods_to_avoid: str = ""       # Free form: "brinjal, bitter gourd, raw onion"
    non_negotiables: str = ""      # Things they won't give up: "morning chai, weekly mutton"
    reported_triggers: str = ""    # n=1 observations: "gluten triggers bloating; afternoon coffee → poor sleep"
    # How structured the client wants her meal plan to be. Some clients
    # cook from feel and find 7-day tables prescriptive; others need the
    # structure to comply. Coach sets at intake or after first call.
    #   detailed   = 7-day Mon-Sun tables (canonical, most structured)
    #   principles = do's/don'ts + categories + portions + 5 ideas per slot
    #   hybrid     = principles FIRST, then a single sample week table
    # Default "hybrid" — works for most new clients; coach can refine.
    meal_plan_style: str = "hybrid"
    # Per-client weight loss goal — set once, applies to ALL meal-plan
    # letters automatically (initial, phase letters 3-4 / 5-6 / etc).
    # When enabled, render-client-letter.py reads this to compute calorie
    # targets + portion control. Without it, meal plans are
    # weight-loss-naive. Sparse: not present on every client.
    #
    # Shape:
    #   weight_loss:
    #     enabled: true | false
    #     starting_weight_kg: 80.0
    #     starting_date: '2026-05-06'
    #     goal_kg: 6.0                     # total to lose
    #     goal_target_date: '2026-08-01'   # by when
    #     pace: slow | moderate | faster
    #     activity_level: sedentary | light | moderate | active
    #     exercise_current: str            # what they currently do
    #     exercise_open_to: str            # what they'd consider
    #     exercise_days_per_week: int
    #     exercise_limitations: str        # e.g. "knee pain (left)"
    #     notes_for_coach: str             # coach-only context
    #     week_overrides:                  # sparse: most clients have []
    #       - weeks: [4, 5]                # week numbers in protocol
    #         mode: maintenance | deeper_deficit | skip
    #         kcal_offset: -200            # only for deeper_deficit
    #         reason: 'Australia travel'
    weight_loss: Optional[dict] = None
    # v2.5 — per-client letter preferences. Some clients refuse supplements,
    # others don't want the exercise plan, others just need the consolidated
    # all-in-one. Default: consolidated only (the most common ship). Coach
    # toggles per-letter via the profile editor; Communicate's send-package
    # surface reads this to decide which letter cards to render.
    # Allowed values match LetterType: consolidated | meal_plan |
    # supplement_plan | lifestyle_guide | exercise_plan.
    letter_types_active: list[str] = Field(
        default_factory=lambda: ["consolidated"]
    )
    city: str = ""                 # e.g. "Mumbai", "Chennai" — used for seasonal/regional meal planning
    country: str = ""              # e.g. "India", "UK" — used for seasonal produce and recipes
    mobile_number: Optional[str] = None   # for duplicate-check; stored hashed or partial if needed
    email: Optional[str] = None           # client email — used by "Send to client" feature
    next_contact_date: Optional[str] = None  # YYYY-MM-DD follow-up reminder date
    family_history: Optional[str] = None  # hereditary diseases / family health history

    # ── Client-facing intake form (tokenised public link) ─────────────────────
    # Coach generates a one-time token, WhatsApps the link /intake/<token>,
    # client fills the form, submission merges payload into this client.yaml
    # and appends a [source: client_intake_form] quick_note session.
    intake_token: Optional[str] = None              # URL-safe random token
    intake_token_expires_at: Optional[datetime] = None
    intake_form_draft: Optional[dict] = None        # in-progress payload, save-per-section
    intake_submitted_at: Optional[datetime] = None  # set on final submit; token revoked after
    # First time the public form page rendered for this token. Lets coach
    # tell at-a-glance whether the client has opened the link at all.
    intake_first_opened_at: Optional[datetime] = None
    # Last time the form draft auto-saved. Distinct from intake_submitted_at:
    # this advances on every per-section save while the client is still
    # filling. Used by IntakeStatusCard to show "Last touched 3 hours ago".
    intake_form_draft_saved_at: Optional[datetime] = None
    # Coach-opt-in flag for the daily auto-reminder cron. Default False —
    # legacy clients onboarded before the intake form existed (e.g., manual
    # creates, or clients who never need to fill it) are left alone. The
    # "📨 Send intake form" button auto-enables this when generating a
    # token; coach can toggle off via UI. The cron in
    # /api/cron/intake-reminders filters on this flag.
    intake_reminder_enabled: bool = False
    intake_reminders_sent_at: list[str] = Field(default_factory=list)
    intake_last_submitted_at: Optional[datetime] = None  # Path A — bumps on every re-submit
    intake_finalised_at: Optional[datetime] = None      # coach-locked, no more edits

    # ── v0.75 two-stage intake state ──────────────────────────────────────────
    # The intake form is gated by stage:
    #   pre_discovery  →  short ~14-field form for the discovery call prep
    #   full           →  current 3693-line full intake, unlocked post-signup
    # The same /intake/<token> URL serves both — server-side routes based on
    # whether intake_full_unlocked_at is set.
    intake_full_unlocked_at: Optional[datetime] = None  # coach flips after signup
    # Coach-visible discovery journey markers — independent of the binary
    # form gate above. Set manually via buttons on the client Overview.
    discovery_session_completed_at: Optional[datetime] = None
    discovery_lab_pack_sent_at: Optional[datetime] = None

    # ── v0.72 structured intake form fields ───────────────────────────────────
    # ~60 new fields captured by the v2 intake form, organised by section
    # (matching docs/INTAKE_FORM_DESIGN_BRIEF.md). All Optional / default-empty
    # so client.yaml files pre-v0.72 load cleanly. Free strings throughout
    # (per coach decision 2026-05-14) — AI handles variant spellings, easier
    # to add chip options without migrations. See IntakeInsights for the
    # AI-summarised view of all this fed to downstream calls.

    # Section 2 — Who you are
    weight_highest_adult: Optional[float] = None     # kg
    weight_lowest_adult: Optional[float] = None      # kg
    weight_trend_current: str = ""        # stable / gaining slowly / losing slowly /
                                          # fluctuating / recently changed sharply
    weight_change_trigger: str = ""       # free text, only when trend = sharp change
    work_pattern: list[str] = Field(default_factory=list)   # chip multi

    # v2.3 body composition today (intake). Both unit variants accepted —
    # client fills whichever is natural. Coach normalises to metric in the
    # measurements block during a session.
    height_cm: Optional[float] = None
    height_ft: Optional[float] = None
    height_in: Optional[float] = None
    weight_now_kg: Optional[float] = None
    weight_now_lb: Optional[float] = None
    waist_cm: Optional[float] = None
    waist_in: Optional[float] = None
    hip_cm: Optional[float] = None
    hip_in: Optional[float] = None
    bp_systolic: Optional[int] = None
    bp_diastolic: Optional[int] = None

    # Section 5 — Family history (specific conditions chip group)
    family_specific_conditions: list[str] = Field(default_factory=list)

    # Section 6 — Medical history (COVID + vaccines)
    covid_history: list[str] = Field(default_factory=list)
    covid_long_symptoms: list[str] = Field(default_factory=list)
    covid_vaccine_history: list[str] = Field(default_factory=list)
    covid_vaccine_brand: list[str] = Field(default_factory=list)
    covid_vaccine_reactions: list[str] = Field(default_factory=list)
    covid_vaccine_reaction_detail: str = ""

    # Section 7 — Medications (layered category buckets — each is a list of
    # entries because the client may have been on multiple drugs in the
    # bucket over time)
    glp1_medications: list[MedicationCategoryEntry] = Field(default_factory=list)
    acid_suppressants: list[MedicationCategoryEntry] = Field(default_factory=list)
    nsaids_daily: list[MedicationCategoryEntry] = Field(default_factory=list)
    antibiotics_last_12mo: list[MedicationCategoryEntry] = Field(default_factory=list)
    hormonal_contraception_hrt: list[MedicationCategoryEntry] = Field(default_factory=list)
    thyroid_medication: list[MedicationCategoryEntry] = Field(default_factory=list)
    psych_medications: list[MedicationCategoryEntry] = Field(default_factory=list)
    biologics_immunosuppressants: list[MedicationCategoryEntry] = Field(default_factory=list)
    statins_bp_diabetes: list[MedicationCategoryEntry] = Field(default_factory=list)

    # Section 8 — Eating patterns
    postprandial_pattern: list[str] = Field(default_factory=list)
    cold_heat_tolerance: str = ""

    # Section 10 — Sleep + energy (extension of existing fields + five_pillars)
    time_to_fall_asleep: str = ""         # under 15 min / 15-30 / 30-60 / 60+
    wake_time_pattern: list[str] = Field(default_factory=list)
    snore_or_apnoea: str = ""             # no / sometimes / often / diagnosed / CPAP
    restless_legs: str = ""
    sleep_tracker_owned: list[str] = Field(default_factory=list)
    cgm_owned: str = ""                   # yes-current / yes-past / no / interested
    energy_crashes: list[str] = Field(default_factory=list)
    caffeine_dependency: str = ""
    morning_state: str = ""

    # Section 11 — Body systems (deeper subsections)
    bristol_stool_typical: list[int] = Field(default_factory=list)   # 1-7, multi
    bowel_frequency_per_day: Optional[int] = None
    bowel_pattern: list[str] = Field(default_factory=list)
    bowel_historical: str = ""
    hair_loss_pattern: str = ""
    hair_texture_change: str = ""
    hair_other: list[str] = Field(default_factory=list)
    nail_signs: list[str] = Field(default_factory=list)
    acne_pattern: list[str] = Field(default_factory=list)
    skin_signs: list[str] = Field(default_factory=list)
    pain_locations: list[str] = Field(default_factory=list)   # body-map region slugs (dev-built)
    headache_type: list[str] = Field(default_factory=list)
    pain_pattern: list[str] = Field(default_factory=list)
    pain_quality: list[str] = Field(default_factory=list)
    belly_fat_pattern: str = ""
    histamine_signals: list[str] = Field(default_factory=list)
    chemical_sensitivity: list[str] = Field(default_factory=list)
    oral_signs: list[str] = Field(default_factory=list)
    eye_signs: list[str] = Field(default_factory=list)

    # Section 12 — Periods (women only) — depth fields + repeaters
    period_pain_severity: Optional[int] = None       # 1-10 slider
    period_pain_impact: str = ""
    pmdd_signs: str = ""
    contraception_history: list[ContraceptionEntry] = Field(default_factory=list)
    pregnancies: list[PregnancyEntry] = Field(default_factory=list)
    repro_diagnoses: list[str] = Field(default_factory=list)
    perimenopause_inventory: list[str] = Field(default_factory=list)
    # Intimate / urinary health (women only) — yeast / microbiome / dryness
    vaginal_signs: list[str] = Field(default_factory=list)
    vaginal_yeast_frequency: str = ""

    # Section 14 — Environment (sun + vit D + grounding)
    sun_exposure_daily: str = ""
    sunscreen_use: str = ""
    vit_d_supplement: str = ""
    barefoot_outdoors: str = ""

    # Section 16 — Readiness (labs + confidence)
    recent_labs_done: list[str] = Field(default_factory=list)
    recent_labs_when: str = ""
    willing_to_share_labs: str = ""
    willing_to_test_further: str = ""
    readiness_confidence: Optional[int] = None       # 1-10 slider

    # ── v0.75.2 Tier 1 screening (joints / standing / recovery / mould) ──
    # New "Movement, joints, standing" section (between Body and Cycle).
    # Catches the MCAS-POTS-EDS / long-COVID / mould-CIRS family on intake
    # rather than 6 months in. All optional / default-empty so older
    # client.yaml files load cleanly.
    beighton_self_score: list[str] = Field(default_factory=list)
    beighton_supplemental: list[str] = Field(default_factory=list)
    hr_devices_owned: list[str] = Field(default_factory=list)
    lean_test_supine_hr: str = ""        # bpm (string; client may not have a device)
    lean_test_standing_hr: str = ""      # bpm
    lean_test_symptoms: list[str] = Field(default_factory=list)
    pem_screen: list[str] = Field(default_factory=list)
    mould_exposure: list[str] = Field(default_factory=list)
    large_fish_frequency: str = ""       # never / rarely / weekly / multiple_weekly

    # ── v0.75.5 Tier 2 screening (ACE-lite / STOP-BANG / Endometriosis) ──
    # ACE-lite: 5 chips for adverse childhood experiences + current
    # hypervigilance patterns. Coach reads patterns, never asks for an
    # explicit ACE score. Drives HPA-axis framing + trauma-informed
    # protocol cautions.
    # STOP-BANG: extends `snore_or_apnoea` with the rest of the STOP-BANG
    # criteria. Apnoea is radically underdiagnosed in women.
    # Endometriosis: women-only. Avg diagnostic delay 7-10 years; coach
    # surfaces from intake.
    ace_signals: list[str] = Field(default_factory=list)
    stop_bang_signals: list[str] = Field(default_factory=list)
    endometriosis_signals: list[str] = Field(default_factory=list)

    # ── v0.75.3 — coach-led physical exam findings (in-session, on Zoom) ──
    # Append-only list of structured findings the coach captures during
    # the session (Beighton verify /9 score, NASA lean test HR series,
    # future: orthostatic vitals trends, in-session tongue / nail / skin
    # observations). Each entry has a `kind` so the SOAP Objective block
    # can show the most-recent of each type. Trend is preserved for
    # rechecks. Free-shape dict to keep schema flexible — the React
    # panels enforce structure on write.
    physical_exam_findings: list[dict] = Field(default_factory=list)

    # AI-generated summary of the structured intake. Lives on disk so every
    # downstream AI call (assess / rework / letter / sanity check) reads the
    # same map without re-generating it. Coach can edit coach_notes_for_ai
    # without regenerating the rest; full regeneration via the 🔄 Refresh
    # button on IntakeInsightsCard. See scripts/generate-intake-insights.py.
    intake_insights: Optional[IntakeInsights] = None

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
    last_menstrual_period: Optional[date] = None  # ISO date of LMP — period START (Day 1)
    last_period_end_date: Optional[date] = None   # last day of real flow (not spotting)
    cycle_length_days: Optional[int] = None       # typical cycle length, default 28 if unset
    cycle_regularity: Optional[str] = None        # regular | irregular | very_irregular
    last_cycle_ask_sent: Optional[date] = None    # date the WhatsApp cycle-date check was last sent
    menopause_started: Optional[str] = None       # freeform (e.g. "2019" or "around age 51")

    # Pregnancy / lactation status — drives supplement safety overlay.
    # Coach updates as the client's status changes. Values mirror
    # fmdb.enums.PregnancyStatus.
    pregnancy_status: Optional[str] = None
    pregnancy_due_date: Optional[date] = None     # if pregnant — for trimester transitions
    lactation_started: Optional[date] = None      # if lactating — for tapering plans

    stress_response: str = ""            # fight/flight (anxious, wired) vs freeze (exhausted, numb) vs mixed
    childhood_history: str = ""          # antibiotic use, gut infections, trauma, ACEs, chronic childhood illness
    toxic_exposures: str = ""            # mold, heavy metals, chemical exposures, long-term medication history
    what_has_worked: str = ""            # past interventions (diet, supplements, lifestyle) that helped
    what_hasnt_worked: str = ""          # things tried that made no difference or worsened symptoms

    # Lifestyle exposures — smoking / tobacco + alcohol (structured)
    smoking_status: str = ""             # never / former / current / chew / prefer-not
    smoking_detail: str = ""             # rough amount + duration (free text)
    alcohol_intake: str = ""             # none / occasional / weekly / most-days / prefer-not

    # Current mental-health care (sensitively framed, optional)
    current_mental_health_care: str = ""  # no / therapist / psychiatrist / both / prefer-not

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
    # Most recent AI plan-rework suggestion (overwritten on each new event).
    # Shape: {generated_at, triggered_by, benefit_pct (0-100), confidence,
    #         rationale, suggested_changes: [...], dismissed_at?, snoozed_until?}
    rework_suggestion: Optional[dict] = None

    # ── 2-stage handover from ochre-followup (the funnel app) ──────────────
    # Added 2026-05-15 as part of the clean-boundary design. State machine:
    #
    #   prospect ── handover/programme-signup ──▶ programme_active
    #                                                  │
    #                            ┌─────────────────────┴─────────────────────┐
    #                            ▼                                            ▼
    #                       paused (coach-set)                  completed (12wk wrap)
    #                                                                         ▼
    #                                                                     dropped
    #
    # Every outbound cron/webhook checks lifecycle_state — see
    # docs/HANDOVER_SPEC.md for the full contract with ochre-followup.
    #
    # `prospect` clients exist in fm-coach as read-only data; nothing
    # outbound fires for them. ochre-followup still owns marketing until
    # programme payment lands, at which point /api/handover/programme-signup
    # flips to `programme_active` + fires the onboarding kit.
    lifecycle_state: str = "programme_active"   # back-compat default for manually-created clients
    handover_source: Optional[str] = None       # "ochre-followup" | "legacy-manual" | None
    handover_received_at: Optional[datetime] = None
    discovery_completed_at: Optional[datetime] = None
    discovery_call_notes: str = ""               # free-form text from ochre's discovery
    programme_started_at: Optional[datetime] = None
    programme_payment_id: Optional[str] = None

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
    # v0.72: free-text phrases citing the intake observations that justified
    # this hypothesis. Populated by the suggester / rework AI when intake
    # data drove the inference. Coach can edit / remove freely. See
    # IntakeInsights for the upstream summary the AI references.
    intake_evidence: list[str] = Field(default_factory=list)


class PracticeItem(BaseModel):
    """Freeform lifestyle practice (sunlight, breathwork, walks, screen-cutoff)."""
    model_config = ConfigDict(extra="forbid")
    name: str                            # freeform — promote to Practice entity later if dup
    cadence: str                         # daily | nightly | weekly | mid-morning | etc.
    details: str = ""
    intake_evidence: list[str] = Field(default_factory=list)  # v0.72 — see HypothesizedDriver


class CustomRemedy(BaseModel):
    """A bespoke kitchen remedy authored for ONE client (not a catalogue slug):
    a digestive churan blended for their symptoms, a vegetable juice, a tea, an
    infused water, etc. Rendered in the letter's 'Drinks & digestives' section
    when present. Standard catalogue remedies still go in home_remedies (slugs)."""
    model_config = ConfigDict(extra="forbid")
    name: str
    kind: str = ""            # churan | tea | juice | infused_water | decoction | other
    ingredients: str = ""     # kitchen-spice ingredients + rough quantities
    preparation: str = ""     # how to make it
    timing: str = ""          # when / how often to take
    reason: str = ""          # coach rationale (why this, for this client)


class NutritionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pattern: str = ""                    # short label like "gentle anti-inflammatory"
    add: list[str] = Field(default_factory=list)             # freeform foods to add
    reduce: list[str] = Field(default_factory=list)          # freeform foods to reduce
    meal_timing: str = ""
    cooking_adjustments: list[str] = Field(default_factory=list)  # CookingAdjustment slugs
    home_remedies: list[str] = Field(default_factory=list)        # HomeRemedy slugs
    custom_remedies: list[CustomRemedy] = Field(default_factory=list)  # bespoke per-client


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
    # Protocol week this supplement is introduced (1-indexed). Default 1 =
    # starts immediately. Phased protocols (5R: Remove→Replace→Reinoculate
    # →Repair) introduce supplements at later weeks — e.g. probiotics at
    # week 3, L-glutamine at week 5. The client-facing shopping list shows
    # ALL supplements at once (so she orders in one trip) but badges each
    # with its start week; the daily schedule tags each row "from Week N".
    # A supplement is active from start_week through start_week +
    # duration_weeks. Backward-compatible: every existing plan reads as
    # start_week 1.
    start_week: int = 1
    titration: str = ""
    coach_rationale: str = ""            # why for this client
    intake_evidence: list[str] = Field(default_factory=list)  # v0.72 — see HypothesizedDriver
    # Per-supplement display + buy-link overrides (2026-05-19). When the
    # supplement_slug points at a brand (vitaone-omega-3) but the actual
    # product the client should buy is different (e.g. Dhanishta needs
    # algae-derived omega-3, not VitaOne fish oil), coach sets these on
    # the plan entry to override the brand name + buy URL in the
    # supplement schedule + shopping list. Falls back to catalogue
    # lookup when null. See render-client-letter.py:
    #   _build_supplement_schedule_html (display_name)
    #   _build_complete_shopping_list_html (buy_link)
    display_name: Optional[str] = None
    buy_link: Optional[str] = None


class LabOrderItem(BaseModel):
    """A lab test the coach is asking the client to obtain through their clinician.

    `test` is freeform for v1 — will become a slug when the LabTest entity
    type is built (per CLAUDE.md roadmap).

    `kind` distinguishes:
      - "new"    — coach hasn't seen this on a prior report; order it fresh.
      - "repeat" — already on file; this is a follow-up re-check at
                   `due_in_weeks` weeks from the session date.
    The AI synthesis surfaces this distinction so the Plan tab doesn't
    show 15 "new orders" that are really 3 new + 12 re-checks of existing
    labs."""
    model_config = ConfigDict(extra="forbid")
    test: str
    reason: str = ""
    kind: Optional[str] = None  # "new" | "repeat"
    due_in_weeks: Optional[int] = None
    intake_evidence: list[str] = Field(default_factory=list)  # v0.72 — see HypothesizedDriver


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
    # Older session YAMLs (intake-form sessions written before this model
    # tightened) carry top-level `version` / `updated_at` / `updated_by`
    # fields. Switch to `ignore` so loads stay silent instead of spewing
    # ValidationWarnings on every assess run.
    model_config = ConfigDict(extra="ignore")

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

    # External reports the coach asked the client to bring back. Late-arriving
    # reports (genetics, GI-MAP, DUTCH, blood panels) get linked back to this
    # session via FunctionalTestRecord.linked_session_id and
    # HealthSnapshot.linked_session_id so the session view shows everything
    # ordered together.
    # Common values: blood_panel_basic | blood_panel_advanced | thyroid_full |
    #                gi_map | dutch_complete | genetics | food_sensitivity | other
    expected_reports: list[str] = Field(default_factory=list)

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

    # ── Effective start dates (delivery-to-adoption lag) ──────────────────
    # Coaches send the plan; clients don't start immediately. Empirically:
    # meal plan starts ~3 days after delivery, supplements ~1 week (they
    # have to order them, receive them, then build the habit).
    # Coach sets these when the client tells her, otherwise the
    # `effective_*_start()` helpers below fall back to plan_period_start +
    # the default delay. Recheck date should be computed off the effective
    # meal-plan start, not the plan_period_start, so the 12-week window
    # actually covers 12 weeks of doing-the-thing.
    meal_plan_started_on: Optional[date] = None
    supplements_started_on: Optional[date] = None

    # ── Client-facing start-date confirmation (tokenised public link) ──────
    # Coach clicks "Get client confirm link" on the plan editor → generates a
    # tokenised /start/<token> URL that the client opens to confirm or change
    # their meal_plan_started_on. See start-date-action.py shim + the
    # /start/[token] route. Same pattern as Client.intake_token but lives
    # on the Plan because the confirmation is per-plan.
    start_confirmation_token: Optional[str] = None
    start_confirmation_expires_at: Optional[datetime] = None
    start_confirmation_used_at: Optional[datetime] = None

    # ── Public letter link (tokenised /letter/<token> URL) ────────────────
    # Minted by the letter-generation flow so the client can open the
    # phone-friendly consolidated letter without auth. Written by the
    # Next.js letter pipeline; declared here so plan-check (which loads
    # plans through this Pydantic model with extra="forbid") doesn't choke.
    letter_token: Optional[str] = None
    letter_token_created_at: Optional[datetime] = None
    # 7-char public short code for the letter link (/l/<code> → /letter/<token>),
    # written by the Next.js letter-token Server Action. Declared here so
    # plan-check + the Python letter pipeline (extra="forbid") don't choke.
    letter_short_code: Optional[str] = None

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
    # ── Outcome tracking (Phase 1) ─────────────────────────────────────────
    # Captured at plan publish time. Anchors "what was this client like
    # BEFORE this plan?" so downstream delta computation can attribute
    # changes (lab movements, symptom resolution, weight changes) to the
    # interventions in this plan rather than to free-floating "they just
    # got better".
    # Shape (free dict — Pydantic doesn't enforce the inner schema; the
    # capture function in transitions.py emits a stable structure):
    #   {
    #     "captured_at": "2026-05-16T..."  (ISO timestamp),
    #     "plan_period_start": "2026-05-16",
    #     "lab_markers": [{"marker_name", "value", "unit", "flag",
    #                       "reference_range"}, ...],
    #     "measurements": {"weight_kg", "height_cm", "waist_cm",
    #                       "blood_pressure_systolic", ...},
    #     "presenting_symptoms": ["fatigue", "brain-fog", ...],
    #     "active_conditions": ["hashimotos", "postmenopausal", ...],
    #     "five_pillars": {...}  (most recent if within 30d),
    #     "source_snapshot_date": "2026-04-30"  (the source
    #                       client.lab_markers_date used for labs),
    #   }
    # Empty dict for plans published before this field landed.
    baseline_snapshot: dict = Field(default_factory=dict)
    version: int = 1
    created_at: datetime
    updated_at: datetime
    updated_by: str
    supersedes: Optional[str] = None     # slug of plan this replaces (if any)

    # ── Defaults for the delivery-to-adoption lag ──────────────────────────
    # If the coach didn't capture the actual start date, the helpers below
    # fall back to plan_period_start + these defaults. Empirically observed
    # by Shivani 2026-05-14: clients take 2-3 days to start the meal plan
    # (need to grocery shop, prep) and ~1 week to start supplements (have
    # to be ordered, delivered, then habit-built).
    MEAL_PLAN_DEFAULT_DELAY_DAYS: int = 3
    SUPPLEMENTS_DEFAULT_DELAY_DAYS: int = 7

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"plan slug must be lowercase alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"plan slug has malformed hyphens: {v!r}")
        return v

    def effective_meal_plan_start(self) -> date:
        """Date the client actually started (or is assumed to have started)
        the meal plan. Coach-asserted value wins; otherwise plan_period_start
        + MEAL_PLAN_DEFAULT_DELAY_DAYS."""
        if self.meal_plan_started_on:
            return self.meal_plan_started_on
        from datetime import timedelta
        return self.plan_period_start + timedelta(days=self.MEAL_PLAN_DEFAULT_DELAY_DAYS)

    def effective_supplements_start(self) -> date:
        """Date the client actually started supplements. Coach-asserted
        value wins; otherwise plan_period_start + SUPPLEMENTS_DEFAULT_DELAY_DAYS."""
        if self.supplements_started_on:
            return self.supplements_started_on
        from datetime import timedelta
        return self.plan_period_start + timedelta(days=self.SUPPLEMENTS_DEFAULT_DELAY_DAYS)

    def effective_recheck_date(self) -> date:
        """Computed recheck date based on EFFECTIVE meal-plan start, not the
        plan-period-start. This is what the dashboard, calendar, and coach
        nudges should use — the 12-week protocol window should give the
        client 12 weeks of actually doing the thing, not 12 weeks counting
        from the day the letter was emailed.

            effective_meal_plan_start + plan_period_weeks × 7

        Note: the stored `plan_period_recheck_date` field stays as the
        originally-scheduled date (audit / legacy display); coach-facing
        UI should call this method to get the live one.
        """
        from datetime import timedelta
        return self.effective_meal_plan_start() + timedelta(weeks=self.plan_period_weeks)

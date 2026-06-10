/**
 * Lenient TypeScript shapes for the catalogue + plans entities.
 * Pydantic owns validation in the Python engine; these types only describe
 * the fields the Next UI actually renders. Unknown fields fall through.
 */

export type EvidenceTier =
  | "strong"
  | "plausible_emerging"
  | "fm_specific_thin"
  | "confirm_with_clinician";

export type Lifecycle = "active" | "deprecated" | "draft";

export interface SourceCitation {
  id: string;
  location?: string;
  quote?: string;
}

export interface BaseEntity {
  slug: string;
  display_name?: string;
  aliases?: string[];
  evidence_tier?: EvidenceTier;
  status?: Lifecycle;
  version?: number;
  updated_at?: string;
  updated_by?: string;
  sources?: SourceCitation[];
  [key: string]: unknown;
}

export interface Topic extends BaseEntity {
  summary?: string;
  common_symptoms?: string[];
  red_flags?: string[];
  related_topics?: string[];
  key_mechanisms?: string[];
  coaching_scope_notes?: string;
  clinician_scope_notes?: string;
  notes_for_coach?: string;
}

export interface Mechanism extends BaseEntity {
  category?: string;
  summary?: string;
  upstream_drivers?: string[];
  downstream_effects?: string[];
  related_mechanisms?: string[];
  linked_to_topics?: string[];
  notes_for_coach?: string;
}

export interface Symptom extends BaseEntity {
  category?: string;
  severity?: "common" | "concerning" | "red_flag";
  description?: string;
  when_to_refer?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  notes_for_coach?: string;
}

export interface Claim extends BaseEntity {
  statement?: string;
  rationale?: string;
  coaching_translation?: string;
  caveats?: string[];
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  linked_to_supplements?: string[];
  out_of_scope_notes?: string;
}

export interface DoseRange {
  min?: number;
  max?: number;
  unit?: string;
}

export interface Supplement extends BaseEntity {
  category?: string;
  forms_available?: string[];
  typical_dose_range?: Record<string, DoseRange>;
  timing_options?: string[];
  take_with_food?: string;
  contraindications?: {
    conditions?: string[];
    medications?: string[];
    life_stages?: string[];
  };
  interactions?: Record<string, unknown>;
  pregnancy_safety?: SafetyStatus;
  lactation_safety?: SafetyStatus;
  pregnancy_safety_note?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  linked_to_claims?: string[];
  notes?: string;
  notes_for_coach?: string;
}

export interface Source extends BaseEntity {
  // Sources use `id` on disk, not `slug`. The catalogue page normalizes
  // `slug` to mirror `id` for routing; both are populated here.
  id?: string;
  title?: string;
  source_type?: string;
  quality?: "high" | "moderate" | "low";
  authors?: string[];
  url?: string;
  year?: number;
  publisher?: string;
  internal_path?: string;
  doi?: string;
  notes?: string;
}

export interface MindMap extends BaseEntity {
  description?: string;
  related_topics?: string[];
  related_mechanisms?: string[];
  tree?: unknown;
}

export interface CookingAdjustment extends BaseEntity {
  category?: string;
  summary?: string;
  swap_from?: string;
  benefits?: string[];
  how_to_use?: string;
  cautions?: string[];
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
}

export interface HomeRemedy extends BaseEntity {
  category?: string;
  summary?: string;
  indications?: string[];
  contraindications?: string[];
  preparation?: string;
  typical_dose?: string;
  duration?: string;
  timing_notes?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
}

export interface ProtocolPhase {
  name: string;
  weeks?: number | null;
  summary?: string;
  key_actions?: string[];
}

export interface Protocol extends BaseEntity {
  category?: string;
  summary?: string;
  indications?: string[];
  contraindications?: string[];
  typical_duration_weeks?: number | null;
  phases?: ProtocolPhase[];
  key_steps?: string[];
  foods_to_emphasise?: string[];
  foods_to_remove?: string[];
  supplements_typically_used?: string[];
  expected_outcomes?: string[];
  cautions?: string[];
  prerequisites?: string[];
  recommended_followup?: string[];
  incompatible_with?: string[];
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  linked_to_symptoms?: string[];
  notes_for_coach?: string;
}

export interface TitrationStep {
  week: number;
  morning?: number;
  midday?: number;
  evening?: number;
  bedtime?: number;
  notes?: string;
}

export interface TitrationProtocol extends BaseEntity {
  supplement_slug: string;
  purpose?: string;
  indications?: string[];
  contraindications?: string[];
  product_strength?: string;
  available_at?: string[];
  target_dose_label?: string;
  target_total_per_day?: string;
  schedule?: TitrationStep[];
  splittable?: boolean;
  cautions?: string[];
  monitoring?: string[];
  notes_for_coach?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
}

export interface LabTest extends BaseEntity {
  full_name?: string;
  units?: string;
  sample_type?: string;
  conventional_low?: number | null;
  conventional_high?: number | null;
  fm_optimal_low?: number | null;
  fm_optimal_high?: number | null;
  interpretation_low?: string;
  interpretation_high?: string;
  when_to_order?: string;
  fasting_required?: boolean;
  typical_cost_inr?: number | null;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  notes_for_coach?: string;
}

export interface LabPanel extends BaseEntity {
  category?: string;
  summary?: string;
  indications?: string[];
  tests?: string[];                  // LabTest slugs (core)
  optional_tests?: string[];         // LabTest slugs (add-on)
  fasting_required?: boolean;
  estimated_cost_inr?: number | null;
  typical_turnaround_days?: number | null;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
  notes_for_coach?: string;
}

export type SafetyStatus = "safe" | "likely_safe" | "caution" | "contraindicated" | "unknown";

export type PregnancyStatus =
  | "not_applicable"
  | "not_pregnant"
  | "trying_to_conceive"
  | "pregnant_first_trimester"
  | "pregnant_second_trimester"
  | "pregnant_third_trimester"
  | "lactating"
  | "postpartum_not_lactating";

export interface NutrientDepletion {
  nutrient: string;
  severity?: "mild" | "moderate" | "severe";
  mechanism?: string;
  monitoring_recommendation?: string;
  typical_supplement_dose?: string;
}

export interface DrugDepletion extends BaseEntity {
  drug_name: string;
  drug_aliases?: string[];
  drug_class?: string;
  summary?: string;
  depletes?: NutrientDepletion[];
  timing_separations?: string[];
  contraindicated_supplements?: string[];
  monitoring_labs?: string[];
  coach_notes?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
}

// ---- Plan + Client (PHI) ----

export type PlanStatus =
  | "draft"
  | "ready_to_publish"
  | "published"
  | "superseded"
  | "revoked"
  | "graduated";

/**
 * Strict declared shape for Plan — every field the editor reads or writes.
 * No index signature here, so unknown keys fail at type-check.
 */
export interface PlanFields {
  slug: string;
  client_id?: string;
  schema_version?: number;
  plan_period_start?: string;
  plan_period_weeks?: number;
  plan_period_recheck_date?: string;
  primary_topics?: string[];
  contributing_topics?: string[];
  presenting_symptoms?: string[];
  hypothesized_drivers?: unknown[];
  lifestyle_practices?: unknown[];
  nutrition?: Record<string, unknown>;
  education?: unknown[];
  /** Optional Ayurveda layer. Null/absent = no Ayurveda section. Shape mirrors
   *  the Python AyurvedaSection: current_imbalance, balancing_focus,
   *  dietary_guidance, dinacharya[], remedies[] (HomeRemedy slugs),
   *  custom_remedies[], seasonal_note, coach_notes. Renders into consolidated +
   *  lifestyle_guide letters when the client has ayurveda_enabled. */
  ayurveda?: Record<string, unknown> | null;
  supplement_protocol?: unknown[];
  lab_orders?: unknown[];
  referrals?: unknown[];
  tracking?: Record<string, unknown>;
  attached_resources?: string[];
  attached_protocols?: string[];
  notes_for_coach?: string;
  status?: PlanStatus;
  version?: number;
  updated_at?: string;
  updated_by?: string;
  catalogue_snapshot?: Record<string, unknown>;
  /** Outcome-tracking baseline captured at plan publish (or backfilled
   *  from the closest pre-publish health_snapshot). Empty for plans
   *  published before Phase 1 of outcome tracking landed. */
  baseline_snapshot?: Record<string, unknown>;
  // Loader-only metadata (set when reading from disk).
  _bucket?: string;
  _file?: string;
  // Lifecycle bookkeeping (synthesized by lifecycle-actions on supersede).
  supersedes?: string;
  status_history?: unknown[];
  /** Token granting public read access to the consolidated client letter
   *  at /letter/<token>. Generated at plan publish; revoked when the
   *  plan is superseded or revoked. */
  letter_token?: string | null;
  letter_token_created_at?: string | null;
}

/**
 * Permissive Plan type used by loader output and lifecycle workflows that
 * synthesize successors with ad-hoc fields. Has an index signature so old
 * call-sites don't break. For typed-update paths, use `PlanPatch` (strict).
 */
export interface Plan extends PlanFields {
  [key: string]: unknown;
}

/**
 * Strict patch type for partial plan updates. Only the explicitly declared
 * `PlanFields` keys are accepted — typos like `{lifestyle: [...]}` (real
 * key: `lifestyle_practices`) fail at type-check rather than silently no-op
 * the save. v0.30.
 */
export type PlanPatch = Partial<PlanFields>;

/** Per-week override on the weight loss config — sparse list. Each
 *  entry adjusts what the meal-plan letter computes for the named weeks.
 *  Examples: travel week → maintenance (no deficit), pre-event push →
 *  deeper deficit with a custom kcal offset, refeed week → skip
 *  weight-loss content entirely. */
export interface WeightLossWeekOverride {
  /** Date range the override applies to (inclusive). Letter generator
   *  maps these dates → week numbers at build time via
   *  (date - plan.created_at) / 7. Coach thinks in dates ("she's gone
   *  22 Jun – 6 Jul"), not protocol weeks. */
  date_from: string;                  // YYYY-MM-DD
  date_to: string;                    // YYYY-MM-DD
  mode: "maintenance" | "deeper_deficit" | "skip";
  /** Negative kcal — only used when mode === "deeper_deficit". */
  kcal_offset?: number;

  /** What kind of override this is. Drives how the meal-plan letter
   *  reshapes that week's content. `travel` triggers localised
   *  meal-swap mode (regional staples, restaurant guidance,
   *  what-to-order-at-the-airport). `festival` relaxes restrictions
   *  for cultural meals. `plateau_break` is a coach-initiated
   *  diet break. `illness` skips structure entirely. */
  context?: "travel" | "festival" | "illness" | "plateau_break" | "other";

  /** Travel destination — used by render-client-letter.py when
   *  context === "travel" to swap to local cuisine + restaurant
   *  guidance + airport/hotel breakfast tips. City + country, e.g.
   *  "Sydney, Australia" or "Bangkok, Thailand". */
  location?: string;

  /** Free-text sticky note for the coach (e.g. "work trip with
   *  client lunches", "wedding week"). Surfaces in the letter only
   *  when context is set. */
  reason?: string;

  /** Legacy field — kept for back-compat with any overrides created
   *  before the date_from/date_to migration. Loader prefers dates if
   *  present. */
  weeks?: number[];
}

/** Per-client weight loss commitment. Persists across plans. Set ONCE
 *  on Overview; coach adds week_overrides for travel / festivals /
 *  plateau breaks. Read by render-client-letter.py to compute calorie
 *  targets + portion control. */
export interface WeightLossGoal {
  enabled: boolean;
  starting_weight_kg: number;
  starting_date: string;          // YYYY-MM-DD
  goal_kg: number;                // total kg to lose
  goal_target_date: string;       // YYYY-MM-DD by when
  pace: "slow" | "moderate" | "faster";
  activity_level: "sedentary" | "light" | "moderate" | "active";
  exercise_current?: string;
  exercise_open_to?: string;
  exercise_days_per_week?: number;
  exercise_limitations?: string;
  /** Coach-only context — never sent to client. */
  notes_for_coach?: string;
  week_overrides?: WeightLossWeekOverride[];
}

export interface MeasurementEntry {
  date: string;                       // YYYY-MM-DD
  weight_kg?: number;
  waist_cm?: number;
  hip_cm?: number;
  height_cm?: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  resting_heart_rate?: number;
  notes?: string;
}

export interface TimelineEvent {
  year?: number;
  date?: string;
  event: string;
  category?: string;                  // life_event | symptom_onset | diagnosis | surgery | medication_change | other
}

export interface FivePillarsAssessment {
  sleep_hours?: number;
  sleep_quality?: number;             // 1-5
  sleep_issues?: string;
  stress_level?: number;              // 1-5
  stress_type?: string;
  movement_days_per_week?: number;
  movement_type?: string;
  movement_intensity?: string;
  nutrition_quality?: number;         // 1-5
  connection_quality?: number;        // 1-5
  connection_notes?: string;
  notes?: string;
}

export interface Client {
  client_id: string;
  intake_date?: string;
  date_of_birth?: string;   // YYYY-MM-DD — preferred; system computes age from this
  age_band?: string;        // legacy fallback if DOB not set
  sex?: string;
  email?: string;           // client email for sending plan handouts
  next_contact_date?: string; // YYYY-MM-DD — coach-set follow-up reminder
  active_conditions?: string[];
  medications?: string[];
  current_medications?: string[];
  allergies?: string[];
  known_allergies?: string[];
  goals?: string[];
  notes?: string;
  mobile_number?: string;
  display_name?: string;
  family_history?: string;

  // Location / CRM
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;

  // Diet & lifestyle
  dietary_preference?: string;   // Vegetarian | Non-vegetarian | Vegan | Eggetarian | Pescatarian | Other
  foods_to_avoid?: string;       // free form
  non_negotiables?: string;      // things they won't give up
  reported_triggers?: string;

  // Ayurveda layer (opt-in per client; default off)
  /** Master switch — when true the editor shows the Ayurveda section, the
   *  suggester scores constitution, and the letter renders the Ayurvedic block. */
  ayurveda_enabled?: boolean;
  /** Prakruti (lifelong constitution) — coach-confirmed, set once. */
  ayurveda_constitution?: string;
  ayurveda_constitution_notes?: string;
  /** Lifelong-frame dosha quiz answers {trait_key: "vata"|"pitta"|"kapha"}. */
  dosha_self_assessment?: Record<string, string>;
  dosha_self_assessment_completed_at?: string;
  /** Latest AI constitution read (scores, vikruti_doshas, agni, evidence…). */
  ayurveda_assessment?: Record<string, unknown> | null;

  /** How structured the client wants her meal plan letters to be.
   *    detailed   = 7-day Mon-Sun tables
   *    principles = do's/don'ts + categories + portions + 5 ideas/slot
   *    hybrid     = principles first, then a sample week (default) */
  meal_plan_style?: "detailed" | "principles" | "hybrid";

  /** Per-client weight loss goal. Persists across plan revisions. Read
   *  by render-client-letter.py to compute calorie targets + portion
   *  control + per-week mode overrides. Null = no goal active. */
  weight_loss?: WeightLossGoal;

  // Clinical
  medical_history?: string[];

  // FM Intake
  digestion_notes?: string;
  sleep_notes?: string;
  energy_pattern?: string;
  menstrual_notes?: string;

  // Cycle sync (women clients) — drives phase-synced nutrition + movement
  // in the plan generator. cycle_status is the master switch.
  cycle_status?: "menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable";
  last_menstrual_period?: string;     // ISO YYYY-MM-DD — period START (Day 1)
  last_period_end_date?: string;      // ISO YYYY-MM-DD — last day of real flow
  cycle_length_days?: number;          // default 28
  cycle_regularity?: "regular" | "irregular" | "very_irregular";
  last_cycle_ask_sent?: string;        // ISO date — WhatsApp cycle-date check last sent
  menopause_started?: string;          // ISO YYYY-MM-DD

  // Pregnancy / lactation — drives supplement safety overlay
  pregnancy_status?: PregnancyStatus;
  pregnancy_due_date?: string;         // ISO YYYY-MM-DD
  lactation_started?: string;          // ISO YYYY-MM-DD

  stress_response?: string;
  childhood_history?: string;
  toxic_exposures?: string;
  what_has_worked?: string;
  what_hasnt_worked?: string;

  // Five Pillars
  five_pillars?: FivePillarsAssessment;

  // Health timeline
  timeline_events?: TimelineEvent[];

  // Measurements — time-series log (new) + legacy flat object (old)
  measurements_log?: MeasurementEntry[];
  measurements?: Record<string, unknown>;
  lab_markers?: Array<{
    marker_name: string;
    value: number;
    unit: string;
    reference_range: string;
    flag: string;
    fm_interpretation: string;
    computed?: boolean;
  }>;
  lab_markers_date?: string;
  external_reports?: Array<{
    id: string;
    type: string;
    display_type: string;
    file_name: string;
    file_path: string;
    date_uploaded: string;
    date_of_report?: string;
    lab_name?: string;
    key_findings: string[];
    summary: string;
    extracted: Record<string, unknown>;
  }>;
  health_snapshots?: Array<{
    date: string;           // YYYY-MM-DD
    source: string;         // e.g. "transcript-call.pdf", "manual-2026-05-04"
    linked_session_id?: string;   // session that ordered this report
    measurements?: {
      height_cm?: number | null;
      weight_kg?: number | null;
      bp_systolic?: number | null;
      bp_diastolic?: number | null;
      hr_bpm?: number | null;
      waist_cm?: number | null;
      hip_cm?: number | null;
    };
    lab_values?: Array<{ test_name: string; value: string; unit: string }>;
    medications?: string[];
    conditions?: string[];
  }>;
  rework_suggestion?: ReworkSuggestion | null;
  [key: string]: unknown;
}

/** AI plan-rework suggestion stored on Client. Overwritten on each fire. */
export interface ReworkSuggestion {
  generated_at: string;        // ISO datetime
  triggered_by: string;        // "check_in" | "quick_note" | "functional_test" | "lab_snapshot" | "genetic_report"
  benefit_pct: number;         // 0-100 estimated improvement vs current plan
  confidence: "low" | "medium" | "high";
  rationale: string;           // 2-3 sentences
  suggested_changes: Array<{
    op: "add" | "remove" | "escalate" | "deescalate" | "swap";
    target_kind: "supplement" | "topic" | "practice" | "lab_order" | "education";
    target_slug?: string;
    description: string;       // human-readable
    reason: string;
  }>;
  dismissed_at?: string;       // ISO datetime — coach dismissed
  snoozed_until?: string;      // ISO date — coach snoozed
  applied_at?: string;         // ISO datetime — coach applied it into a draft plan
  applied_to_plan?: string;    // slug of the draft created/updated by the apply
}

export type CatalogueKind =
  | "topics"
  | "mechanisms"
  | "symptoms"
  | "claims"
  | "supplements"
  | "sources"
  | "mindmaps"
  | "cooking_adjustments"
  | "home_remedies"
  | "protocols"
  | "drug_depletions"
  | "titration_protocols"
  | "lab_tests"
  | "lab_panels";

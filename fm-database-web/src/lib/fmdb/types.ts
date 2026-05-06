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

// ---- Plan + Client (PHI) ----

export type PlanStatus =
  | "draft"
  | "ready_to_publish"
  | "published"
  | "superseded"
  | "revoked";

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
  supplement_protocol?: unknown[];
  lab_orders?: unknown[];
  referrals?: unknown[];
  tracking?: Record<string, unknown>;
  attached_resources?: string[];
  notes_for_coach?: string;
  status?: PlanStatus;
  version?: number;
  updated_at?: string;
  updated_by?: string;
  catalogue_snapshot?: Record<string, unknown>;
  // Loader-only metadata (set when reading from disk).
  _bucket?: string;
  _file?: string;
  // Lifecycle bookkeeping (synthesized by lifecycle-actions on supersede).
  supersedes?: string;
  status_history?: unknown[];
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
  dietary_preference?: string;   // Vegetarian | Non-vegetarian | Vegan | Eggetarian | Pescatarian | Other
  foods_to_avoid?: string;       // free form
  non_negotiables?: string;      // things they won't give up
  medical_history?: string[];
  measurements?: Record<string, unknown>;
  display_name?: string;
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
  [key: string]: unknown;
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
  | "home_remedies";

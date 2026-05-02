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
}

export interface Mechanism extends BaseEntity {
  category?: string;
  summary?: string;
  upstream_drivers?: string[];
  downstream_effects?: string[];
  related_mechanisms?: string[];
  linked_to_topics?: string[];
}

export interface Symptom extends BaseEntity {
  category?: string;
  severity?: "common" | "concerning" | "red_flag";
  description?: string;
  when_to_refer?: string;
  linked_to_topics?: string[];
  linked_to_mechanisms?: string[];
}

export interface Claim extends BaseEntity {
  statement?: string;
  rationale?: string;
  coaching_translation?: string;
  caveats?: string[];
  linked_to_topics?: string[];
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
}

export interface Source extends BaseEntity {
  title?: string;
  source_type?: string;
  source_quality?: "high" | "moderate" | "low";
  authors?: string[];
  url?: string;
  year?: number;
  internal_path?: string;
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
  swap_from?: string;
  benefits?: string[];
  how_to_use?: string;
  cautions?: string[];
}

export interface HomeRemedy extends BaseEntity {
  category?: string;
  indications?: string[];
  contraindications?: string[];
  preparation?: string;
  typical_dose?: string;
  duration?: string;
  timing_notes?: string;
}

// ---- Plan + Client (PHI) ----

export type PlanStatus =
  | "draft"
  | "ready_to_publish"
  | "published"
  | "superseded"
  | "revoked";

export interface Plan {
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
  status?: PlanStatus;
  version?: number;
  catalogue_snapshot?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Client {
  client_id: string;
  intake_date?: string;
  age_band?: string;
  sex?: string;
  active_conditions?: string[];
  medications?: string[];
  allergies?: string[];
  goals?: string[];
  notes?: string;
  medical_history?: string[];
  measurements?: Record<string, unknown>;
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

// Pure types — safe to import from client components.

export interface AssessAttachment {
  path: string;
  mime_type: string;
  kind: "lab_report" | "food_journal";
}

export interface AssessInput {
  client_id: string;
  symptoms: string[];
  topics: string[];
  complaints: string;
  attachments?: AssessAttachment[];
  dry_run?: boolean;
  /** ISO date string (YYYY-MM-DD) to record as the session date. Defaults to today. */
  session_date?: string;
}

export interface AssessUsage {
  model?: string;
  stop_reason?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface ComputedRatio {
  marker_name: string;
  value: number;
  unit: string;
  reference_range: string;
  flag: string;
  fm_interpretation: string;
  computed?: boolean;
}

// ---------------------------------------------------------------------------
// Typed sub-models for the AssessSuggestions payload
// ---------------------------------------------------------------------------

export interface ExtractedLab {
  test_name: string;
  value: string;
  unit?: string;
  reference_range?: string;
  flag?: string;          // low | normal | high | optimal | suboptimal | unknown
  fm_interpretation?: string;
  date_drawn?: string | null;
}

export interface LikelyDriver {
  mechanism_slug: string;
  rank: number;
  reasoning: string;
  supporting_evidence?: string[];
}

export interface TopicInPlay {
  topic_slug: string;
  role: string;           // primary | contributing
  rationale?: string;
  confidence_pct?: number | null;
}

export interface AdditionalSymptomToScreen {
  symptom_slug: string;
  why_screen?: string;
}

export interface LifestyleSuggestion {
  name: string;
  cadence: string;
  details?: string;
  rationale?: string;
  addresses_mechanism?: string[];
}

export interface NutritionSuggestions {
  pattern?: string;
  add?: string[];
  reduce?: string[];
  meal_timing?: string;
  cooking_adjustment_slugs?: string[];
  home_remedy_slugs?: string[];
  rationale?: string;
}

export interface SupplementSuggestion {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  duration_weeks?: number | null;
  rationale?: string;
  evidence_tier_caveat?: string;
  contraindication_check?: string;
}

export interface LabFollowup {
  test: string;
  reason: string;
}

export interface ReferralTrigger {
  to: string;
  reason: string;
  urgency: string;        // routine | soon | urgent | emergency
}

export interface EducationFraming {
  target_kind: string;    // topic | mechanism | claim
  target_slug: string;
  client_facing_summary: string;
}

export interface CatalogueAdditionSuggested {
  kind: string;
  name: string;
  why: string;
}

export interface AssessSuggestions {
  extracted_labs: ExtractedLab[];
  likely_drivers: LikelyDriver[];
  topics_in_play: TopicInPlay[];
  additional_symptoms_to_screen: AdditionalSymptomToScreen[];
  lifestyle_suggestions: LifestyleSuggestion[];
  nutrition_suggestions: NutritionSuggestions;
  supplement_suggestions: SupplementSuggestion[];
  lab_followups: LabFollowup[];
  referral_triggers: ReferralTrigger[];
  education_framings: EducationFraming[];
  synthesis_notes: string;
  catalogue_additions_suggested: CatalogueAdditionSuggested[];
}

// ---------------------------------------------------------------------------
// Top-level result shapes
// ---------------------------------------------------------------------------

export interface AssessResult {
  ok: boolean;
  session_id?: string;
  suggestions?: AssessSuggestions;
  computed_ratios?: ComputedRatio[];
  usage?: AssessUsage;
  subgraph_size_bytes?: number;
  error?: string | null;
}

export interface GenerateDraftInput {
  client_id: string;
  session_id: string;
  picks: Record<string, boolean>;
}

export interface GenerateDraftResult {
  ok: boolean;
  slug?: string;
  path?: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Multi-turn chat (Assess follow-up panel) — wraps fmdb.assess.suggester.chat.
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  at?: string; // ISO timestamp (set server-side on persist)
}

export interface ChatInput {
  client_id: string;
  session_id: string;
  history: ChatTurn[];
  user_message: string;
  dry_run?: boolean;
}

export interface ChatResult {
  ok: boolean;
  assistant_message?: string;
  usage?: AssessUsage;
  error?: string | null;
}

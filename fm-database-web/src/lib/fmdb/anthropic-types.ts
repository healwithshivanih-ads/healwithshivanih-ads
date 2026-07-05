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
  /**
   * $0 path — skips both preflight guards and the Anthropic call entirely
   * (no model output means no truncation risk, so the usual symptom+topic
   * cap doesn't apply). `true` sends an empty scaffold: topics_in_play mirrors
   * the coach's own `topics` selection, everything else stays empty for her
   * to fill in via the plan editor. Used by the "Skip AI — draft manually"
   * button that appears when the dashboard preflight blocks a broad selection.
   */
  manual_suggestions?: boolean;
  /** ISO date string (YYYY-MM-DD) to record as the session date. Defaults to today. */
  session_date?: string;
  /** Optional Five Pillars snapshot captured alongside the full session. */
  five_pillars?: {
    sleep_hours?: number;
    sleep_quality?: number;
    stress_level?: number;
    movement_days_per_week?: number;
    nutrition_quality?: number;
    connection_quality?: number;
  };
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

export type ATMRole = "antecedent" | "trigger" | "mediator" | "expression";

export interface LikelyDriver {
  mechanism_slug: string;
  rank: number;
  reasoning: string;
  supporting_evidence?: string[];
  /** ATM cognitive model classification — antecedent / trigger / mediator / expression. */
  atm_role?: ATMRole | null;
  /** Mechanism slugs of OTHER drivers that PRECEDE this one in the cascade. Empty for antecedents/triggers. */
  parents?: string[];
  /** 1-2 sentences explaining why this driver sits at this position in the chain. */
  chain_evidence?: string;
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
  /** How the client ramps to the target dose. India-aware: uses
   *  whole capsules / tablets, every-other-day → daily, or practical
   *  split methods (open capsule + half the powder, cut tablet, etc.). */
  titration?: string;
  rationale?: string;
  evidence_tier_caveat?: string;
  contraindication_check?: string;
  vitaone_url?: string;
  /** v2.4 — `true` when the client is already taking this supplement
   *  (matched against `client_context.current_supplements`). Drives the
   *  badge in the UI: "✓ Continue" / "↻ Adjust" / "✕ Stop" instead of
   *  the default "+ New". */
  is_existing?: boolean;
  /** v2.4 — explicit decision for already-on-file supplements. "new"
   *  for fresh recommendations; "continue" / "adjust" / "stop" for
   *  current supplements. */
  continue_or_change?: "new" | "continue" | "adjust" | "stop";
}

/** Per-factor 1–5 fit scores. Server-side computes the weighted overall %. */
export interface FactorScores {
  symptoms: number;          // weight 20%
  medical_safety: number;    // weight 18%
  labs: number;              // weight 15%
  goals: number;             // weight 10%
  gut_function: number;      // weight 10%
  metabolic_health: number;  // weight  8%
  nutrient_status: number;   // weight  7%
  lifestyle: number;         // weight  5%
  culture: number;           // weight  3%
  real_world_fit: number;    // weight  2%
  sustainability: number;    // weight  2%
}

export interface ProtocolSuggestion {
  protocol_slug: string;
  why_indicated: string;
  factor_scores?: FactorScores;
  fit_percent?: number | null;        // 20–100, computed from factor_scores
  when_to_start?: string;
  expected_weeks?: number | null;
  client_specific_modifications?: string;
  contraindication_check?: string;
}

/** Weights for the 11 factors (sum = 100). Mirrors fmdb/assess/results.py::_FACTOR_WEIGHTS. */
export const FACTOR_WEIGHTS: Record<keyof FactorScores, number> = {
  symptoms: 20,
  medical_safety: 18,
  labs: 15,
  goals: 10,
  gut_function: 10,
  metabolic_health: 8,
  nutrient_status: 7,
  lifestyle: 5,
  culture: 3,
  real_world_fit: 2,
  sustainability: 2,
};

/** Human-readable labels for factor breakdown UI. */
export const FACTOR_LABELS: Record<keyof FactorScores, string> = {
  symptoms: "Symptoms + chief complaints",
  medical_safety: "Medical safety (Dx, meds, history)",
  labs: "Labs + biomarkers",
  goals: "Health goals alignment",
  gut_function: "Gut function + food reactions",
  metabolic_health: "Metabolic health",
  nutrient_status: "Nutrient status / deficiencies",
  lifestyle: "Lifestyle (sleep, stress, movement)",
  culture: "Culture / ethics / preferences",
  real_world_fit: "Real-world fit (budget, access, family)",
  sustainability: "Long-term sustainability",
};

export interface LabFollowup {
  test: string;
  reason: string;
  /** "new" (default — coach should order) or "repeat" (already on file, re-check). */
  kind?: "new" | "repeat";
  /** When kind=repeat: weeks from session date to re-test. */
  due_in_weeks?: number;
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

/**
 * AI-classified IFM timeline event. Persisted on session.ai_analysis.ifm_timeline
 * after a successful assessment run; produced from client.timeline_events plus
 * any events the AI extracts from intake narrative / transcript.
 */
export interface IFMTimelineEvent {
  year?: number;
  date?: string;             // YYYY-MM-DD or YYYY-MM
  age_at_event?: number;
  event: string;
  category?: string;          // intake category, or "extracted_from_narrative"
  atm: "antecedent" | "trigger" | "mediator" | "resolution" | string;
  rationale?: string;
  linked_driver_slugs?: string[];   // mechanism slugs from likely_drivers
}

export interface AssessSuggestions {
  extracted_labs: ExtractedLab[];
  likely_drivers: LikelyDriver[];
  topics_in_play: TopicInPlay[];
  additional_symptoms_to_screen: AdditionalSymptomToScreen[];
  lifestyle_suggestions: LifestyleSuggestion[];
  nutrition_suggestions: NutritionSuggestions;
  supplement_suggestions: SupplementSuggestion[];
  suggested_protocols?: ProtocolSuggestion[];
  lab_followups: LabFollowup[];
  referral_triggers: ReferralTrigger[];
  education_framings: EducationFraming[];
  synthesis_notes: string;
  catalogue_additions_suggested: CatalogueAdditionSuggested[];
  ifm_timeline?: IFMTimelineEvent[];
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
  /** true when refused BEFORE any API spend — broad selection or oversized attachments. */
  preflight_blocked?: boolean;
  error?: string | null;
}

export interface PlanBrief {
  /** ID from PROTOCOL_TEMPLATES — e.g. "leaky-gut", "thyroid-hashimotos" */
  protocol_template_id?: string;
  /** Coach's working hypothesis for the root cause(s) */
  root_cause_hypothesis?: string;
  /** Override plan period (weeks). Default: 8 */
  plan_period_weeks?: number;
  /** Additional coaching context to weave into the draft */
  coaching_notes?: string;
}

export interface GenerateDraftInput {
  client_id: string;
  session_id: string;
  picks: Record<string, boolean>;
  /** Optional coach brief — applied on top of AI suggestions */
  plan_brief?: PlanBrief;
  /**
   * Bypasses the engagement-status guardrail (see generateDraftAction) —
   * set when the coach has already seen the "not signed up yet" warning
   * and explicitly chosen to build the full plan anyway.
   */
  force?: boolean;
}

export interface GenerateDraftResult {
  ok: boolean;
  slug?: string;
  path?: string;
  error?: string | null;
  /**
   * true when refused because the client's engagement_status isn't
   * "signed_up" and `force` wasn't set — no plan was generated. The UI
   * should show `error` alongside a "Generate anyway" action that retries
   * with `force: true`.
   */
  needs_confirmation?: boolean;
  /** The client's actual engagement_status at refusal time, for display. */
  engagement_status?: string;
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

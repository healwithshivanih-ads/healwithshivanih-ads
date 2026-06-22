/**
 * discovery-prefill.ts — pre-fill the Discovery form from client.yaml.
 *
 * The coach has already typed active_conditions + notes + goals when
 * creating the client. Re-typing the same thing on the Discovery form is
 * busywork. This helper:
 *
 *   1. Builds a draft chief-concern from active_conditions + notes + goals.
 *   2. Derives extra lab panels to pre-select based on condition keywords
 *      (Thyroid → Thyroid Function; Insulin Resistance → Blood Sugar; etc.)
 *
 * Deterministic — no AI call. Coach can override anything; this is just
 * the starting point so a Discovery session for an existing client is a
 * 1-click confirm rather than a 5-field re-type.
 */

export interface ClientPrefillInput {
  display_name?: string;
  active_conditions?: string[];
  notes?: string;
  goals?: string[];
  family_history?: string | null;
  /** Client age in years (from date_of_birth, else age_band midpoint).
   *  Used to gate the female sex-hormone panel — see the menopause block
   *  below. Null when unknown (we then DON'T suppress). */
  age?: number | null;
  /** Age at which menopause started, if known (parsed from
   *  menopause_started). Lets a recently-menopausal woman over 58 still
   *  get the hormone panel. Null when unknown. */
  menopauseAge?: number | null;
}

export interface DiscoveryPrefill {
  /** Draft chief concern derived from intake fields. Empty string when
   *  no usable data on client. Coach edits freely before saving. */
  chiefConcernDraft: string;
  /** Panel group names to add to the default selection. Pre-merged with
   *  DEFAULT_DISCOVERY_PANELS in the form so the union is the initial
   *  selected set. */
  extraPanels: string[];
  /** Plain-English summary of what we detected — surfaced in a banner
   *  above the form so the coach knows what was pulled in and from where. */
  detectionLabel: string;
}

// Condition keyword → panel groups. Lowercase substring match against
// each active_condition entry. Multiple keywords can map to the same panel
// (no harm — Set dedups in the form).
const CONDITION_PANEL_MAP: Array<[RegExp, string[]]> = [
  [/thyroid|hashimoto|hypothyroid|hyperthyroid|graves/i, ["Thyroid Function", "Autoimmune Screening"]],
  [/insulin|diabet|pre-?diabet|glucose|metabolic syndrome/i, ["Blood Sugar & Insulin", "Cardiovascular Risk"]],
  [/cholesterol|lipid|dyslipid|triglycer/i, ["Lipid Panel", "Cardiovascular Risk"]],
  [/hyperten|high blood pressure|\bbp\b/i, ["Cardiovascular Risk", "Metabolic Panel"]],
  [/osteopor|bone density|osteopenia/i, ["Nutrients"]],
  [/pcos|polycystic|androgen/i, ["Sex Hormones — Female", "Sex Hormones — Common", "Blood Sugar & Insulin"]],
  // NOTE: menopause is handled separately (see the age-gated block in
  // buildDiscoveryPrefill) — NOT in this generic map — so the sex-hormone
  // panel can be suppressed for women decades past menopause.
  [/depress|anxiety|mood|low mood|brain fog|cognitive|memory/i, ["Methylation & Genetics", "Adrenal & Stress", "Nutrients"]],
  [/fatigue|chronic fatigue|me\/cfs|exhaust|burnout/i, ["Adrenal & Stress", "Thyroid Function", "Nutrients"]],
  [/autoimmun|rheumat|lupus|sjogren|celiac|hashimoto/i, ["Autoimmune Screening", "Inflammation"]],
  [/inflammat|chronic pain|arthrit|fibromyalg/i, ["Inflammation", "Methylation & Genetics"]],
  [/gut|ibs|sibo|bloating|reflux|leaky/i, ["Gut Health", "Inflammation"]],
  [/cardio|heart|atrial|coronary/i, ["Cardiovascular Risk", "Lipid Panel"]],
  [/cancer|tumor|tumour|oncolog/i, ["Cancer Screening", "Inflammation"]],
];

export function buildDiscoveryPrefill(input: ClientPrefillInput): DiscoveryPrefill {
  const conditions = (input.active_conditions ?? []).filter(Boolean);
  const goals = (input.goals ?? []).filter(Boolean);
  const notes = (input.notes ?? "").trim();
  const family = (input.family_history ?? "").trim();

  // ── Chief concern draft ────────────────────────────────────────────
  const lines: string[] = [];
  if (conditions.length) {
    lines.push(`Active conditions: ${conditions.join(", ")}`);
  }
  if (notes) {
    lines.push(`Presenting issues: ${notes.replace(/\n+/g, "; ").trim()}`);
  }
  if (goals.length) {
    lines.push(`Goals: ${goals.join("; ")}`);
  }
  if (family) {
    lines.push(`Family history: ${family}`);
  }
  const chiefConcernDraft = lines.join("\n");

  // ── Extra panels from condition keywords ───────────────────────────
  const extraSet = new Set<string>();
  const matchedConditions: string[] = [];
  for (const c of conditions) {
    for (const [re, panels] of CONDITION_PANEL_MAP) {
      if (re.test(c)) {
        matchedConditions.push(c);
        for (const p of panels) extraSet.add(p);
      }
    }
  }
  // Also scan notes for mood / brain fog / etc. that often live there
  // rather than in active_conditions.
  if (notes) {
    for (const [re, panels] of CONDITION_PANEL_MAP) {
      if (re.test(notes)) {
        for (const p of panels) extraSet.add(p);
      }
    }
  }

  // ── Menopause: age-gated sex-hormone panel ─────────────────────────
  // Auto-ticking estradiol / progesterone / FSH / LH for a woman decades
  // past menopause is low-yield: the result is predictable (E2 low,
  // FSH/LH high) and non-actionable (de-novo HRT isn't started that far
  // out). So we only pre-select the sex-hormone panels when she's
  // plausibly peri/recently-menopausal: age ≤ 58, OR menopause within the
  // last ~5 years, OR age unknown (don't suppress on missing data).
  // Adrenal & Stress stays regardless — sleep/HPA is relevant at any age.
  const MENO_RE = /perimenopaus|menopaus|hot flush|hot flash/i;
  const PERI_AGE_MAX = 58;
  const RECENT_MENO_YEARS = 5;
  const age = input.age ?? null;
  const menopauseAge = input.menopauseAge ?? null;
  const menoMatched =
    conditions.some((c) => MENO_RE.test(c)) || (!!notes && MENO_RE.test(notes));
  let sexHormonesSkipped = false;
  if (menoMatched) {
    extraSet.add("Adrenal & Stress");
    const hormonesPlausible =
      age == null ||
      age <= PERI_AGE_MAX ||
      (menopauseAge != null && age - menopauseAge <= RECENT_MENO_YEARS);
    if (hormonesPlausible) {
      extraSet.add("Sex Hormones — Female");
      extraSet.add("Sex Hormones — Common");
    } else {
      sexHormonesSkipped = true;
    }
  }
  const extraPanels = [...extraSet];

  // ── Detection label for the banner ─────────────────────────────────
  const detectionParts: string[] = [];
  if (conditions.length) {
    detectionParts.push(
      `${conditions.length} condition${conditions.length === 1 ? "" : "s"}`,
    );
  }
  if (extraPanels.length) {
    detectionParts.push(
      `${extraPanels.length} extra panel${extraPanels.length === 1 ? "" : "s"} suggested`,
    );
  }
  if (sexHormonesSkipped) {
    detectionParts.push("sex-hormone panel auto-skipped (well past menopause)");
  }
  const detectionLabel = detectionParts.join(" · ");

  return { chiefConcernDraft, extraPanels, detectionLabel };
}

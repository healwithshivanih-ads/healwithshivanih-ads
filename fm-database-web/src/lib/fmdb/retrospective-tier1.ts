/**
 * Retrospective Tier 1 suspicion inference (v0.75.7) — deterministic, no
 * API call. For clients who submitted before the v0.75.2 Tier 1
 * screening fields (Beighton / NASA lean / PEM / mould / extended
 * histamine) existed, we still want to flag suspected triad patterns
 * the coach can act on. This module's rules look at the older free-text
 * + chip fields (BODY SYSTEMS / MEDICAL HISTORY / COVID / FAMILY HISTORY
 * / TIMELINE / toxic_exposures) and surface "suspected" flags.
 *
 * Single source of truth for the inference logic. Used by:
 *   - <TierOneSuspicionsPanel> on the client Overview (renders the flags)
 *   - SOAP / pre-session brief (could surface these as nudges)
 *   - generate-intake-insights.py prompt (parallels the rules baked in)
 *
 * Each suspicion fires ONLY when the corresponding structured Tier 1
 * field is EMPTY — once the client has filled the form on a refresh,
 * the structured data takes over and the suspicion auto-clears.
 *
 * Confidence levels:
 *   - high   = strong free-text or structural evidence; coach should
 *              re-issue intake to confirm
 *   - moderate = one signal present; worth flagging but not urgent
 *   - low    = noise floor; suppressed (not returned)
 */

export type TierOneSignal = "pem" | "mcas" | "pots" | "hypermobility" | "mould";

export interface SuspectedSignal {
  signal: TierOneSignal;
  confidence: "moderate" | "high";
  reason: string;
}

export interface SuspectedSignalsResult {
  /** True if the client already has Tier 1 fields populated — in that case nothing fires here. */
  has_structured_tier_one: boolean;
  /** Array of fired suspicions. Empty when client is post-v0.75.2 OR no inferable signals. */
  suspicions: SuspectedSignal[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Case-insensitive substring scan across a list of free-text fields. */
function anyMentions(needles: string[], haystacks: string[]): boolean {
  const blob = haystacks.filter(Boolean).join("\n").toLowerCase();
  return needles.some((n) => blob.includes(n.toLowerCase()));
}

/**
 * Does the client have ANY Tier 1 structured field populated?
 * If yes, retrospective inference is OFF (the form already captured the truth).
 */
function hasStructuredTierOne(c: Record<string, unknown>): boolean {
  const tier1Fields = [
    "beighton_self_score",
    "beighton_supplemental",
    "hr_devices_owned",
    "lean_test_supine_hr",
    "lean_test_standing_hr",
    "lean_test_symptoms",
    "pem_screen",
    "mould_exposure",
    "large_fish_frequency",
  ];
  for (const f of tier1Fields) {
    const v = c[f];
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-signal inference rules
// ─────────────────────────────────────────────────────────────────────────

/**
 * PEM (post-exertional malaise / ME/CFS / long COVID).
 *
 * Fires when:
 *   - COVID long-haul: covid_history includes long-COVID OR covid_long_symptoms non-empty
 *     AND any of {fatigue, brain fog, sleep changes} present
 *   - OR free-text mentions "crash for days", "wiped out after exertion",
 *     "wired but tired", "post-exertional"
 *   - OR concerns mention "always tired" + onset linked to infection
 *
 * PEM is the most actionable retrospective signal — graded exercise is
 * harmful for these clients, so flagging on suspicion alone is correct.
 */
function pemSuspected(c: Record<string, unknown>): SuspectedSignal | null {
  // Already captured? Skip.
  if (asStrArr(c.pem_screen).length > 0) return null;

  const covidHistory = asStrArr(c.covid_history);
  const covidLongSymptoms = asStrArr(c.covid_long_symptoms);
  const hasLongCovid =
    covidHistory.some((x) => x.toLowerCase().includes("long-covid")) ||
    covidLongSymptoms.length > 0;

  const longSymptomBlob = covidLongSymptoms.join(" ").toLowerCase();
  const energyClues =
    longSymptomBlob.includes("fatigue") ||
    longSymptomBlob.includes("brain fog") ||
    longSymptomBlob.includes("sleep");

  const freeTextHaystacks = [
    asStr(c.notes),
    asStr(c.energy_pattern),
    asStr(c.chief_complaint),
    asStr(c.covid_vaccine_reaction_detail),
    asStrArr(c.goals).join(" "),
  ];
  const explicitPemLanguage = anyMentions(
    [
      "crash for days",
      "crashes for days",
      "wiped out after",
      "wiped out for",
      "post-exertional",
      "post exertional",
      "ration my energy",
      "exercise makes me worse",
      "exercise sets me back",
      "can't recover from",
      "knocked out the next day",
    ],
    freeTextHaystacks,
  );

  const energyCrashChip = asStrArr(c.energy_crashes).some((x) =>
    x.toLowerCase().includes("post-meal") || x.toLowerCase().includes("after exercise"),
  );

  if (hasLongCovid && energyClues) {
    return {
      signal: "pem",
      confidence: "high",
      reason: "COVID long-haul symptoms include fatigue / brain fog / sleep disruption — classic PEM pattern. Graded exercise advice is contraindicated until verified.",
    };
  }
  if (explicitPemLanguage) {
    return {
      signal: "pem",
      confidence: "high",
      reason: "Free-text describes post-exertional crashes / energy-rationing language.",
    };
  }
  if (hasLongCovid) {
    return {
      signal: "pem",
      confidence: "moderate",
      reason: "Long-COVID history present. PEM is the cardinal ME/CFS feature — worth screening explicitly.",
    };
  }
  if (energyCrashChip) {
    return {
      signal: "pem",
      confidence: "moderate",
      reason: "Energy-crash pattern reported. Distinguish from PEM (24-48h crash) vs blood-sugar (within 1-2h).",
    };
  }
  return null;
}

/**
 * MCAS / histamine intolerance.
 *
 * Fires when:
 *   - histamine_signals already has ≥ 3 chips (form had the field, client ticked)
 *   - chemical_sensitivity ≥ 2 chips + unexplained multi-system signals
 *   - free-text "multiple medication intolerances" or "reacts to everything"
 */
function mcasSuspected(c: Record<string, unknown>): SuspectedSignal | null {
  const histamineChips = asStrArr(c.histamine_signals);
  const chemSensChips = asStrArr(c.chemical_sensitivity);

  // High confidence: 3+ histamine chips OR "diagnosed MCAS" chip
  if (
    histamineChips.length >= 3 ||
    histamineChips.some((x) => x.toLowerCase().includes("mcas") || x.toLowerCase().includes("diagnosed histamine"))
  ) {
    return {
      signal: "mcas",
      confidence: "high",
      reason: `${histamineChips.length} histamine signals already ticked. Verify with low-histamine trial + DAO + tryptase if symptomatic.`,
    };
  }

  // Moderate: chem sensitivity + free-text indicators
  const freeText = [asStr(c.notes), asStr(c.chief_complaint), asStrArr(c.goals).join(" ")];
  const multiMedReactor = anyMentions(
    ["react to every", "reacts to every", "sensitive to multiple medication", "multiple drug intolerance"],
    freeText,
  );
  if (chemSensChips.length >= 2 || multiMedReactor) {
    return {
      signal: "mcas",
      confidence: "moderate",
      reason: chemSensChips.length >= 2
        ? `${chemSensChips.length} chemical-sensitivity chips ticked. Could overlap with MCAS.`
        : "Free-text suggests multiple medication / supplement intolerances — MCAS pattern.",
    };
  }

  return null;
}

/**
 * POTS / orthostatic intolerance.
 *
 * Fires when:
 *   - free-text mentions standing dizzy / lightheaded / palpitations on standing
 *   - free-text mentions fainting / near-fainting / blacking out
 *   - "wake with racing heart" or "heart races when I stand"
 */
function potsSuspected(c: Record<string, unknown>): SuspectedSignal | null {
  // Already captured (any Tier 1 lean field has data)? Skip.
  if (asStrArr(c.lean_test_symptoms).length > 0) return null;
  if (asStr(c.lean_test_supine_hr) || asStr(c.lean_test_standing_hr)) return null;

  const freeText = [
    asStr(c.notes),
    asStr(c.chief_complaint),
    asStr(c.energy_pattern),
    asStrArr(c.goals).join(" "),
    asStr(c.menstrual_notes),
  ];

  const standingDizzy = anyMentions(
    [
      "lightheaded when i stand",
      "dizzy when standing",
      "feel faint standing",
      "fainting when",
      "blackout when",
      "head spins when i stand",
      "heart races when i stand",
      "heart pounds standing",
    ],
    freeText,
  );

  const fainted = anyMentions(["fainted", "passed out", "near-fainting", "blacked out"], freeText);

  if (standingDizzy) {
    return {
      signal: "pots",
      confidence: "high",
      reason: "Free-text describes orthostatic symptoms (lightheadedness, racing heart on standing). Worth running the 10-min lean test on Zoom.",
    };
  }
  if (fainted) {
    return {
      signal: "pots",
      confidence: "moderate",
      reason: "History of fainting / near-fainting mentioned. Could be POTS, vasovagal, or cardiac — verify the pattern.",
    };
  }
  return null;
}

/**
 * Joint hypermobility / Ehlers-Danlos suspicion.
 *
 * Fires when:
 *   - family_specific_conditions includes 'joint hypermobility / Ehlers-Danlos'
 *   - free-text mentions "double-jointed", "always bendy", "stretchy skin",
 *     "dislocations", "subluxations"
 */
function hypermobilitySuspected(c: Record<string, unknown>): SuspectedSignal | null {
  // Already captured? Skip.
  if (asStrArr(c.beighton_self_score).length > 0) return null;

  const familyChips = asStrArr(c.family_specific_conditions);
  const familyEDS = familyChips.some((x) => {
    const lc = x.toLowerCase();
    return lc.includes("hypermobility") || lc.includes("ehlers-danlos") || lc.includes("ehlers danlos");
  });

  const freeText = [asStr(c.notes), asStr(c.chief_complaint), asStr(c.childhood_history), asStrArr(c.goals).join(" ")];
  const selfMention = anyMentions(
    [
      "double-jointed",
      "double jointed",
      "always been bendy",
      "very flexible",
      "stretchy skin",
      "fragile skin",
      "dislocations",
      "subluxations",
      "hyperflexible",
    ],
    freeText,
  );

  if (familyEDS && selfMention) {
    return {
      signal: "hypermobility",
      confidence: "high",
      reason: "Family EDS / hypermobility history + client describes own bendy / dislocation pattern. Verify Beighton bilateral on Zoom.",
    };
  }
  if (familyEDS) {
    return {
      signal: "hypermobility",
      confidence: "moderate",
      reason: "Family history of hypermobility / EDS. Worth screening on intake refresh.",
    };
  }
  if (selfMention) {
    return {
      signal: "hypermobility",
      confidence: "moderate",
      reason: "Client mentions being double-jointed / bendy / having dislocations. Verify with Beighton.",
    };
  }
  return null;
}

/**
 * Mould / CIRS suspicion.
 *
 * Fires when:
 *   - toxic_exposures free text mentions mould / damp / leak / musty / water-damage
 *   - "feel worse in humid weather" pattern
 *   - multi-room respiratory + cognitive cluster (rare to catch without dedicated chips)
 */
function mouldSuspected(c: Record<string, unknown>): SuspectedSignal | null {
  // Already captured? Skip.
  if (asStrArr(c.mould_exposure).length > 0) return null;

  const exposureText = asStr(c.toxic_exposures).toLowerCase();
  const notesText = asStr(c.notes).toLowerCase();
  const childhoodText = asStr(c.childhood_history).toLowerCase();

  const directMention = ["mould", "mold", "damp", "leak", "musty", "water damage", "water-damage", "flood"].some(
    (kw) => exposureText.includes(kw) || notesText.includes(kw) || childhoodText.includes(kw),
  );

  const humidityWorse = anyMentions(
    ["worse in humid", "worse on damp", "humid days", "rainy season makes"],
    [asStr(c.notes), asStr(c.energy_pattern), asStr(c.chief_complaint)],
  );

  if (directMention && humidityWorse) {
    return {
      signal: "mould",
      confidence: "high",
      reason: "Mould / water-damage exposure + symptoms worse on humid days. Strong CIRS pattern — gentle protocol; avoid aggressive detox.",
    };
  }
  if (directMention) {
    return {
      signal: "mould",
      confidence: "high",
      reason: "Mould / leak / water-damage mentioned in exposure history. Worth screening explicitly.",
    };
  }
  if (humidityWorse) {
    return {
      signal: "mould",
      confidence: "moderate",
      reason: "Symptoms worse on humid / damp days. Could indicate mould or histamine sensitivity.",
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute retrospective Tier 1 suspicions for a client.yaml dict.
 *
 * Returns `{ has_structured_tier_one, suspicions[] }`. When the client
 * already has Tier 1 fields populated, suspicions is empty (the form
 * captured the real data; there's nothing to retrospectively infer).
 */
export function computeSuspectedSignals(
  client: Record<string, unknown>,
): SuspectedSignalsResult {
  const hasStructured = hasStructuredTierOne(client);

  // If structured data is present, we're not in "retrospective mode" —
  // the form has the real answers, no need to infer.
  if (hasStructured) {
    return { has_structured_tier_one: true, suspicions: [] };
  }

  const checks = [
    pemSuspected,
    mcasSuspected,
    potsSuspected,
    hypermobilitySuspected,
    mouldSuspected,
  ];
  const suspicions: SuspectedSignal[] = [];
  for (const check of checks) {
    try {
      const result = check(client);
      if (result) suspicions.push(result);
    } catch {
      // Inference is best-effort — never crash the page.
    }
  }
  return { has_structured_tier_one: false, suspicions };
}

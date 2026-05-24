/**
 * tier1-advisory.ts — coach-side detector for "this client might benefit
 * from a Tier 1 (Beighton + NASA lean + PEM + mould) re-issue".
 *
 * Coach feedback 2026-05-24: Section 11 was removed from the default
 * intake render so we don't interrogate every client about hypermobility
 * + dysautonomia. Detection now lives HERE — we scan whatever the client
 * DID submit for signals that suggest the screen is worth running, and
 * surface a one-click "📨 Reissue Tier 1" button on the Overview.
 *
 * Pure function over the raw client.yaml dict. Returns an object
 * shaped for direct rendering by `tier1-advisory-card.tsx`. Safe to
 * call on any client; returns null when nothing trips.
 */

export interface Tier1Signal {
  /** Short label for the chip in the advisory card. */
  label: string;
  /** Verbatim snippet from the client's submission that triggered it. */
  evidence: string;
  /** Which intake field surfaced it (for the audit trail). */
  source_field: string;
}

export interface Tier1Advisory {
  /** Number of distinct signals that fired. 1 is a soft flag; 2+ is a
   *  strong "issue the screen" signal. */
  signal_count: number;
  signals: Tier1Signal[];
  /** Coach-facing summary line. */
  headline: string;
}

const HYPERMOBILITY_PATTERNS = [
  /\bdouble-?jointed\b/i,
  /\bvery flexible\b/i,
  /\balways been (very )?(bendy|flexible)\b/i,
  /\bbendy\b/i,
  /\bdislocates?\b/i,
  /\bsubluxes?\b/i,
  /\behlers[ -]?danlos\b/i,
  /\beds\b(?:[^a-z]|$)/i,
  /\bhypermobil/i,
  /\bjoint laxity\b/i,
  /\bstretchy skin\b/i,
];

const POTS_STANDING_PATTERNS = [
  /\blighthead(ed)?\s+(when|on)?\s*standing\b/i,
  /\bdizzy\s+(when|on)?\s*standing\b/i,
  /\bdizzy\s+(when|on|standing\s+up)/i,
  /\bpalpitations?\s+(when|on)?\s*standing\b/i,
  /\bracing\s+heart\b/i,
  /\bpresyncope\b/i,
  /\bfaint(?:ing)?\s+(when|on)?\s*standing\b/i,
  /\bblood\s+pool/i,
  /\borthostatic\b/i,
  /\bpots\b(?:[^a-z]|$)/i,
];

const PEM_PATTERNS = [
  /\bpost[- ]?exertional\b/i,
  /\bpem\b(?:[^a-z]|$)/i,
  /\bcrash(?:es)?\s+(after|the day after)/i,
  /\bME\/CFS\b/i,
  /\bchronic fatigue syndrome\b/i,
  /\bcrash for (a|two|three)\s+days?\b/i,
  /\bcan't recover from\b/i,
  /\bworse the day after\b/i,
];

const MOULD_PATTERNS = [
  /\bmould\b/i,
  /\bmold\b/i,
  /\bmusty\b/i,
  /\bdamp(?:ness)?\b/i,
  /\bwater damage\b/i,
  /\bbasement\s+(flooded|leaks?)\b/i,
  /\bleaky\s+(roof|ceiling|pipe)\b/i,
  /\bcirs\b(?:[^a-z]|$)/i,
];

const CHEM_SENS_PATTERNS = [
  /\breact(?:ing)?\s+(strongly|badly)?\s*to\s+(multiple|many|every)/i,
  /\bsensitive to (perfumes?|fragrances?|cleaning products|chemicals)/i,
  /\bMCS\b(?:[^a-z]|$)/i,
  /\bmast cell\b/i,
  /\bMCAS\b(?:[^a-z]|$)/i,
];

/** A field is "scannable text" if it's a string OR a list of strings. */
function _coerceText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" · ");
  return "";
}

function _firstMatch(
  patterns: RegExp[],
  text: string,
): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      // Return a short evidence snippet (the match + ~40 chars context)
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + m[0].length + 30);
      return text.slice(start, end).trim().replace(/\s+/g, " ");
    }
  }
  return null;
}

export function detectTier1Advisory(
  client: Record<string, unknown> | null | undefined,
): Tier1Advisory | null {
  if (!client) return null;

  // Skip clients who've already had the Tier 1 reissued. The reissue
  // path sets intake_token + the topup template send creates a session
  // tagged [template: fm_intake_topup_v1]. We don't have that audit log
  // in this scope, so the simpler signal: if intake_form_draft has any
  // Tier 1 fields populated (beighton_*, nasa_lean_*, pem_*), they
  // already filled it.
  const draft = (client.intake_form_draft as Record<string, unknown> | null) ?? null;
  if (draft) {
    const tier1FieldNames = [
      "beighton_signs",
      "beighton_supplemental",
      "nasa_lean_signs",
      "pem_signs",
      "mould_exposure_signs",
      "chemical_sensitivity_signs",
      "joint_hypermobility_score",
    ];
    const alreadyHasTier1Data = tier1FieldNames.some((f) => {
      const v = draft[f];
      return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
    });
    if (alreadyHasTier1Data) return null;
  }
  // Same check on the top-level client (post-submit).
  const tier1FieldsOnClient: Array<keyof typeof client> = [
    "beighton_signs",
    "beighton_supplemental",
    "nasa_lean_signs",
    "pem_signs",
    "mould_exposure_signs",
    "joint_hypermobility_score",
  ] as never;
  for (const f of tier1FieldsOnClient) {
    const v = (client as Record<string, unknown>)[f as string];
    if (Array.isArray(v) ? v.length > 0 : v != null && v !== "") {
      return null;
    }
  }

  // Build a single "haystack" string from intake fields most likely to
  // contain Tier 1 signals as free text. Keep field-name attribution
  // alongside so we can surface "where this came from" to coach.
  const fieldsToScan: Array<{ name: string; label: string; value: string }> = [
    {
      name: "chief_concerns",
      label: "Chief concerns",
      value: _coerceText(client.chief_concerns),
    },
    {
      name: "what_is_happening",
      label: "What is happening",
      value: _coerceText(client.what_is_happening),
    },
    {
      name: "active_conditions",
      label: "Active conditions",
      value: _coerceText(client.active_conditions),
    },
    {
      name: "medical_history",
      label: "Medical history",
      value: _coerceText(client.medical_history),
    },
    {
      name: "family_history",
      label: "Family history",
      value: _coerceText(client.family_history),
    },
    {
      name: "family_specific_conditions",
      label: "Family conditions",
      value: _coerceText(client.family_specific_conditions),
    },
    {
      name: "notes",
      label: "Coach notes / freeform",
      value: _coerceText(client.notes),
    },
    {
      name: "toxic_exposures",
      label: "Environment & exposures",
      value: _coerceText(client.toxic_exposures),
    },
    {
      name: "covid_long_symptoms",
      label: "Post-COVID symptoms",
      value: _coerceText(client.covid_long_symptoms),
    },
    {
      name: "reported_triggers",
      label: "Reported triggers",
      value: _coerceText(client.reported_triggers),
    },
  ];

  const signals: Tier1Signal[] = [];

  function _check(
    label: string,
    patterns: RegExp[],
  ): void {
    for (const f of fieldsToScan) {
      if (!f.value) continue;
      const ev = _firstMatch(patterns, f.value);
      if (ev) {
        signals.push({ label, evidence: ev, source_field: f.label });
        return; // first match per signal type is enough
      }
    }
  }

  _check("Hypermobility mention", HYPERMOBILITY_PATTERNS);
  _check("Standing-tolerance symptoms", POTS_STANDING_PATTERNS);
  _check("Post-exertional crash pattern", PEM_PATTERNS);
  _check("Mould / damp exposure", MOULD_PATTERNS);
  _check("Multiple chemical / supplement reactions", CHEM_SENS_PATTERNS);

  // Long-COVID + fatigue is a softer combined signal — only fire when
  // covid_long_symptoms is truthy AND fatigue is on the active list.
  const covidPositive = _coerceText(client.covid_long_symptoms).trim();
  const fatiguePositive = /\bfatigue\b/i.test(
    _coerceText(client.active_conditions) +
      " " +
      _coerceText(client.chief_concerns),
  );
  if (
    covidPositive &&
    covidPositive.toLowerCase() !== "none" &&
    fatiguePositive
  ) {
    signals.push({
      label: "Post-viral fatigue pattern",
      evidence: covidPositive.slice(0, 80),
      source_field: "COVID + fatigue cluster",
    });
  }

  if (signals.length === 0) return null;

  const headline =
    signals.length === 1
      ? "1 signal suggests the Tier 1 screen might be worth running"
      : `${signals.length} signals suggest the Tier 1 screen would be useful`;

  return {
    signal_count: signals.length,
    signals,
    headline,
  };
}

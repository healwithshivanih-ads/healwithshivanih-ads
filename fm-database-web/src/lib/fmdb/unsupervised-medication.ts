/**
 * unsupervised-medication.ts — coach-side detector for a dependence-forming
 * psychoactive medication being taken WITHOUT clinical supervision.
 *
 * Why this exists (Shweta, cl-906, 2026-09-21). Her intake carried
 * `psych_medications: [{ name: "Alprazolam 0.25 …", still_taking: true,
 * side_effects: "Alert mind, insomnia & headache if I stop" }]` and, three
 * fields away, `current_mental_health_care: "No"`. Twenty years of
 * unprescribed benzodiazepine use, and both halves of the evidence were sitting
 * in the submitted form. Nobody joined them up: the assistant read past it
 * twice, and it only surfaced because the coach mentioned it in conversation.
 *
 * A psychoactive drug plus no mental health care IS unsupervised use, and it is
 * the single most consequential thing to know before authoring a protocol:
 *  - abrupt withdrawal after long-term benzodiazepine use carries a SEIZURE
 *    risk, so nothing in the programme may nudge the client to stop;
 *  - it rules out every sedating botanical (additive CNS depression);
 *  - an over-the-counter supply can be interrupted without warning, which for
 *    a dependent client is a medical emergency waiting to happen;
 *  - the referral is for a SUPERVISED TAPER, not for a prescription. A
 *    self-started dependence has no indication to treat; the doctor is needed
 *    because a taper requires controlled dosing, which an over-the-counter
 *    supply cannot give.
 *
 * AND IT MUST NOT IMPORT A DIAGNOSIS. `_derive_conditions_from_intake` maps a
 * benzodiazepine to a condition_implication of anxiety/depression and reads the
 * drug's presence as "on treatment". For a client who started a sleeping pill
 * on their own and grew dependent, BOTH halves are false — Shweta carried
 * "Anxiety/Depression (on treatment)" in `active_conditions`, a field that is
 * prefilled into her own public intake form and seeds her plan. A
 * condition_implication should be downgraded when `current_mental_health_care`
 * is explicitly "No"; not yet built, flagged here so it is not forgotten.
 *
 * Deliberately HIGH PRECISION. It fires only on named drug classes with real
 * dependence potential, and only when supervision is explicitly absent. A
 * noisy flag gets ignored, and this is one the coach must never learn to skip.
 *
 * Pure function over the raw client.yaml dict, mirroring `tier1-advisory.ts`.
 */

export type UnsupervisedSeverity = "critical" | "warning";

export interface UnsupervisedMedicationFinding {
  /** Canonical class label, e.g. "Benzodiazepine". */
  drugClass: string;
  /** What the client actually wrote, verbatim. */
  reported: string;
  /** Which intake field carried it — the audit trail. */
  sourceField: string;
  /** Present when the client's own words describe withdrawal on stopping. */
  withdrawalEvidence: string | null;
}

export interface UnsupervisedMedicationAdvisory {
  severity: UnsupervisedSeverity;
  findings: UnsupervisedMedicationFinding[];
  /** Coach-facing one-liner for the card header. */
  headline: string;
  /** The actions that follow, in the order they matter. */
  actions: string[];
}

/**
 * Generic + Indian brand names. India matters here: alprazolam and zolpidem are
 * Schedule H (prescription-only) but counter enforcement is inconsistent, so
 * self-supply is common and brand names are what clients actually write.
 * Word-boundary matched — see `mentions()` for why a bare substring is unsafe.
 */
const DEPENDENCE_CLASSES: Array<{ label: string; terms: string[] }> = [
  {
    label: "Benzodiazepine",
    terms: [
      "alprazolam", "alprax", "restil", "trika", "alzolam", "anxit",
      "clonazepam", "clonotril", "lonazep", "rivotril",
      "lorazepam", "ativan", "larpose",
      "diazepam", "valium", "calmpose",
      "chlordiazepoxide", "librium",
      "etizolam", "etilaam", "etizola", "depressa",
      "nitrazepam", "nitravet",
      "clobazam", "frisium",
    ],
  },
  {
    label: "Z-drug sedative-hypnotic",
    terms: [
      "zolpidem", "zolfresh", "nitrest", "stilnoct", "ambien",
      "zopiclone", "zopisign", "zolium",
      "eszopiclone", "lunesta",
    ],
  },
  {
    label: "Opioid",
    terms: [
      "tramadol", "ultracet", "tramazac",
      "codeine", "codein",
      "oxycodone", "morphine", "buprenorphine", "tapentadol",
    ],
  },
];

/** Client wording that describes withdrawal — dependence evidence in their own voice. */
const WITHDRAWAL_PATTERNS: RegExp[] = [
  /\bif i (?:stop|don'?t take|miss|skip)\b/i,
  /\bwhen i (?:stop|don'?t take|miss|skip)\b/i,
  /\bwithdraw(?:al|ing)?\b/i,
  /\bcan'?t sleep without\b/i,
  /\bcannot sleep without\b/i,
  /\bdependent?\b/i,
  /\baddict(?:ed|ion)\b/i,
  /\brebound\b/i,
];

/**
 * Whole-word match. A bare substring test is unsafe on drug names for the same
 * reason it was unsafe in `drug-match.ts`: short terms hide inside unrelated
 * words. Digits and punctuation must still terminate a match, so that
 * "Alprax-0.25" and "Restil 0.25" both resolve — hence letter boundaries
 * rather than \b.
 */
function mentions(haystack: string, term: string): boolean {
  const re = new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i");
  return re.test(haystack);
}

function classify(text: string): string | null {
  for (const c of DEPENDENCE_CLASSES) {
    if (c.terms.some((t) => mentions(text, t))) return c.label;
  }
  return null;
}

/**
 * Pull the matched phrase with a little surrounding context. Snaps outward to
 * whitespace so the quote never starts or ends mid-word — this is rendered to
 * the coach inside quotation marks, and "ert mind, insomnia & headache if I
 * stop" reads as a rendering bug rather than as the client's voice.
 */
function withdrawalIn(text: string): string | null {
  for (const re of WITHDRAWAL_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const i = m.index ?? 0;
    let start = Math.max(0, i - 30);
    let end = Math.min(text.length, i + m[0].length + 40);
    // widen to the nearest word edge rather than truncating a word
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;
    const snippet = text.slice(start, end).trim().replace(/\s+/g, " ");
    return snippet || null;
  }
  return null;
}

/**
 * True when the record positively says there is NO mental health care.
 *
 * `cleared` vs `unknown` matters here, the same distinction `contra_screen.py`
 * draws: a blank field means the question was never answered, which is not
 * evidence of absent supervision. Only an explicit "No" counts, so an
 * unanswered intake can never manufacture this flag.
 */
function supervisionExplicitlyAbsent(client: Record<string, unknown>): boolean {
  const raw = client.current_mental_health_care;
  if (typeof raw !== "string") return false;
  return /^\s*(no|none|not currently|nil)\s*\.?\s*$/i.test(raw);
}

export function detectUnsupervisedMedication(
  client: Record<string, unknown> | null | undefined,
): UnsupervisedMedicationAdvisory | null {
  if (!client) return null;
  if (!supervisionExplicitlyAbsent(client)) return null;

  const findings: UnsupervisedMedicationFinding[] = [];
  const seen = new Set<string>();

  const push = (text: string, sourceField: string, sideEffects?: string) => {
    const t = (text || "").trim();
    if (!t) return;
    const drugClass = classify(t);
    if (!drugClass) return;
    const key = `${drugClass}::${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      drugClass,
      reported: t,
      sourceField,
      withdrawalEvidence: withdrawalIn(`${t} ${sideEffects ?? ""}`),
    });
  };

  // Structured repeater first — it carries side-effect text, where clients
  // describe withdrawal in their own words.
  const psych = client.psych_medications;
  if (Array.isArray(psych)) {
    for (const e of psych) {
      if (!e || typeof e !== "object") continue;
      const row = e as Record<string, unknown>;
      if (row.still_taking === false) continue; // past use isn't an active risk
      push(
        String(row.name ?? ""),
        "psych_medications",
        String(row.side_effects ?? ""),
      );
    }
  }

  // Free-text med list. Clients routinely list several drugs in one string,
  // so each entry is scanned whole rather than split.
  for (const field of ["current_medications", "sleep_medications"] as const) {
    const v = client[field];
    if (Array.isArray(v)) for (const m of v) push(String(m ?? ""), field);
    else if (typeof v === "string") push(v, field);
  }

  if (findings.length === 0) return null;

  const anyWithdrawal = findings.some((f) => f.withdrawalEvidence);
  const classes = [...new Set(findings.map((f) => f.drugClass))];
  const severity: UnsupervisedSeverity = anyWithdrawal ? "critical" : "warning";

  return {
    severity,
    findings,
    headline: anyWithdrawal
      ? `${classes.join(" + ")} taken without clinical supervision, with the client describing withdrawal on stopping`
      : `${classes.join(" + ")} taken without clinical supervision`,
    actions: [
      "Do NOT suggest reducing or stopping it. Abrupt withdrawal after long-term use of these drugs carries a seizure risk.",
      "Refer for a SUPERVISED TAPER, not for a prescription. The goal is getting them off safely, not legitimising or continuing the drug — and it needs a doctor because you cannot taper off an over-the-counter supply: a taper needs controlled, predictable dosing in planned decrements over months.",
      "Ask what they actually take per day. A tablet strength is not a daily dose, and unsupervised use drifts upward.",
      "If the supply is over-the-counter, tell them it can be interrupted without warning — for a dependent client that is a safety issue, not an inconvenience.",
      "Exclude every sedating botanical from the protocol (valerian, jatamansi, brahmi, kava, passionflower, high-dose ashwagandha) — additive CNS depression.",
      "Keep mind_body_depth at `resets_only` or off.",
    ],
  };
}

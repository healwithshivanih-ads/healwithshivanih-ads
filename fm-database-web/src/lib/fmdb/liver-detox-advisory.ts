/**
 * liver-detox-advisory.ts — coach-side detector for "this client shows a
 * liver / biotransformation (detox) burden pattern worth exploring".
 *
 * Built 2026-06-22 per coach request: read the submitted intake for signals
 * that the liver's three biotransformation routes may be under strain, and
 * surface which route looks most affected:
 *
 *   - LOAD          → how hard the liver is being worked (Phase I demand):
 *                     liver-metabolised meds, alcohol, smoking, mercury fish,
 *                     mould / solvent exposure, declared toxic exposures.
 *   - UPSTREAM (I/II) → reactive-intermediate sensitivity (Phase I faster than
 *                     Phase II conjugation): chemical/fragrance sensitivity,
 *                     caffeine dependence, histamine signals, personal triggers,
 *                     and the oestrogen-clearance (Phase II) symptom cluster.
 *   - ELIMINATION (III) → the exit route is backed up: infrequent / hard /
 *                     straining stools, white tongue coating (dysbiosis).
 *
 * This mirrors the tier1-advisory.ts pattern: a PURE function over the raw
 * client.yaml dict, returns an object shaped for direct rendering by
 * `liver-detox-advisory-card.tsx`. Safe to call on any client; returns null
 * when the pattern is too thin to flag.
 *
 * SCOPE: this surfaces a *pattern to explore*, never a diagnosis or a
 * confirmed "stage". Confirming a phase needs functional labs (DUTCH /
 * organic acids / liver enzymes) — clinician territory. The card carries
 * that caveat + VitaOne's "no aggressive detoxes" rule.
 */

export type DetoxGroup = "load" | "upstream" | "elimination";

export interface LiverDetoxSignal {
  /** Which biotransformation route the signal points at. */
  group: DetoxGroup;
  /** Short label for the chip in the advisory card. */
  label: string;
  /** The actual intake value(s) that tripped it. */
  evidence: string;
  /** Which intake field surfaced it (for the audit trail). */
  source_field: string;
}

export interface LiverDetoxAdvisory {
  /** Total distinct signals that fired. */
  signal_count: number;
  /** Per-route tally — drives the "where it leans" headline. */
  group_counts: Record<DetoxGroup, number>;
  /** The route the picture leans toward, or "mixed". */
  lean: DetoxGroup | "mixed";
  signals: LiverDetoxSignal[];
  /** Coach-facing summary line. */
  headline: string;
}

// ── field-coercion helpers (tolerant of string | string[] | int | null) ──────

function _asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

function _asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" · ");
  return "";
}

/** Negative-sentinel chips that must NOT count as a positive signal. */
const NEGATIVE_SENTINELS = [
  "none",
  "no acne",
  "no concerns",
  "none of these",
  "none of the above",
  "no loss",
  "no change",
  "nothing notable",
  "prefer not",
  "n/a",
];

function _isNegative(chip: string): boolean {
  const c = chip.trim().toLowerCase();
  return NEGATIVE_SENTINELS.some((s) => c === s || c.startsWith(s));
}

/** Positive chips only (drops "no acne", "none of these", etc.). */
function _positiveChips(v: unknown): string[] {
  return _asList(v).filter((c) => c && !_isNegative(c));
}

/** Does any chip in the list contain one of the substrings (case-insensitive)? */
function _chipsMatching(v: unknown, needles: string[]): string[] {
  return _positiveChips(v).filter((c) => {
    const lc = c.toLowerCase();
    return needles.some((n) => lc.includes(n));
  });
}

function _trim(s: string, max = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Liver-metabolised / CYP-substrate medication buckets → Phase I/II load.
const LIVER_LOADING_MED_FIELDS: Array<{ field: string; label: string }> = [
  { field: "hormonal_contraception_hrt", label: "hormonal contraception / HRT" },
  { field: "nsaids_daily", label: "regular NSAIDs" },
  { field: "acid_suppressants", label: "acid suppressants (PPI/H2)" },
  { field: "statins_bp_diabetes", label: "statin / BP / metformin" },
  { field: "psych_medications", label: "psych medications" },
  { field: "biologics_immunosuppressants", label: "biologics / immunosuppressants" },
];

export function detectLiverDetoxAdvisory(
  client: Record<string, unknown> | null | undefined,
): LiverDetoxAdvisory | null {
  if (!client) return null;

  // Merged view: prefer the submitted top-level field, fall back to the
  // in-progress intake_form_draft so the flag can fire before submit too.
  const draft =
    (client.intake_form_draft as Record<string, unknown> | null) ?? null;
  const f = (name: string): unknown => {
    const top = client[name];
    if (top !== undefined && top !== null && top !== "") return top;
    return draft ? draft[name] : undefined;
  };

  const signals: LiverDetoxSignal[] = [];
  const push = (
    group: DetoxGroup,
    label: string,
    evidence: string,
    source_field: string,
  ) => signals.push({ group, label, evidence: _trim(evidence), source_field });

  // ── LOAD — inputs the liver must process (↑ Phase I demand) ────────────────

  const loadingMeds: string[] = [];
  for (const { field, label } of LIVER_LOADING_MED_FIELDS) {
    const entries = f(field);
    if (Array.isArray(entries) && entries.length > 0) {
      // Surface a name if the entry captured one, else the bucket label.
      const named = entries
        .map((e) =>
          e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string"
            ? ((e as { name?: string }).name as string)
            : "",
        )
        .filter(Boolean);
      loadingMeds.push(named.length ? `${label} (${named.join(", ")})` : label);
    }
  }
  if (loadingMeds.length) {
    push(
      "load",
      "Liver-metabolised medications",
      loadingMeds.join("; "),
      "Section 7 medications",
    );
  }

  const alcohol = _asText(f("alcohol_intake"));
  if (/most days/i.test(alcohol) || /weekly/i.test(alcohol)) {
    push("load", "Regular alcohol", alcohol, "alcohol_intake");
  }

  const smoking = _asText(f("smoking_status"));
  if (/smoke|vape|chew|tobacco|gutka|paan/i.test(smoking)) {
    push("load", "Tobacco / smoking", smoking, "smoking_status");
  }

  const fish = _asText(f("large_fish_frequency"));
  if (/weekly|multiple/i.test(fish)) {
    push("load", "Frequent large/predatory fish (mercury)", fish, "large_fish_frequency");
  }

  const mould = _positiveChips(f("mould_exposure"));
  if (mould.length) {
    push("load", "Mould / solvent / damp exposure", mould.join(" · "), "mould_exposure");
  }

  const tox = _asText(f("toxic_exposures")).trim();
  if (tox && !_isNegative(tox)) {
    push("load", "Declared toxic exposures", tox, "toxic_exposures");
  }

  // ── UPSTREAM (Phase I / II) — reactive-intermediate sensitivity ────────────

  const chem = _positiveChips(f("chemical_sensitivity"));
  if (chem.length) {
    push(
      "upstream",
      "Chemical / xenobiotic sensitivity",
      chem.join(" · "),
      "chemical_sensitivity",
    );
  }

  const caffeine = _asText(f("caffeine_dependency"));
  if (/need_it|need it|headache/i.test(caffeine)) {
    push("upstream", "Caffeine dependence (CYP1A2 signal)", caffeine, "caffeine_dependency");
  }

  // Histamine field is broad; the single strongest detox-conjugation chip is
  // the multi-med/supplement reactivity one — weight that, but count any.
  const hist = _positiveChips(f("histamine_signals"));
  if (hist.length) {
    const strong = _chipsMatching(f("histamine_signals"), [
      "multiple medications",
      "medications + supplements",
      "within 30 min",
      "brain fog",
    ]);
    push(
      "upstream",
      strong.length ? "Conjugation-strain / histamine signals" : "Histamine-pattern signals",
      (strong.length ? strong : hist).join(" · "),
      "histamine_signals",
    );
  }

  const triggers = _asText(f("reported_triggers")).trim();
  if (triggers && !_isNegative(triggers)) {
    push("upstream", "Personal intolerance triggers", triggers, "reported_triggers");
  }

  // Declining tolerance over time — used to handle it, now reacts. A direct
  // Phase I/II capacity-decline signal (the form's other sensitivity fields
  // are present-tense only).
  const toleranceLost = _positiveChips(f("tolerance_changes"));
  if (toleranceLost.length) {
    push(
      "upstream",
      "Declining tolerance (used to handle, now reacts)",
      toleranceLost.join(" · "),
      "tolerance_changes",
    );
  }

  // Oestrogen-clearance (Phase II) symptom cluster — bundle so one woman's
  // period symptoms register as a single signal, not three.
  const estroBits: string[] = [];
  const acneEstro = _chipsMatching(f("acne_pattern"), ["cyclical", "cystic"]);
  if (acneEstro.length) estroBits.push(`acne: ${acneEstro.join(", ")}`);
  const headEstro = _chipsMatching(f("headache_type"), ["period-linked", "migraine"]);
  if (headEstro.length) estroBits.push(`headache: ${headEstro.join(", ")}`);
  const periodPain = f("period_pain_severity");
  if (typeof periodPain === "number" && periodPain >= 7) {
    estroBits.push(`period pain ${periodPain}/10`);
  }
  if (estroBits.length) {
    push(
      "upstream",
      "Oestrogen-clearance (Phase II) cluster",
      estroBits.join(" · "),
      "acne_pattern / headache_type / period_pain_severity",
    );
  }

  // ── ELIMINATION (Phase III) — the exit route ───────────────────────────────

  const elimBits: string[] = [];
  const bowelFreq = f("bowel_frequency_per_day");
  if (typeof bowelFreq === "number" && bowelFreq < 1) {
    elimBits.push(`${bowelFreq} bowel movement/day`);
  }
  const bristolRaw = f("bristol_stool_typical");
  const bristolNums = (Array.isArray(bristolRaw) ? bristolRaw : [])
    .map((x) => Number(x))
    .filter((n) => !Number.isNaN(n));
  if (bristolNums.some((n) => n === 1 || n === 2)) {
    elimBits.push("hard / lumpy stool (Bristol 1–2)");
  }
  const bowelStrain = _chipsMatching(f("bowel_pattern"), ["strain", "incomplete"]);
  if (bowelStrain.length) elimBits.push(bowelStrain.join(", "));
  if (elimBits.length) {
    push(
      "elimination",
      "Sluggish elimination (Phase III)",
      elimBits.join(" · "),
      "bowel_frequency_per_day / bristol_stool_typical / bowel_pattern",
    );
  }

  const whiteTongue = _chipsMatching(f("oral_signs"), ["white coating"]);
  if (whiteTongue.length) {
    push(
      "elimination",
      "White tongue coating (dysbiosis / estrobolome)",
      whiteTongue.join(" · "),
      "oral_signs",
    );
  }

  // ── verdict ────────────────────────────────────────────────────────────────

  // Gate: a single isolated signal isn't worth a flag (e.g. just weekly
  // alcohol). Require a cluster of >= 2.
  if (signals.length < 2) return null;

  const group_counts: Record<DetoxGroup, number> = {
    load: signals.filter((s) => s.group === "load").length,
    upstream: signals.filter((s) => s.group === "upstream").length,
    elimination: signals.filter((s) => s.group === "elimination").length,
  };

  const groupsPresent = (Object.keys(group_counts) as DetoxGroup[]).filter(
    (g) => group_counts[g] > 0,
  );
  let lean: LiverDetoxAdvisory["lean"];
  if (groupsPresent.length > 1) {
    const max = Math.max(...groupsPresent.map((g) => group_counts[g]));
    const top = groupsPresent.filter((g) => group_counts[g] === max);
    lean = top.length === 1 ? top[0] : "mixed";
  } else {
    lean = groupsPresent[0];
  }

  const leanClause: Record<LiverDetoxAdvisory["lean"], string> = {
    load: "the picture leans toward high toxic / metabolic load",
    upstream:
      "the picture leans toward reactive-intermediate sensitivity (Phase I outpacing Phase II)",
    elimination:
      "the picture leans toward a backed-up elimination route (Phase III) — start there",
    mixed:
      "load, reactive-intermediate sensitivity and elimination all show signals — the classic 'backed-up detox' cluster",
  };

  const headline = `${signals.length} signals suggest liver / biotransformation burden — ${leanClause[lean]}`;

  return { signal_count: signals.length, group_counts, lean, signals, headline };
}

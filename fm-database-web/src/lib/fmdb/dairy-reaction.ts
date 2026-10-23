/**
 * Dairy reactions — a milk-PROTEIN allergy is not LACTOSE intolerance.
 *
 * TS mirror of `fm-database/fmdb/plan/dairy.py` (the source of truth; the
 * type itself is derived there, at intake submit). Keep the signal regex, the
 * storage keys and the behaviour in lockstep — `dairy-reaction.test.ts` and
 * `tests/test_dairy_reaction.py` pin the same cases.
 *
 * Why (2026-10-23, cl-906): "Milk" in the allergies, and the coach wanted to
 * swap a protein powder for lactose-free high-protein milk or a BLG whey shot —
 * fine for lactose intolerance, unsafe for a milk-protein allergy, and the
 * intake never asked which. Clients routinely call lactose intolerance an
 * "allergy". The intake now asks a short follow-up whenever milk / dairy /
 * lactose is named: what happens, how soon, and are curd / paneer / ghee OK.
 *
 *   lactose_intolerance  — avoid lactose; lactose-free milk, curd, paneer, ghee,
 *                          whey isolate fine.
 *   milk_protein_allergy — no milk protein at all (lactose-free milk included);
 *                          ghee only if the client said so.
 *   unsure               — treated as the allergy until the coach confirms. A
 *                          dairy word on the record with no type reads as this
 *                          too (`source: "inferred"`).
 */

export const DAIRY_REACTION_TYPES = [
  "lactose_intolerance",
  "milk_protein_allergy",
  "unsure",
] as const;
export type DairyReactionType = (typeof DAIRY_REACTION_TYPES)[number];

/** Storage keys — never rename. Labels are the client's words. */
export const DAIRY_SYMPTOMS: ReadonlyArray<{ key: string; label: string; allergySign: boolean }> = [
  { key: "bloating_gas", label: "Bloating or gas", allergySign: false },
  { key: "loose_stools", label: "Loose stools", allergySign: false },
  { key: "stomach_cramps", label: "Stomach cramps", allergySign: false },
  { key: "nausea", label: "Nausea", allergySign: false },
  { key: "hives_rash", label: "Hives or a rash", allergySign: true },
  { key: "itching_mouth_throat", label: "Itchy mouth or throat", allergySign: true },
  { key: "swelling", label: "Swelling (lips, face, tongue)", allergySign: true },
  { key: "wheezing_breathless", label: "Wheezing or short of breath", allergySign: true },
  { key: "vomiting", label: "Vomiting", allergySign: true },
  { key: "eczema_flare", label: "Eczema flares", allergySign: true },
];

export const DAIRY_TIMING: ReadonlyArray<{ key: string; label: string }> = [
  { key: "within_minutes", label: "Within minutes" },
  { key: "within_2_hours", label: "Within 2 hours" },
  { key: "several_hours", label: "Hours later" },
  { key: "not_sure", label: "Not sure" },
];

export const DAIRY_TOLERANCE: ReadonlyArray<{ key: string; label: string }> = [
  { key: "yes", label: "Fine" },
  { key: "no", label: "Reacts" },
  { key: "unsure", label: "Don't eat it / not sure" },
];

/** Plant milks, milk thistle and peanut butter are not dairy. */
const PLANT =
  "(?<!coconut )(?<!almond )(?<!oat )(?<!soy )(?<!soya )(?<!rice )(?<!cashew )(?<!peanut )(?<!plant )(?<!nut )";
const DAIRY_SIGNAL = new RegExp(
  `\\b(?:dairy|lactose|casein|whey|paneer|cheese|curd|dahi|yogh?urt|buttermilk|${PLANT}milk(?!\\s*thistle))\\b`,
  "i",
);

function asText(v: unknown): string {
  if (Array.isArray(v)) return v.filter((x) => x != null).map(String).join(" ; ");
  return v == null ? "" : String(v);
}

/** True when any of the inputs (strings or string arrays) names milk / dairy. */
export function hasDairySignal(...texts: unknown[]): boolean {
  return texts.some((t) => DAIRY_SIGNAL.test(asText(t)));
}

export function isDairyTerm(term: unknown): boolean {
  return DAIRY_SIGNAL.test(asText(term));
}

export type DairyClient = {
  known_allergies?: unknown;
  allergies?: unknown;
  foods_to_avoid?: unknown;
  reported_triggers?: unknown;
  dairy_reaction_type?: unknown;
  tolerates_ghee?: unknown;
} | null | undefined;

export type ResolvedDairy = {
  kind: DairyReactionType;
  /** `recorded` = the intake or the coach set it; `inferred` = a dairy word
   *  on the record, type never asked. */
  source: "recorded" | "inferred";
  gheeOk: boolean;
};

function isType(v: unknown): v is DairyReactionType {
  return typeof v === "string" && (DAIRY_REACTION_TYPES as readonly string[]).includes(v);
}

/** How to treat dairy for this client, or null when it is not an issue. */
export function resolveDairy(client: DairyClient): ResolvedDairy | null {
  let kind: DairyReactionType;
  let source: ResolvedDairy["source"] = "recorded";
  const stored = client?.dairy_reaction_type;
  if (isType(stored)) {
    kind = stored;
  } else if (
    hasDairySignal(
      client?.known_allergies,
      client?.allergies,
      client?.foods_to_avoid,
      client?.reported_triggers,
    )
  ) {
    kind = "unsure";
    source = "inferred";
  } else {
    return null;
  }
  const ghee = client?.tolerates_ghee;
  const gheeOk =
    kind === "lactose_intolerance" ? true : kind === "milk_protein_allergy" ? ghee === "yes" : ghee !== "no";
  return { kind, source, gheeOk };
}

export function treatsAsAllergy(d: ResolvedDairy | null): boolean {
  return !!d && d.kind !== "lactose_intolerance";
}

/** One line for an AI prompt; "" when dairy is not an issue. Same wording as
 *  `dairy_prompt_line` in Python. */
export function dairyPromptLine(client: DairyClient): string {
  const d = resolveDairy(client);
  if (!d) return "";
  if (d.kind === "lactose_intolerance") {
    return (
      "Dairy: LACTOSE INTOLERANCE, not a milk allergy — avoid ordinary milk, " +
      "cream, khoa/malai and milk sweets. Lactose-free milk, curd, paneer, " +
      "buttermilk, ghee and whey ISOLATE are fine; do not remove dairy wholesale " +
      "or refuse whey isolate for this reason."
    );
  }
  const ghee = d.gheeOk ? "Ghee is OK (the client said so)." : "No ghee or butter either.";
  if (d.kind === "milk_protein_allergy") {
    return (
      "Dairy: TRUE MILK-PROTEIN ALLERGY — ABSOLUTE. No milk (lactose-free and " +
      "high-protein milks are still milk protein), curd, buttermilk, paneer, " +
      `cheese, whey or casein, in food or supplements. ${ghee}`
    );
  }
  const why =
    d.source === "inferred"
      ? "dairy appears in the allergies / avoid list but the type was never asked"
      : "the client's answers did not settle it";
  return (
    `Dairy: reaction of UNCONFIRMED type (${why}). Treat it as a milk-protein ` +
    "allergy until the coach confirms — no milk (including lactose-free / " +
    `high-protein milk), curd, paneer, cheese, whey or casein. ${ghee}`
  );
}

export const DAIRY_TYPE_LABEL: Record<DairyReactionType, string> = {
  lactose_intolerance: "Lactose intolerance — not a milk allergy",
  milk_protein_allergy: "Milk-protein allergy",
  unsure: "Dairy reaction — type unconfirmed",
};

/** What the coach can and can't use — one short line per type. */
export const DAIRY_TYPE_GUIDANCE: Record<DairyReactionType, string> = {
  lactose_intolerance:
    "Avoid ordinary milk and cream. Lactose-free milk, curd, paneer, ghee and whey isolate are fine.",
  milk_protein_allergy:
    "No milk protein at all — lactose-free / high-protein milk, curd, paneer, whey and BLG shots included.",
  unsure:
    "Treated as a milk-protein allergy everywhere until you confirm. Ask: are curd, paneer and ghee OK?",
};

const ALLERGY_SIGN_KEYS = new Set(DAIRY_SYMPTOMS.filter((s) => s.allergySign).map((s) => s.key));
const SYMPTOM_KEYS = new Set(DAIRY_SYMPTOMS.map((s) => s.key));
const TIMING_KEYS = new Set(DAIRY_TIMING.map((t) => t.key));
const TOLERANCE_KEYS = new Set(DAIRY_TOLERANCE.map((t) => t.key));

/**
 * The intake answers → a type; null when nothing was answered. Mirror of
 * `derive_dairy_reaction_type` (Python runs it at submit; this copy serves the
 * coach's "use the intake answers" button). Allergy signs win, then a ghee
 * reaction, then reacting to both curd and paneer; gut-only with curd or
 * paneer eaten fine is lactose intolerance; anything else answered is unsure.
 */
export function deriveDairyReactionType(a: {
  symptoms?: unknown;
  timing?: unknown;
  curd?: unknown;
  paneer?: unknown;
  ghee?: unknown;
}): DairyReactionType | null {
  const syms = (Array.isArray(a.symptoms) ? a.symptoms : []).map(String).filter((s) => SYMPTOM_KEYS.has(s));
  const tol = (v: unknown) => (typeof v === "string" && TOLERANCE_KEYS.has(v) ? v : null);
  const curd = tol(a.curd);
  const paneer = tol(a.paneer);
  const ghee = tol(a.ghee);
  const answered =
    syms.length > 0 || !!curd || !!paneer || !!ghee || (typeof a.timing === "string" && TIMING_KEYS.has(a.timing));
  if (!answered) return null;
  if (syms.some((s) => ALLERGY_SIGN_KEYS.has(s))) return "milk_protein_allergy";
  if (ghee === "no") return "milk_protein_allergy";
  if (curd === "no" && paneer === "no") return "milk_protein_allergy";
  if (curd === "yes" && paneer === "no") return "unsure";
  if (curd === "yes" || paneer === "yes") return "lactose_intolerance";
  return "unsure";
}

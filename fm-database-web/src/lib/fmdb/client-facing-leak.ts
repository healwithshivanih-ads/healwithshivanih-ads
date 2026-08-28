/**
 * Coach language must not reach the client.
 *
 * Some plan fields render VERBATIM on the client's phone. `notes_for_coach` and
 * `ai_sanity_check` are stripped at staging, and supplement/practice text is
 * scrubbed on the way out — but several fields have neither guard and are simply
 * printed. Two of them shipped to a real client on 2026-08-19:
 *
 *   - `lab_orders[].test` — he read "H. pylori — stool antigen or urea breath
 *     test, AFTER a 2-week break from HIS PPI (not the blood antibody test)".
 *   - `nutrition.meal_timing` — carried a sentence about what "the GI referral
 *     needs to see".
 *
 * Both were written in the third person, about him, for another clinician. The
 * fix in each case was to keep the clinical instruction in a field that does not
 * render (`lab_orders[].reason`) and leave the client a plain name.
 *
 * This module is the standing guard. It is deliberately about REGISTER, not
 * secrecy: a client is entitled to their own lab values (the Lab Vault shows
 * them by design). What they should never get is text that was written for
 * somebody else and forgot they would read it.
 */

/** Fields whose text is printed to the client with no scrub of its own. */
export const CLIENT_FACING_PLAN_FIELDS = [
  "client_update_note",
  "nutrition.pattern",
  "nutrition.meal_timing",
  "nutrition.add[]",
  "nutrition.reduce[]",
  "ayurveda.balancing_focus",
  "ayurveda.dietary_guidance",
  "lab_orders[].test",
  "supplement_protocol[].client_note",
  "lifestyle_practices[].client_note",
  "lifestyle_practices[].name",
] as const;

export interface LeakHit {
  field: string;
  rule: string;
  excerpt: string;
}

/** Third-person reference to the client — the clearest tell that a line was
 *  written ABOUT them rather than TO them. "his"/"her" as possessives are the
 *  ones that actually bite; bare "he"/"she" is caught too. */
const THIRD_PERSON =
  /\b(?:he|she|his|her|him|hers|the client|this client|the patient)\b/i;

/** Talking to another clinician, or to the coach's future self. */
const COACH_REGISTER =
  /\b(?:coach|physician|clinician|referral|plan-check|rationale|contraindicat\w*|prescrib\w*|titrat\w*|differential|work-?up|monitor(?:ing)? labs?|per protocol|caveat|flagged?|red flag)\b/i;

/** A lab marker quoted WITH ITS VALUE — "given her ferritin 18", "while HOMA-IR
 *  is healthy at 1.2". That is a chart reading pasted into client text.
 *
 *  Naming a marker as a CONCEPT is legitimate and must not fire: "supports
 *  healthy homocysteine levels" and "helps your thyroid cells respond to TSH"
 *  are exactly how you explain a supplement to someone. The first version of
 *  this rule flagged all 5 of those and would have taught everyone to ignore
 *  the guard. The number is the tell, not the marker. */
const MARKER = "hba1c|hs-?crp|ggt|ast\\/alt|apo-?b|lp\\(a\\)|homa-?ir|ferritin|homocysteine|microalbumin|creatinine|tsh|ft3|ft4|egfr|acr";
const MARKER_IN_PROSE = new RegExp(
  `\\b(?:${MARKER})\\b[^.;]{0,14}?\\d|\\d[^.;]{0,14}?\\b(?:${MARKER})\\b`,
  "i",
);

/** Prescription-strength drug talk. Named medicines belong in the medication
 *  list, not woven into client instructions. */
const DRUG_TALK =
  /\b(?:metformin|sulfonylurea|glimepiride|gliclazide|sitagliptin|telmisartan|amlodipine|rabeprazole|ppi\b|statin|insulin therapy|lactic acidosis|hypoglycaemi\w*|hypoglycemi\w*)\b/i;

/** Editorial scaffolding that should never survive into client text. */
const SCAFFOLDING = /(?:⚠|^COACH\b|\bTODO\b|\bNOTE TO SELF\b|\bDO NOT BOOK\b)/i;

const ALL_RULES: [string, RegExp][] = [
  ["third-person about the client", THIRD_PERSON],
  ["coach/clinician register", COACH_REGISTER],
  ["lab marker named in prose", MARKER_IN_PROSE],
  ["prescription drug talk", DRUG_TALK],
  ["editorial scaffolding", SCAFFOLDING],
];

/**
 * A lab ORDER's name is allowed to be a list of markers — "Ferritin, serum
 * iron, TIBC" IS the test, not a leak, and stripping markers there would just
 * leave the client a mystery appointment. What must not appear is text written
 * about them in the third person, or an aside aimed at whoever books it.
 *
 * Length matters too: a test name is a name. Once it runs past ~90 characters
 * it has stopped being one and started being an instruction.
 */
const LAB_TEST_RULES: [string, RegExp][] = [
  ["third-person about the client", THIRD_PERSON],
  ["prescription drug talk", DRUG_TALK],
  ["editorial scaffolding", SCAFFOLDING],
];

function rulesFor(field: string): [string, RegExp][] {
  return /^lab_orders\[\d+\]\.test$/.test(field) ? LAB_TEST_RULES : ALL_RULES;
}

function check(field: string, value: unknown, out: LeakHit[]): void {
  if (typeof value !== "string" || !value.trim()) return;
  if (/^lab_orders\[\d+\]\.test$/.test(field) && value.trim().length > 90) {
    out.push({
      field,
      rule: "lab order name is an instruction, not a name (>90 chars)",
      excerpt: `…${value.slice(0, 120).replace(/\s+/g, " ").trim()}…`,
    });
  }
  for (const [rule, re] of rulesFor(field)) {
    const m = re.exec(value);
    if (!m) continue;
    const at = Math.max(0, m.index - 60);
    out.push({
      field,
      rule,
      excerpt: `…${value.slice(at, m.index + 80).replace(/\s+/g, " ").trim()}…`,
    });
  }
}

/** Scan one plan object for coach language in fields the client actually reads. */
export function findClientFacingLeaks(plan: Record<string, unknown>): LeakHit[] {
  const out: LeakHit[] = [];
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  check("client_update_note", plan.client_update_note, out);

  const nutrition = (plan.nutrition ?? {}) as Record<string, unknown>;
  check("nutrition.pattern", nutrition.pattern, out);
  check("nutrition.meal_timing", nutrition.meal_timing, out);
  for (const [i, v] of (Array.isArray(nutrition.add) ? nutrition.add : []).entries())
    check(`nutrition.add[${i}]`, v, out);
  for (const [i, v] of (Array.isArray(nutrition.reduce) ? nutrition.reduce : []).entries())
    check(`nutrition.reduce[${i}]`, v, out);

  // The Ayurveda card's "how" line is firstSentence(balancing_focus) +
  // firstSentence(dietary_guidance) — see focusAyurveda in client-app.ts. Only
  // those first sentences render, but the whole string is checked: the coach
  // edits these by hand, and a leaky sentence is one reorder away from being
  // the first one. Caught 2026-08-28 on a live plan whose guidance opened
  // "Aimed at the kapha and the ama, not at HIS constitution."
  const ayurveda = (plan.ayurveda ?? {}) as Record<string, unknown>;
  check("ayurveda.balancing_focus", ayurveda.balancing_focus, out);
  check("ayurveda.dietary_guidance", ayurveda.dietary_guidance, out);

  for (const [i, l] of arr(plan.lab_orders).entries())
    check(`lab_orders[${i}].test`, l.test, out);
  for (const [i, s] of arr(plan.supplement_protocol).entries())
    check(`supplement_protocol[${i}].client_note`, s.client_note, out);
  for (const [i, p] of arr(plan.lifestyle_practices).entries()) {
    check(`lifestyle_practices[${i}].client_note`, p.client_note, out);
    // The practice NAME is a headline on the client's Today screen. Missed in
    // the first pass, and it was leaking: "Alcohol — eat first, count it, and
    // change it WITH HIS doctor" was on a real client's phone.
    check(`lifestyle_practices[${i}].name`, p.name, out);
  }

  return out;
}

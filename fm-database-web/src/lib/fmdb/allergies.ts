/**
 * Allergy resolution — the difference between "none" and "never asked".
 *
 * `Client.known_allergies` was read by ten consumers as though a populated
 * list meant allergies and an empty one meant none. Measured on the live
 * roster 2026-08-03: 1 record of 21 was non-empty, and its value was
 * `['None']`. So every consumer was reading "no allergies known" off a field
 * nobody had filled in — a negative asserted, never established. Two of those
 * consumers are safety checks (the assessment gate's HARD allergen block, the
 * recipe safety join), and both were silently passing everything.
 *
 * The fix is not a new field. It is noticing that the existing one already
 * carries three states, and that the code was collapsing them into two:
 *
 *   declared — real allergens. Absolute: never suggest, never serve.
 *   none     — the client was ASKED and said no. A real negative screen, and
 *              until now discarded: `meal-check` filtered the sentinel out,
 *              which threw away the only genuine "none" on the roster.
 *   unknown  — the field is empty because the question was never answered.
 *              NOT the same as none, and must never be rendered as one.
 *
 * Deriving this from `known_allergies` rather than adding a field is
 * deliberate: the field is already in `_APP_CLIENT_KEYS`, so nothing here
 * trips the staging allowlist trap and goes invisible on Fly.
 *
 * WHY THIS IS NOT MERGED INTO `foods_to_avoid`. That field is the de-facto
 * home of exclusions and it is prose written for a human — but it holds
 * "Onion, Garlic" (a Jain preference), "Brinjal, Rice, Wheat" (a protocol
 * phase) and "Brinjal (used to get itchy tongue as a kid)" (an oral allergy)
 * in the same string, in the same shape. Severity cannot be recovered from it
 * mechanically. An allergy is never; a coach's exclusion is for now — and the
 * consumers act on them differently, so they stay separate fields.
 */

/** Values a human writes to mean "I have none". Matched whole, after
 *  lowercasing and stripping punctuation — never as a substring, or
 *  "none of the nuts" would read as a negative screen. */
const NONE_SENTINELS = new Set([
  "none",
  "nil",
  "no",
  "na",
  "nka",
  "nkda",
  "no allergies",
  "none known",
  "no known allergies",
  "no known drug allergies",
  "not known",
  "nothing",
  "no allergy",
  "denies",
]);

/** The sentinel written when a client affirms they have none. Read back by
 *  `resolveAllergies` as `none`; anything in NONE_SENTINELS also works, so a
 *  hand-typed "nil" from the coach is understood too. */
export const NO_KNOWN_ALLERGIES = "No known allergies";

export type AllergyStatus = "declared" | "none" | "unknown";

export type ResolvedAllergies = {
  status: AllergyStatus;
  /** Real allergens only. Empty for `none` and `unknown` alike — always
   *  branch on `status`, never on `items.length`. */
  items: string[];
};

function isNoneSentinel(raw: string): boolean {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Both forms: punctuation becomes a space, so "N/A" normalises to "n a" and
  // only matches once the spaces are also collapsed. "no known allergies"
  // needs the spaced form. Checking both covers each without a second list.
  return NONE_SENTINELS.has(s) || NONE_SENTINELS.has(s.replace(/ /g, ""));
}

/**
 * Resolve a client record's allergy state.
 *
 * Reads `known_allergies` and falls back to `allergies`. Both names exist in
 * this codebase — `updateClientProfile` takes `allergies` as its input key and
 * writes whichever key the file already has — and while all 21 live records
 * currently use `known_allergies`, a record created down the other branch
 * would be missed by a single-name read.
 */
export function resolveAllergies(
  client:
    | { known_allergies?: unknown; allergies?: unknown }
    | null
    | undefined,
): ResolvedAllergies {
  const raw = [
    ...(Array.isArray(client?.known_allergies) ? client.known_allergies : []),
    ...(Array.isArray(client?.allergies) ? client.allergies : []),
  ];

  const entries = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (entries.length === 0) return { status: "unknown", items: [] };

  const items = entries.filter((e) => !isNoneSentinel(e));
  // Every entry was a sentinel → the client was asked and said no. If any real
  // allergen sits alongside a "none", the allergen wins: a list reading
  // ["none", "penicillin"] is a data-entry artefact, not a contradiction to
  // resolve in favour of safety-off.
  if (items.length === 0) return { status: "none", items: [] };
  return { status: "declared", items };
}

/**
 * One line of allergy context for an AI prompt.
 *
 * `unknown` says so out loud rather than being omitted. An absent line reads
 * to a model exactly like a cleared one, which is the failure this whole
 * module exists to stop.
 */
export function allergyPromptLine(client: Parameters<typeof resolveAllergies>[0]): string {
  const { status, items } = resolveAllergies(client);
  if (status === "declared") {
    return `Allergies (ABSOLUTE — never suggest or serve these, at any dose): ${items.join(", ")}`;
  }
  if (status === "none") {
    return "Allergies: the client was asked and reported none.";
  }
  return "Allergies: NOT RECORDED — nobody has asked. Absence here is not clearance; do not treat this client as allergy-free.";
}

/**
 * Coach-facing label for the empty case, so no surface prints "None reported"
 * over a question that was never put to the client.
 */
export function allergyEmptyLabel(status: AllergyStatus): string {
  return status === "none" ? "None reported." : "Not recorded — never asked.";
}

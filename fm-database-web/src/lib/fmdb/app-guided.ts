/**
 * Which prescribed practices the app actually walks the client through.
 *
 * Three of them are matched by NAME rather than by a catalogue slug —
 * breathwork, EFT and the sleep wind-down predate `somatic_practice` and are
 * still resolved from free text. That was invisible to everything outside
 * `client-app.ts`, and it cost something real: the practice-phasing seeder
 * ranks guided practices into the foundation (they are the ones the app
 * coaches, so they are the ones most likely to happen), but it only knew about
 * slug-linked ones. Hariharan's EFT — his tool for the anxiety he came in with
 * — was staged out to week 7 as a result.
 *
 * The regexes live here so the seeder can ask the same question the app asks,
 * without a second copy drifting from the first. The SCOPES stay with the
 * callers, deliberately: EFT reads name + details, the sleep wind-down reads
 * the name only (because "wind down" turns up casually in other practices'
 * details, e.g. "4-7-8 breathing … to wind down before bed").
 */

/** EFT / tapping. Applied to name + details by deriveEft. */
export const EFT_RE = /\beft\b|tapping|emotional freedom/;

/** Sleep wind-down. Applied to the NAME ONLY — see the note above. */
export const SLEEP_RE =
  /wind.?down|body scan|sleep relaxation|relaxation for sleep|yoga nidra|progressive relaxation|sleep meditation|bedtime relaxation/;

/** Breathwork, first pass. deriveBreathwork narrows further from here. */
export const BREATH_RE = /breath|pranayam/i;

/**
 * Nasal-breathing and mouth-taping are all-day habits, not a paced session,
 * and deriveBreathwork skips them explicitly unless a count is given
 * ("4-7-8"). Mirrored here because the miss is not cosmetic: treating
 * "nasal-only breathing + light mouth-tape at night" as guided would also
 * reclassify it as a DEDICATED stopped moment, inflating the load count for a
 * habit that costs the client nothing.
 */
const BREATH_NOT_A_SESSION = /mouth.?tap|nasal breathing|nasal-only|nose breathing|mouth breathing/i;
const HAS_COUNT = /\d\s*[-–]\s*\d\s*[-–]\s*\d/;

/**
 * Would the app run a guided session for this practice?
 *
 * A slug link is definitive. Otherwise this is the same first-pass question
 * the name-matchers ask, and it is allowed to be slightly generous: the cost
 * of a false positive is one practice kept in the foundation that did not
 * need to be, which is far cheaper than staging out the client's anxiety tool.
 */
export function looksAppGuided(name: string, details = "", somaticSlug?: string | null): boolean {
  if (somaticSlug) return true;
  const n = (name || "").toLowerCase();
  const both = `${n} ${(details || "").toLowerCase()}`;
  if (EFT_RE.test(both) || SLEEP_RE.test(n)) return true;
  if (!BREATH_RE.test(n)) return false;
  return !BREATH_NOT_A_SESSION.test(both) || HAS_COUNT.test(both);
}

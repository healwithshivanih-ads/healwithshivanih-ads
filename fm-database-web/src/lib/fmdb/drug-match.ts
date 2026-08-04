/**
 * Shared drug-catalogue alias matcher — TS mirror of `fmdb/drug_match.py`.
 *
 * Every surface that reads `drug_depletions/*.yaml` resolves a free-text
 * medication string to a catalogue entry the same way. That logic used to be
 * copy-pasted per caller (two Server Actions here, three Python callers) and
 * the copies drifted.
 *
 * THE BUG THIS EXISTS TO PREVENT — a plain `text.includes(alias)` test has no
 * word boundary, so a SHORT alias matches inside an unrelated word:
 *
 *   'pan'  (Pan-40, pantoprazole)  matched 'recheck thyroid panel', 'Panadol'
 *   'arb'  (ARB antihypertensives) matched 'carbamazepine'
 *   'asa'  (aspirin)               matched 'fluticasone nasal spray'
 *   'ltra' (montelukast)           matched 'Ultracet'
 *
 * A false PPI match implies GERD, pulls in B12/magnesium depletion advice, and
 * changes protocol cautions. In `plans.ts` those cautions reach the plan editor
 * and the meal-plan prompt as hard constraints.
 *
 * THE RULE — aliases shorter than BOUNDARY_MAX_LEN must match on a LETTER
 * boundary; longer ones keep plain substring matching so multi-word brand
 * strings ("Pan-D 40", "metformin xr") still resolve. Letters only, not `\b`:
 * digits and punctuation must be allowed to terminate an alias, or "Pan-40"
 * and "Pan40" stop matching the PPI entry they name.
 *
 * Keep this file and `fmdb/drug_match.py` in lockstep — `drug-match.test.ts`
 * asserts the two agree on the same fixtures.
 */

/** Aliases at or above this length keep plain substring matching. */
export const BOUNDARY_MAX_LEN = 5;

/** Shorter than this and a medication string is junk, not a drug name. */
export const MIN_MED_TEXT_LEN = 3;

export interface DrugAliasRecord {
  drug_name?: string;
  drug_aliases?: string[];
}

const BOUNDARY_CACHE = new Map<string, RegExp>();

function boundaryPattern(alias: string): RegExp {
  let pat = BOUNDARY_CACHE.get(alias);
  if (!pat) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pat = new RegExp(`(?<![a-z])${escaped}(?![a-z])`);
    BOUNDARY_CACHE.set(alias, pat);
  }
  return pat;
}

/**
 * True if `alias` occurs in the (already lowercased) medication string.
 * Short aliases require a letter boundary; long ones match as substrings.
 */
export function aliasMatches(alias: string, medTextLower: string): boolean {
  const a = (alias ?? "").trim().toLowerCase();
  if (!a || !medTextLower) return false;
  if (a.length < BOUNDARY_MAX_LEN) return boundaryPattern(a).test(medTextLower);
  return medTextLower.includes(a);
}

/** Name + every alias for one catalogue record, lowercased and deduped. */
export function drugAliases(drug: DrugAliasRecord): string[] {
  const out: string[] = [];
  for (const raw of [drug.drug_name, ...(drug.drug_aliases ?? [])]) {
    const a = String(raw ?? "").trim().toLowerCase();
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Resolve one medication string to a catalogue record, or null.
 * Longest alias wins, so "metformin xr" picks a more specific entry over a
 * shorter alias that also matches.
 */
export function matchDrug<T extends DrugAliasRecord>(
  medText: string,
  drugs: readonly T[],
  opts: { minLen?: number } = {},
): { drug: T; alias: string } | null {
  const text = (medText ?? "").trim().toLowerCase();
  if (text.length < (opts.minLen ?? MIN_MED_TEXT_LEN)) return null;
  let best: { len: number; drug: T; alias: string } | null = null;
  for (const d of drugs) {
    for (const a of drugAliases(d)) {
      if (aliasMatches(a, text) && (!best || a.length > best.len)) {
        best = { len: a.length, drug: d, alias: a };
      }
    }
  }
  return best ? { drug: best.drug, alias: best.alias } : null;
}

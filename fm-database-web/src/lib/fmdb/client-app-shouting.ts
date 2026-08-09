/**
 * softenShoutedOpener — the coach's ALL-CAPS emphasis, calmed down for the
 * client's screen.
 *
 * coach_rationale routinely opens with a shouted keyword the coach wrote to
 * catch her OWN eye while editing: "REPLACES her Wellbeing triple magnesium
 * complex…", "STOP the ash gourd…", "TIMING CORRECTED — …". On a supplement
 * card that reads as the app shouting at the person taking it. Caught live on
 * cl-022's magnesium card (2026-08-09); ~10 more sit in published plans today.
 *
 * Fixed at RENDER time, not in the YAML, because published plans are frozen and
 * the emphasis is legitimately useful to the coach in her own editor.
 *
 * Deliberately narrow — only the LEADING run of shouted words, only runs of 4+
 * consecutive LETTERS. That protects the short acronyms this domain is full of
 * (B12, NAC, IU, EPA, DHA, PPI) and never touches a capitalised word
 * mid-sentence, where the caps are far more likely to be a real acronym than
 * emphasis.
 *
 * Letters only, no separators inside the run: an earlier version allowed "/"
 * so that "EPA/DHA" measured 7 characters and got softened to "Epa/dha". A
 * slash-joined pair of short acronyms is the normal case in this domain, not
 * the exception.
 */

/** "REPLACES her …" → "Replaces her …"; "TIMING CORRECTED — …" → "Timing corrected — …" */
export function softenShoutedOpener(input: string): string {
  const s = input || "";
  // Leading run of ALL-CAPS words, each 4+ letters with no separator inside.
  const m = s.match(/^(\s*)((?:[A-Z]{4,}(?:\s+|$))+)/);
  if (!m) return s;
  const lead = m[1];
  const shouted = m[2];
  // Sentence-case the run: first letter of the first word stays capital, the
  // rest goes lower. "TIMING CORRECTED " → "Timing corrected ".
  const softened = shouted.charAt(0) + shouted.slice(1).toLowerCase();
  return lead + softened + s.slice(m[0].length);
}

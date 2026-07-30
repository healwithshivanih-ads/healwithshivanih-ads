/**
 * The coach's third-person voice, rewritten for the person reading it.
 *
 * `toSecondPerson` in client-app.ts already turns she/he/her/his into you and
 * your. It had no rule for the coach naming the person as a NOUN — and
 * "This client's anxiety, chronic sleeplessness, and 'running on empty'
 * feeling…" reached a real client's own plan screen on the tissue-salt card.
 *
 * Split out so it can be tested against that exact sentence. The rewrite is
 * deliberately a normalisation to a PRONOUN rather than a direct swap to
 * "you": routing it through the existing pronoun rules means verb agreement
 * ("the client takes" → "you take", not "you takes"), possessives and
 * re-capitalisation all come for free and stay in one place.
 */

/** Client-as-noun → she/her, for `toSecondPerson` to finish the job. */
export function clientNounToPronoun(input: string): string {
  return (input || "")
    .replace(/\b(?:this|the|our|my)\s+client['’]s\b/gi, "her")
    .replace(/\b(?:this|the|our|my)\s+client\b/gi, "she")
    .replace(/\bclient['’]s\b/gi, "her")
    .replace(/\bthe\s+patient['’]s\b/gi, "her")
    .replace(/\b(?:this|the)\s+patient\b/gi, "she");
}

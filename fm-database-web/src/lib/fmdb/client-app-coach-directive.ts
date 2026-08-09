/**
 * stripCoachDirective — extracted from client-app.ts (no `server-only`, so it's
 * testable in isolation) so both callers that render coach text onto the client
 * app (clientifyPracticeDetail, clientifyWhy) share one denylist.
 *
 * Coach copy routinely contains instructions to the COACH about how to deliver
 * something — "…and it should be said to her that way", "tell her this is not a
 * punishment", "she must not feel she is losing that". Legitimate coach-facing
 * notes, but on the client's own phone they read as stage directions about the
 * reader, which is worse than saying nothing.
 *
 * Caught live 2026-08-09 on cl-022's magnesium card, which rendered:
 *   "…this is a swap, not a removal, and it should be said to your that way."
 * Two bugs in one line — the pronoun mangle (fixed in client-app-third-person)
 * and the directive reaching her at all (fixed here). It is the latter that
 * makes this a class of leak rather than a typo.
 *
 * CLAUSE-level first, then sentence-level. The supplement "why" is truncated to
 * its FIRST SENTENCE upstream (`firstSentence(coach_rationale)`), so a
 * sentence-level-only strip would blank the card whenever the coach appended a
 * directive to an otherwise good opening line — throwing away "this is a swap,
 * not a removal", which the client genuinely needs, to remove five words.
 */

/** Verbs of SAYING aimed at the client — the coach briefing herself. */
const DIRECTIVE = new RegExp(
  [
    // "should be said/framed/presented/positioned/pitched/worded that way"
    String.raw`\bshould\s+be\s+(?:said|framed|presented|positioned|pitched|worded|phrased|communicated)\b`,
    // "say/said/explain/frame/phrase/word/present/pitch … to her/him/the client"
    String.raw`\b(?:say|said|says|explain|explained|frame|framed|phrase|phrased|word|worded|present|presented|pitch|pitched|sell|position)\b[^.;]{0,40}?\bto\s+(?:her|him|the\s+(?:client|patient))\b`,
    // "tell/told/remind/reassure/warn/emphasise … her/him/the client"
    String.raw`\b(?:tell|told|remind|reminded|reassure|reassured|warn|warned|emphasi[sz]e|emphasi[sz]ed|flag)\s+(?:her|him|the\s+(?:client|patient))\b`,
    // "do not tell/mention/say", "don't frame this as"
    String.raw`\bdo(?:es)?\s*n(?:o|')t\s+(?:tell|mention|say|frame|call)\b`,
    // "she must not feel …", "he should not think …" — instructions about the
    // reader's emotional state, addressed to the coach
    String.raw`\b(?:she|he)\s+(?:must|should|can)\s*n(?:o|')?t?\s+(?:not\s+)?(?:feel|think|see\s+this|read\s+this)\b`,
    // "make sure she understands / knows / feels"
    String.raw`\bmake\s+(?:sure|it\s+clear)\b[^.;]{0,40}?\b(?:she|he|her|him|the\s+(?:client|patient))\b`,
    // explicit coach-note framing
    String.raw`\b(?:coach\s+script|say\s+it\s+like\s+this|in\s+her\s+words|worth\s+saying)\b`,
  ].join("|"),
  "i",
);

/**
 * Drop coach-directive text, preferring the smallest cut that removes it.
 *
 * 1. Trailing/embedded COORDINATED clauses — ", and it should be said to her
 *    that way" — are lifted out, keeping the rest of the sentence intact.
 * 2. Any SENTENCE still carrying a directive is dropped whole.
 */
export function stripCoachDirective(input: string): string {
  const sentences = (input || "").split(/(?<=[.!?])\s+/);
  const kept = sentences
    .map((seg) => {
      if (!DIRECTIVE.test(seg)) return seg;
      // Try clause surgery before giving up on the whole sentence: split on
      // ", and" / ", so" / " — and" / "; " boundaries and drop only the guilty
      // pieces. Rejoin with the separator each clause arrived with so the
      // punctuation of the surviving text is unchanged.
      const parts = seg.split(/(\s*(?:,|;|—|–)\s*(?:and|so|but|then)?\s*)/);
      // parts alternates [clause, sep, clause, sep, …]
      const clauses: string[] = [];
      const seps: string[] = [];
      parts.forEach((p, i) => (i % 2 === 0 ? clauses.push(p) : seps.push(p)));
      if (clauses.length < 2) return ""; // nothing to salvage — drop sentence
      const clean = clauses.map((c) => !DIRECTIVE.test(c));
      if (!clean.some(Boolean)) return ""; // every clause is a directive
      let out = "";
      clauses.forEach((c, i) => {
        if (!clean[i]) return;
        out += out ? (seps[i - 1] ?? " ") + c : c;
      });
      out = out.trim();
      if (!out) return "";
      // A salvaged clause can end mid-sentence ("…not a removal") — restore
      // terminal punctuation so the card doesn't read as truncated.
      return /[.!?]$/.test(out) ? out : out + ".";
    })
    .filter((seg) => seg.trim().length > 0);
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

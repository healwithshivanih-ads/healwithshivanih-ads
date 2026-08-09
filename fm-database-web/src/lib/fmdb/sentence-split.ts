/**
 * mapSentences — sentence-wise rewriting that PRESERVES the gaps between
 * sentences.
 *
 * Both client-facing scrubs (stripEvidenceHedging, stripCoachDirective) work a
 * sentence at a time, and both originally did `split(/(?<=[.!?])\s+/)` …
 * `join(" ")`. That silently rewrites every gap as a single space — so a
 * practice `details` written as
 *
 *     Walk for 10 minutes after every meal.
 *     Keep the pace easy — you should be able to talk.
 *
 * arrives on the client's phone as one run-on paragraph, even when neither
 * sentence was touched. clientifyPracticeDetail is explicitly documented to
 * "PRESERVE the full instructional text and its line breaks (bulleted steps
 * render on their own lines via white-space: pre-wrap)" — the join was quietly
 * defeating it. Found 2026-08-09 by the first test ever written against these
 * pipelines.
 *
 * Shared rather than fixed twice: a third scrub of this shape is a matter of
 * time, and the copy that gets forgotten is the one that reintroduces this.
 */

/**
 * Apply `fn` to each sentence; keep the original whitespace between the
 * survivors. Returning "" (or whitespace) drops a sentence, and its trailing
 * gap goes with it.
 */
export function mapSentences(input: string, fn: (sentence: string) => string): string {
  // Capturing group → the separators survive in the split output.
  const parts = (input || "").split(/(?<=[.!?])(\s+)/);
  const out: string[] = [];
  const gaps: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const rewritten = fn(parts[i]);
    if (rewritten.trim().length === 0) continue;
    out.push(rewritten);
    gaps.push(parts[i + 1] ?? " ");
  }
  return out
    .map((seg, i) => (i < out.length - 1 ? seg + (gaps[i] ?? " ") : seg))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

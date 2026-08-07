/**
 * Is this catalogue prose safe to put in front of a client?
 *
 * Sibling of `stripEvidenceHedging`, and the same class of leak it was written
 * for: coach copy reaching a client's phone. This one caught a real case —
 * the exercise card for sit-to-stand read
 *
 *   "Standing up and sitting down under control — the single most transferable
 *    movement in the catalogue, and the one the 30-second chair stand test
 *    measures."
 *
 * — which names our own catalogue and a clinical test, to the person doing the
 * exercise. Ten of the 56 exercise summaries carry something like it: a source
 * (Otago, LIFTMOR, NICE), a test, the word "protocol", or a consequence nobody
 * should read about themselves ("what converts weakness into dependence").
 *
 * WHY THIS WITHHOLDS RATHER THAN STRIPS. `stripEvidenceHedging` removes a
 * clause and leaves a sentence that still reads. These leaks are structural —
 * the coach-facing part IS the point of the sentence — so cutting it leaves a
 * stub ("Standing up and sitting down under control —"). A missing line is
 * better than a mangled one, and better still than a leak.
 *
 * The real fix for any entry caught here is to author its `client_summary`.
 * This is the net beneath that, so an unauthored entry degrades to silence
 * instead of to coach prose.
 */

const COACH_FACING = new RegExp(
  [
    // Our own vocabulary about the library
    String.raw`\bcatalogue\b`,
    String.raw`\bthe library\b`,
    String.raw`\bthis entry\b`,
    String.raw`\bentry in\b`,
    String.raw`\bprotocol\b`,
    String.raw`\bprescrib\w*`,
    // Named sources — a client has no idea what these are
    String.raw`\bOtago\b`,
    String.raw`\bLIFTMOR\b`,
    String.raw`\bNICE\b`,
    String.raw`\bSTEADI\b`,
    String.raw`\bIFCT\b`,
    String.raw`\bUSDA\b`,
    // Clinical measurement language
    String.raw`\b\d+-second\b`,
    String.raw`\bchair stand test\b`,
    String.raw`\bthe assessment\b`,
    String.raw`\bassessed?\b`,
    String.raw`\bbaseline measure\b`,
    // Prognosis a client should never read about themselves
    String.raw`\bdependence\b`,
    String.raw`\bfrailty\b`,
    String.raw`\bsarcopeni\w*`,
    String.raw`\bmortality\b`,
    String.raw`\bdeconditioning\b`,
    // Who it is addressed to
    String.raw`\bclinician\b`,
    String.raw`\bthe coach\b`,
    String.raw`\bthe client\b`,
  ].join("|"),
  "i",
);

/** True when this text is written for the coach, not the person doing it. */
export function looksCoachFacing(text: string): boolean {
  return COACH_FACING.test(text || "");
}

/**
 * The line to show a client, or "" when there isn't a safe one.
 *
 * Order matters: an authored client line always wins; a coach summary is used
 * only when it happens to be clean; nothing is shown otherwise. The fallback is
 * the whole risk here — falling back unconditionally is exactly what put the
 * catalogue's own vocabulary on a client's phone.
 */
export function clientFacingSummary(
  clientSummary: string | undefined,
  summary: string | undefined,
): string {
  const authored = (clientSummary || "").trim();
  if (authored) return authored;
  const fallback = (summary || "").trim();
  return fallback && !looksCoachFacing(fallback) ? fallback : "";
}

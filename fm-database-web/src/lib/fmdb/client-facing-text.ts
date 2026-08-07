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
 * WHAT `looksCoachFacing` IS FOR, AND WHAT IT IS NOT. It is an AUTHORING check
 * — it runs in tests over the catalogue and over prescription notes, so
 * coach-voiced text is caught while someone can still rewrite it. It is NOT a
 * render-time filter, because a denylist cannot decide audience: "Cheap to add
 * and it protects the knee by making a stumble less likely" contains no
 * jargon, no source and no test, and is still plainly one professional talking
 * to another about whether to bother. Render-time safety comes from reading the
 * client-facing FIELD, not from screening the coach-facing one.
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
    // Deciding WHETHER TO PRESCRIBE it — a conversation the client is not in.
    // "Balance, holding a counter. Cheap to add and it protects the knee by
    // making a stumble less likely" reached a real client's plan.
    String.raw`\bcheap to (?:add|include)\b`,
    String.raw`\b(?:high|highest)[- ]value\b`,
    String.raw`\bhigh[- ]yield\b`,
    String.raw`\bworth adding\b`,
    String.raw`\bstated goal\b`,
    String.raw`\bthe limiting factor\b`,
    String.raw`\bthe specific complaint\b`,
    // Where it sits in OUR progression — meaningless to the person doing it
    String.raw`\bthe rung\b`,
    String.raw`\brung (?:above|below)\b`,
    String.raw`\bthe book'?s\b`,
    String.raw`\bprogression ladder\b`,
  ].join("|"),
  "i",
);

/** True when this text is written for the coach, not the person doing it. */
export function looksCoachFacing(text: string): boolean {
  return COACH_FACING.test(text || "");
}

/**
 * The line to show a client: the authored one, or nothing.
 *
 * THERE IS DELIBERATELY NO FALLBACK TO `summary`. An earlier version fell back
 * when the coach summary happened to look clean, which needs a denylist to be
 * complete — and it never can be. The first pass caught named sources and
 * clinical tests but sailed past prescribing cost-benefit ("Cheap to add and it
 * protects the knee") and catalogue-progression framing ("the rung above a
 * floor dip", "the book's gentlest jump"), all of which reached a client. Those
 * read as fine English; what makes them wrong is only the AUDIENCE, and no
 * pattern reliably detects audience.
 *
 * So the rule is the field, not the wording: `summary` is written for the coach
 * and never shown; `client_summary` is written for the client and is the only
 * thing shown. All 56 catalogue entries carry one, and the test in this
 * directory fails if a new entry arrives without one.
 */
export function clientFacingSummary(
  clientSummary: string | undefined,
  _summary?: string | undefined,
): string {
  return (clientSummary || "").trim();
}

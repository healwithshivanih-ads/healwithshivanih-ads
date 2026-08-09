/**
 * stripEvidenceHedging — extracted from client-app.ts (no `server-only`, so
 * it's testable in isolation) so the two callers that render coach text onto
 * the client app (clientifyPracticeDetail, clientifyWhy) share one denylist.
 *
 * Coach copy routinely explains ITS OWN CONFIDENCE in a supplement/practice
 * ("Evidence tier plausible_emerging — trial it for 12 weeks", "the
 * phase-timing protocol is thin on evidence") — legitimate coach-facing
 * reasoning, but it must never reach the client: it reads as "we don't
 * actually believe the science", which undermines an instruction the coach
 * DOES want followed. Caught live on cl-022 in two places at once (a practice
 * `details` AND a supplement `coach_rationale`), which makes this a class of
 * leak, not a one-off typo.
 */

import { mapSentences } from "./sentence-split";

const EVIDENCE_HEDGE = new RegExp(
  [
    String.raw`\bevidence[- ]tier\b`,
    String.raw`\bcatalogue?[- ]tier\b`,
    String.raw`\bfm[_-]?specific[_-]?thin\b`,
    String.raw`\bconfirm[_-]with[_-]clinician\b`,
    String.raw`\bplausible[_-]emerging\b`,
    String.raw`\bthin on evidence\b`,
    // "evidence" ... "thin"/"limited"/"weak"/"insufficient" within a short
    // span, either order — real coach phrasing varies ("evidence tier
    // plausible_emerging", "the evidence here is thin", "limited evidence
    // behind it"), and "thin"/"weak"/"limited" near "evidence" is never an
    // affirmative framing, so a bounded word-gap match is safe either way.
    String.raw`\bevidence\b(?:\s+\S+){0,3}\s+(?:is\s+)?(?:thin|limited|weak|insufficient)\b`,
    String.raw`\b(?:limited|weak|insufficient)\s+evidence\b`,
    String.raw`\blacks?\s+(?:strong|robust)?\s*evidence\b`,
    String.raw`\bnot\s+(?:yet\s+|well[- ])establish`,
    String.raw`\bconfirm\s+with\s+(?:your\s+)?clinician\b`,
    String.raw`\bunproven\b`,
  ].join("|"),
  "i",
);

/** Drop any SENTENCE containing evidence-hedging language, keep the rest.
 *  Sentence-level, not whole-drop, because the surrounding text is usually
 *  multi-sentence and the hedge is one clause among several genuinely useful
 *  ones — dropping everything would throw away the instruction along with
 *  the caveat. */
export function stripEvidenceHedging(s: string): string {
  // mapSentences, not split/join — the old join(" ") flattened the line breaks
  // that clientifyPracticeDetail is documented to preserve.
  return mapSentences(s, (seg) => (EVIDENCE_HEDGE.test(seg) ? "" : seg));
}

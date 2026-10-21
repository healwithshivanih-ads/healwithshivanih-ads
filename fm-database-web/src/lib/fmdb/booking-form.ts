/**
 * Booking-form answers: reading them back off the saved note, and picking the
 * one that is actually the person's concern.
 *
 * WHY THIS EXISTS. The booking intake used to take the FIRST form answer as
 * the concern. On the cal.com form the first question is "How long has this
 * been going on?", so the follow-up drafts read "what you shared about 1 to 3
 * years" (cl-907, cl-909, Oct 2026). The concern is the answer to the
 * "main area of concern" question, wherever it sits in the form.
 *
 * Pure: no I/O.
 */

export interface BookingFormAnswer {
  question: string;
  answer: string;
}

/** The questions whose answer IS the concern, best first. */
const CONCERN_QUESTION = /concern|what brings|bring(s)? you|problem|issue|help (you )?with|health goal|symptom|struggl|looking for help/i;
/** Free-text notes fields — the next best source. */
const NOTES_QUESTION = /^(additional[_ ]?notes|notes|anything else|message|comments?)$/i;
/** Questions that are never the concern even if they mention it. */
const NOT_CONCERN_QUESTION = /how long|since when|willing|invest|budget|how did you (hear|find)|referr|\bage\b|\bgender\b|\bcity\b|\blocation\b/i;

/** "1 to 3 years", "Less than 6 months", "More than 3 years", "2 weeks". */
const DURATION_ANSWER = /^(less than|more than|over|under|about|around|approx\.?|~)?\s*\d+\s*(\+|plus)?\s*((to|-|–)\s*\d+\s*)?(day|week|month|year|yr)s?\b\.?$/i;
const YES_NO_ANSWER = /^(yes|no|maybe|not sure|y|n|ok|sure)\.?$/i;

function usableAnswer(a: string): boolean {
  const s = a.trim();
  if (!s) return false;
  if (DURATION_ANSWER.test(s)) return false;
  if (YES_NO_ANSWER.test(s)) return false;
  return true;
}

/**
 * The person's concern, in their own words, or null when the form did not
 * carry one. Order: the "main concern" question → a free-text notes field →
 * the first answer that is neither a duration nor a yes/no.
 */
export function bookingConcern(fields: readonly BookingFormAnswer[] | null | undefined): string | null {
  if (!fields?.length) return null;
  const clean = fields
    .map((f) => ({ question: (f.question ?? "").trim(), answer: (f.answer ?? "").trim() }))
    .filter((f) => usableAnswer(f.answer));
  const byQuestion = clean.find(
    (f) => CONCERN_QUESTION.test(f.question) && !NOT_CONCERN_QUESTION.test(f.question),
  );
  if (byQuestion) return byQuestion.answer;
  const notes = clean.find((f) => NOTES_QUESTION.test(f.question));
  if (notes) return notes.answer;
  const any = clean.find((f) => !NOT_CONCERN_QUESTION.test(f.question));
  return any ? any.answer : null;
}

/**
 * All the free text a person wrote on the form (concern + notes), for concern
 * classification. Durations and yes/no answers are left out.
 */
export function bookingFreeText(fields: readonly BookingFormAnswer[] | null | undefined): string {
  if (!fields?.length) return "";
  return fields
    .filter((f) => usableAnswer(f.answer ?? "") && !NOT_CONCERN_QUESTION.test(f.question ?? ""))
    .map((f) => f.answer.trim())
    .join("\n");
}

/**
 * Read the form answers back out of a booking note written by
 * `buildBookingNote` (booking-lead-intake.ts):
 *
 *     What they told us on the booking form:
 *     - How long has this been going on?
 *       1 to 3 years
 *     - What is your main area of concern?
 *       High BP and Mental health
 *
 *     [booking: <uid>]
 */
export function parseBookingFormNote(notes: string | null | undefined): BookingFormAnswer[] {
  if (typeof notes !== "string") return [];
  const start = notes.indexOf("What they told us on the booking form:");
  if (start < 0) return [];
  const lines = notes.slice(start).split("\n").slice(1);
  const out: BookingFormAnswer[] = [];
  let cur: BookingFormAnswer | null = null;
  for (const line of lines) {
    if (/^\[booking:/.test(line.trim())) break;
    const q = line.match(/^- (.*)$/);
    if (q) {
      if (cur) out.push(cur);
      cur = { question: q[1].trim(), answer: "" };
      continue;
    }
    if (cur && /^\s{2,}\S/.test(line)) {
      cur.answer = cur.answer ? `${cur.answer}\n${line.trim()}` : line.trim();
    }
  }
  if (cur) out.push(cur);
  return out.filter((f) => f.question || f.answer);
}

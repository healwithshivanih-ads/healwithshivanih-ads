/**
 * Acute-risk triage for anything a client types into their app.
 *
 * There were two copies of this list — one client-side in ochre-coach.tsx as a
 * UX optimisation, one server-side in the co-pilot route as the authoritative
 * gate. Adding a third for the chat is how a safety list drifts, and drift
 * here means a suicide cue that one surface catches and another misses. One
 * list, imported everywhere.
 *
 * Deliberately broad and biased toward firing. A false positive costs the
 * client one extra screen telling them to call for help; a false negative
 * costs something that cannot be undone. Err toward firing.
 *
 * THE CHAT MAKES THIS SHARPER, NOT SOFTER. WhatsApp at least felt
 * synchronous. A message typed into the app at 2am may sit until morning, so
 * the app must say what to do rather than imply someone is listening.
 */

export const EMERGENCY_HINTS = [
  "chest pain", "chest tightness", "can't breathe", "cant breathe", "cannot breathe",
  "can't breath", "trouble breathing", "struggling to breathe", "breathless",
  "short of breath", "heart attack", "stroke", "seizure", "passing out", "fainted",
  "faint", "collapsed", "unconscious", "slurred", "numb on one side",
  "severe bleeding", "bleeding heavily", "coughing blood", "vomiting blood",
  "overdose", "suicid", "kill myself", "killing myself", "end my life",
  "ending my life", "end it all", "want to die", "harm myself", "hurt myself",
  "self harm", "self-harm",
];

/** True when a message shows an acute cue that must not wait for a reply. */
export function isEmergency(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return EMERGENCY_HINTS.some((h) => t.includes(h));
}

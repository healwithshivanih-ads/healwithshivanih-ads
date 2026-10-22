/**
 * Under-18s on the client intake form.
 *
 * The form was written for adults. When a parent books for a teenager
 * (Krishiv, 17, Oct 2026) a handful of questions don't fit — "highest adult
 * weight" for someone still growing, a work pattern for a school student,
 * which COVID vaccine brand. Those are hidden once the date of birth entered
 * in section 1 puts the person under 18. Unknown age → the adult form, so
 * nothing disappears on a guess.
 *
 * Deliberately NOT hidden for minors: smoking / tobacco and alcohol (vaping
 * and drinking start in the teens and change the picture), the mental-health
 * question, and pregnancy status (a supplement-safety gate).
 */
import { ageFromDob } from "./age";

export const ADULT_INTAKE_MIN_AGE = 18;

export function isMinorOnIntake(dob: unknown, today: Date = new Date()): boolean {
  const age = ageFromDob(dob, today);
  return age != null && age < ADULT_INTAKE_MIN_AGE;
}

/**
 * Who sees the Menopause Rating Scale on the client intake form.
 *
 * MRS is validated for the menopausal transition and after; for a
 * 28-year-old with regular cycles it is noise. But perimenopause is
 * routinely unrecognised in women still having periods, so a cycle-status
 * gate alone would miss exactly the women it is for — hence the age floor
 * for "still menstruating".
 */
import { ageFromDob } from "./age";

/** Still-menstruating women see the MRS from this age. */
export const MRS_INTAKE_MIN_AGE = 40;

export type IntakeCycleStatus =
  | "menstruating"
  | "perimenopausal"
  | "postmenopausal"
  | "not_applicable"
  | "";

export function isFemaleSex(sex: unknown): boolean {
  return typeof sex === "string" && sex.trim().toUpperCase() === "F";
}

export function showMrsOnIntake(
  sex: unknown,
  cycleStatus: unknown,
  dob: unknown,
  today: Date = new Date(),
): boolean {
  if (!isFemaleSex(sex)) return false;
  const status = typeof cycleStatus === "string" ? cycleStatus : "";
  if (status === "perimenopausal" || status === "postmenopausal") return true;
  if (status === "menstruating") {
    const age = ageFromDob(dob, today);
    return age != null && age >= MRS_INTAKE_MIN_AGE;
  }
  return false;
}

/** The cycle-change chips only make sense while cycles still exist. */
export function showCycleChangesOnIntake(sex: unknown, cycleStatus: unknown): boolean {
  if (!isFemaleSex(sex)) return false;
  return cycleStatus === "menstruating" || cycleStatus === "perimenopausal";
}

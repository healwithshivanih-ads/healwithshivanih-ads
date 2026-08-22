/**
 * Age from a YYYY-MM-DD date-of-birth string. Returns null for anything
 * unparseable or implausible (negative, ≥130). UTC arithmetic so the
 * answer doesn't shift with the server's timezone.
 *
 * Lifted from server-actions/lab-orders.ts so the intake form's MRS gate
 * and the lab-order age logic share one definition.
 */
export function ageFromDob(dob: unknown, today: Date = new Date()): number | null {
  if (typeof dob !== "string") return null;
  const m = dob.match(/^\d{4}-\d{2}-\d{2}/);
  if (!m) return null;
  const d = new Date(m[0] + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  let a = today.getUTCFullYear() - d.getUTCFullYear();
  const mo = today.getUTCMonth() - d.getUTCMonth();
  if (mo < 0 || (mo === 0 && today.getUTCDate() < d.getUTCDate())) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

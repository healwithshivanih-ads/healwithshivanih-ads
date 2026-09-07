/**
 * Indian season for a date — used to keep maintenance menus in step with the
 * season (winter food shouldn't linger into summer). The five names match the
 * `seasons:` tags the recipe catalogue already uses (winter / spring / summer /
 * monsoon / autumn), so a season string here can filter recipes directly.
 *
 * Month → season (practical India mapping):
 *   winter  : Dec, Jan
 *   spring  : Feb, Mar
 *   summer  : Apr, May, Jun
 *   monsoon : Jul, Aug, Sep
 *   autumn  : Oct, Nov
 *
 * Pure — no I/O, no clock. Pass a YYYY-MM-DD string.
 */
export type Season = "winter" | "spring" | "summer" | "monsoon" | "autumn";

export const SEASONS: readonly Season[] = ["winter", "spring", "summer", "monsoon", "autumn"];

const MONTH_TO_SEASON: Record<number, Season> = {
  12: "winter", 1: "winter",
  2: "spring", 3: "spring",
  4: "summer", 5: "summer", 6: "summer",
  7: "monsoon", 8: "monsoon", 9: "monsoon",
  10: "autumn", 11: "autumn",
};

/** Season for a YYYY-MM-DD date string. Returns null on an unparseable input
 *  so callers can fail safe rather than mis-season a menu. */
export function seasonForYmd(ymd: string | null | undefined): Season | null {
  if (typeof ymd !== "string") return null;
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(ymd);
  if (!m) return null;
  const month = Number(m[1]);
  return MONTH_TO_SEASON[month] ?? null;
}

/** Human label for coach-facing copy. */
export function seasonLabel(s: Season): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

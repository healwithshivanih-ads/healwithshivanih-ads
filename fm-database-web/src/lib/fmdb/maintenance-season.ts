/**
 * When is a maintenance plan's seasonal menu due for a refresh?
 *
 * Coach decision 2026-09-07: a maintenance menu refreshes every ~7 weeks, OR
 * immediately when the Indian season turns (so winter food doesn't linger into
 * summer). Maintenance plans are exempt from the WEEKLY drafter (see
 * weekly-menu.ts) — this is their only regeneration path.
 *
 * Pure — the cron reads plans off disk and calls this per plan.
 */
import { seasonForYmd, type Season } from "./season";

/** ~7 weeks between refreshes when the season hasn't turned. */
export const SEASONAL_REFRESH_DAYS = 49;

export interface SeasonalMenuState {
  /** Season the live menu was last built for (stored on app_menu.season). */
  season?: string | null;
  /** When the seasonal menu was last regenerated (app_menu.seasonal_refreshed_at,
   *  YYYY-MM-DD or ISO). Null/absent = never refreshed as a seasonal menu. */
  seasonal_refreshed_at?: string | null;
}

export interface SeasonalDueResult {
  due: boolean;
  reason: "never" | "season_changed" | "stale" | "current";
  currentSeason: Season | null;
}

function daysBetween(aYmd: string, bYmd: string): number {
  const a = new Date(aYmd.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(bYmd.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Decide whether a maintenance plan's seasonal menu should regenerate today.
 * `appMenu` is plan.app_menu; `todayYmd` is YYYY-MM-DD.
 */
export function seasonalRefreshDue(
  appMenu: SeasonalMenuState | null | undefined,
  todayYmd: string,
): SeasonalDueResult {
  const currentSeason = seasonForYmd(todayYmd);
  const last = appMenu?.seasonal_refreshed_at;
  if (!last || !/^\d{4}-\d{2}-\d{2}/.test(last)) {
    return { due: true, reason: "never", currentSeason };
  }
  // Season turned since the menu was built → refresh now, don't wait out the 7 weeks.
  if (currentSeason && appMenu?.season && appMenu.season !== currentSeason) {
    return { due: true, reason: "season_changed", currentSeason };
  }
  if (daysBetween(last, todayYmd) >= SEASONAL_REFRESH_DAYS) {
    return { due: true, reason: "stale", currentSeason };
  }
  return { due: false, reason: "current", currentSeason };
}

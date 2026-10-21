/**
 * The maintenance tier's monthly do's & don'ts card — WHEN to write one.
 *
 * The card itself is built by scripts/generate-monthly-card.py (deterministic,
 * no API). The monthly-cards cron asks this module which months a client is
 * owed and lets the script do the rest. A clean card goes live on its own; one
 * where something stands out (review_flags in the script) is held as
 * `pending_review` for the coach, and only she can release it.
 */

/** From this day of the month, next month's card is written too — so it is
 *  already on the client's app on the 1st, and a held card gives the coach a
 *  week to look at it before it is late. */
export const MONTHLY_CARD_LEAD_DAY = 25;

export type MonthlyCardStatus = "live" | "pending_review" | "skipped";

export interface StoredMonthlyCard {
  month?: string;
  title?: string;
  dos?: string[];
  donts?: string[];
  status?: MonthlyCardStatus | null;
  flags?: string[];
  generated_at?: string;
  generated_by?: "auto" | "coach";
}

/** "2026-12" + 1 → "2027-01". */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Cards written before the status field existed are live. */
export function cardStatus(card: StoredMonthlyCard | null | undefined): MonthlyCardStatus | null {
  if (!card || typeof card !== "object") return null;
  const s = card.status;
  return s === "pending_review" || s === "skipped" ? s : "live";
}

/**
 * Months this client is owed a card that does not exist yet: this month, and
 * next month once we are past MONTHLY_CARD_LEAD_DAY. A month the client is
 * not covered for (starts after `paidThrough`) is not owed — the app has
 * dropped them from maintenance by then. A card in ANY state, skipped
 * included, counts as existing: the cron never rewrites one.
 */
export function monthsOwed(
  todayYmd: string,
  existing: Record<string, unknown> | null | undefined,
  paidThrough: string | null | undefined,
  planStart?: string | null,
): string[] {
  const thisMonth = todayYmd.slice(0, 7);
  const months = [thisMonth];
  if (Number(todayYmd.slice(8, 10)) >= MONTHLY_CARD_LEAD_DAY) months.push(addMonths(thisMonth, 1));
  return months.filter((ym) => {
    if (existing && typeof existing === "object" && ym in existing) return false;
    if (paidThrough && `${ym}-01` > paidThrough) return false;
    // A plan starting next month owes nothing for this one.
    if (planStart && planStart.slice(0, 7) > ym) return false;
    return true;
  });
}

/**
 * Date formatting helpers.
 *
 * Coach's preference: "12th July 2026" style across the whole dashboard
 * (instead of the inconsistent mix of "2026-07-12", "12 Jul 2026",
 * "Jul 12, 2026" we had before).
 *
 * - `formatLongDate("2026-07-12")` → "12th July 2026"
 * - `formatShortDate("2026-07-12")` → "12 Jul 2026" (chip-friendly)
 * - `formatDateTime("2026-07-12T14:30:00")` → "12th July 2026, 2:30 PM"
 *
 * Invalid / empty input → "—" (em-dash) so callers don't need to
 * branch. Pass-through string fallback when the input is parseable
 * but not standard ISO.
 */

/** Ordinal suffix for the day-of-month: 1st 2nd 3rd 4th 21st 22nd … */
function ordinalSuffix(day: number): string {
  // Special-case 11, 12, 13 — always "th".
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDate(input: string | Date | undefined | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** "12th July 2026" — coach's preferred long form. */
export function formatLongDate(input: string | Date | undefined | null): string {
  const d = parseDate(input);
  if (!d) return "—";
  const day = d.getDate();
  return `${day}${ordinalSuffix(day)} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "12 Jul 2026" — compact form for chips / tables / inline mentions. */
export function formatShortDate(input: string | Date | undefined | null): string {
  const d = parseDate(input);
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "12th July 2026, 2:30 PM" — long form + 12-hour time. */
export function formatDateTime(input: string | Date | undefined | null): string {
  const d = parseDate(input);
  if (!d) return "—";
  const day = d.getDate();
  const date = `${day}${ordinalSuffix(day)} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date}, ${time}`;
}

/** Relative age like "3 days ago" / "today" / "2 months ago". Useful for
 *  recent-activity labels. Returns "—" for invalid input. */
export function relativeAge(
  input: string | Date | undefined | null,
  now: Date = new Date(),
): string {
  const d = parseDate(input);
  if (!d) return "—";
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 0) {
    const ahead = Math.abs(diffDays);
    if (ahead === 1) return "tomorrow";
    if (ahead < 7) return `in ${ahead} days`;
    if (ahead < 30) return `in ${Math.round(ahead / 7)} weeks`;
    return `in ${Math.round(ahead / 30)} months`;
  }
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.round(diffDays / 30)} months ago`;
  return `${Math.round(diffDays / 365)} years ago`;
}

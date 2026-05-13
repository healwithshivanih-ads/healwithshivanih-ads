// Relative-time parser used by the future Filter DSL ("inactive for 30 days",
// "appointment within 24h", etc.). Built now so the DSL evaluator in a later
// round has a stable helper to call.
//
// Accepts:
//   "30 days ago"        → Date 30 days before now
//   "in 2 hours"         → Date 2 hours from now
//   "now"                → current Date
//   ISO-8601 strings     → new Date(input)
//   { unit, value, dir } → explicit form

const UNITS = {
  s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
  mo: 2_592_000_000, month: 2_592_000_000, months: 2_592_000_000,
  y: 31_536_000_000, year: 31_536_000_000, years: 31_536_000_000,
};

/**
 * Parse a relative-time expression to an absolute Date.
 * Returns `null` on failure (caller decides whether to throw).
 */
export function parseRelative(input, now = new Date()) {
  if (input == null) return null;
  if (input instanceof Date) return input;

  if (typeof input === 'object' && input.unit && input.value != null) {
    const ms = (UNITS[input.unit] || 0) * Number(input.value);
    if (!ms) return null;
    return new Date(now.getTime() + (input.dir === 'past' ? -ms : ms));
  }

  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === 'now') return new Date(now);

  // ISO-8601 fast path
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // "<n> <unit> ago"
  const past = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)\s+ago$/);
  if (past) {
    const ms = UNITS[past[2]] * Number(past[1]);
    return ms ? new Date(now.getTime() - ms) : null;
  }
  // "in <n> <unit>" or "<n> <unit>"
  const future = s.match(/^(?:in\s+)?(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (future) {
    const ms = UNITS[future[2]] * Number(future[1]);
    return ms ? new Date(now.getTime() + ms) : null;
  }
  return null;
}

export function isWithin(targetDate, ms) {
  if (!targetDate) return false;
  const t = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (isNaN(t)) return false;
  return Math.abs(Date.now() - t.getTime()) <= ms;
}

export const HOURS = (n) => n * 3_600_000;
export const DAYS  = (n) => n * 86_400_000;

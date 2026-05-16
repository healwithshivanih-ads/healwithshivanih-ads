/**
 * Server-only helper — slices the saved meal-plan letter HTML into the
 * chunks the Active Plan Reference modals need:
 *   - styleBlock: the `<style>…</style>` body lifted out of <head>. We
 *     inject it into the iframe srcDoc so each modal gets free brand
 *     styling without having to re-implement the print-letter CSS.
 *   - supplementSchedule: the `<div id="supplement-schedule">…</div>`
 *     (rendered by render-client-letter.py's
 *     `_build_supplement_schedule_html`).
 *   - weeks: per-week HTML keyed by week number. We're tolerant of two
 *     heading variants the letter generator has emitted in the wild:
 *       <h2>Week 1 …</h2>   ← v0.43 wrap_week_sections wraps these
 *       <h3>🗓 Week 1 Meal Plan</h3>   ← consolidated letters tend to land here
 *     Both get the slice from the heading down to the next Week-N heading
 *     (or supplement section / brand footer).
 *
 * Returns null on extraction failure rather than throwing — the
 * reference page is a coach utility, not life-critical, and a missing
 * meal-plan letter is the normal case for a fresh draft plan.
 */

const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/i;
const SUPP_RE = /<div\b[^>]*id="supplement-schedule"[^>]*>([\s\S]*?)<\/div>\s*(?=<div\b[^>]*id=|<h[1-3]|<footer|<\/div>|$)/i;

// Match either H2 or H3 with the word "Week" + a number, anywhere in the
// heading text. Emoji-tolerant (🗓 or none).
const WEEK_HEADING_RE = /<h([23])\b[^>]*>[^<]*?Week\s+(\d+)[^<]*?<\/h\1>/gi;

export interface LetterSections {
  styleBlock: string;
  supplementSchedule: string | null;
  weeks: Record<number, string>;
}

export function extractLetterSections(html: string): LetterSections | null {
  if (!html || html.length < 200) return null;

  const styleMatch = STYLE_RE.exec(html);
  const styleBlock = styleMatch ? styleMatch[1] : "";

  // Pull out the supplement-schedule div. Greedy until the next anchor
  // landmark — works for both wrap_week_sections-wrapped HTML and the
  // older flat layout.
  let supplementSchedule: string | null = null;
  const suppMatch = SUPP_RE.exec(html);
  if (suppMatch) {
    // Re-slice to grab the whole <div id="supplement-schedule">…</div>
    // including its outer tag — easier to render in the modal verbatim.
    const startTagIdx = html.lastIndexOf("<div", suppMatch.index + 4);
    if (startTagIdx >= 0) {
      // Match nested div depth manually because the schedule contains
      // many child divs. Walk forward until depth returns to 0.
      const tail = html.slice(startTagIdx);
      let depth = 0;
      let i = 0;
      while (i < tail.length) {
        if (tail[i] === "<") {
          if (tail.startsWith("<div", i)) {
            depth++;
            const close = tail.indexOf(">", i);
            i = close < 0 ? tail.length : close + 1;
            continue;
          }
          if (tail.startsWith("</div>", i)) {
            depth--;
            i += 6;
            if (depth === 0) break;
            continue;
          }
        }
        i++;
      }
      supplementSchedule = tail.slice(0, i);
    }
  }

  // Build the week-heading index, then slice between adjacent headings.
  const weekHits: { num: number; idx: number; tagLen: number }[] = [];
  let m: RegExpExecArray | null;
  WEEK_HEADING_RE.lastIndex = 0;
  while ((m = WEEK_HEADING_RE.exec(html))) {
    weekHits.push({ num: parseInt(m[2], 10), idx: m.index, tagLen: m[0].length });
  }

  const weeks: Record<number, string> = {};
  for (let i = 0; i < weekHits.length; i++) {
    const hit = weekHits[i];
    const start = hit.idx;
    let end = weekHits[i + 1]?.idx ?? html.length;
    // Stop at the supplement section if it appears before the next week —
    // we don't want a "Week N" modal to bleed into the supplement table.
    if (suppMatch && suppMatch.index > start && suppMatch.index < end) {
      end = suppMatch.index;
    }
    // Avoid duplicating a week if the letter mentions "Week 2" both as
    // its own heading and in a teaser paragraph for the same week.
    if (weeks[hit.num]) continue;
    weeks[hit.num] = html.slice(start, end);
  }

  return { styleBlock, supplementSchedule, weeks };
}

/**
 * Compute which week the client is currently in given plan_period_start
 * (YYYY-MM-DD) and today's date. Returns 1 for the first week of the
 * protocol, n for week n. Returns null if there's no start date or the
 * date can't be parsed; caller can decide what to do (highlight nothing,
 * default to Week 1, etc.).
 */
export function computeCurrentWeek(
  planPeriodStart: string | null | undefined,
  todayIso: string,
): number | null {
  if (!planPeriodStart) return null;
  const start = new Date(`${planPeriodStart}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(today.getTime())) return null;
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  if (diffDays < 0) return null; // plan hasn't started yet
  return Math.floor(diffDays / 7) + 1;
}

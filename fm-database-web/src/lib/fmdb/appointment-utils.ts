/**
 * Shared helpers for appointment reminders / no-show messaging.
 *
 * Both live in one place so the cron, the cal-com webhook, and the
 * pending-sends drainer all derive identical, clean text.
 */

/**
 * Turn a Cal.com event title / slug into a clean service label suitable for
 * templates that phrase it as "your {{label}} session".
 *
 * Cal.com gives us things like:
 *   - event_title: "Coaching Session between Shivani Hariharan and Sudarshan Karnad"
 *   - event_slug:  "coaching-session"
 *
 * Naively using either produced "your coaching session session is today"
 * (slug → "coaching session", then the template appends " session"). We strip
 * the "between …" suffix AND a trailing "session"/"Session" word, then
 * lowercase so it reads naturally mid-sentence ("your coaching session …").
 */
export function cleanSessionLabel(raw?: string | null): string {
  if (!raw) return "coaching";
  const noWho = raw.replace(/\s*between\b.*$/i, "").trim();
  const noSlugDashes = noWho.replace(/-/g, " ").trim();
  const noTrailingSession = noSlugDashes.replace(/\bsessions?$/i, "").trim();
  return (noTrailingSession || "coaching").toLowerCase();
}

/**
 * Extract the Zoom meeting-id + password suffix from a join URL so it can be
 * appended to the template button's base URL (https://zoom.us/j/{{1}}).
 *   "https://us02web.zoom.us/j/85123456789?pwd=abc" → "85123456789?pwd=abc"
 * Returns null for non-Zoom links (e.g. Cal Video / Daily) so callers fall
 * back to a no-button template.
 */
export function extractZoomSuffix(joinUrl?: string | null): string | null {
  if (!joinUrl || typeof joinUrl !== "string") return null;
  const m = joinUrl.match(/zoom\.us\/(?:j|w|my)\/(\S+)/i);
  return m ? m[1] : null;
}

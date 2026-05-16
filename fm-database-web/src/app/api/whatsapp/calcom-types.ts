/**
 * Pure types + sync helpers for Cal.com link sending. Lives in its own
 * file because Next.js 'use server' modules can only export async
 * functions — the client component (SendBookingLinkPanel) needs the
 * `CalcomLink` type and the `renderCalcomBody` substitution helper at
 * render time, neither of which fit the server-action constraint.
 */

export interface CalcomLink {
  slug: string;
  label: string;
  /** Short subtitle on the picker button — e.g. "30-min · first contact". */
  tagline?: string;
  emoji: string;
  url: string;
  /** URL passed as {{2}} into the Meta-approved fm_book_session_v1
   *  template. Usually identical to `url`; kept separate so a coach can
   *  send a click-tracked / shortlink variant via templates while the
   *  free-text fallback still uses the canonical URL. */
  template_param_url?: string;
  default_body: string;
}

/**
 * Render `default_body` with {{name}} → client first name + {{url}} → link.
 * Used by both the Send action (to compose the final outbound body) and
 * the UI (to populate the editable textarea preview).
 */
export function renderCalcomBody(link: CalcomLink, firstName: string): string {
  return link.default_body
    .replace(/\{\{name\}\}/g, firstName || "there")
    .replace(/\{\{url\}\}/g, link.url);
}

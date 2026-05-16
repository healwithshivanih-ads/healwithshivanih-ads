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
  emoji: string;
  url: string;
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

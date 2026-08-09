/**
 * scrubAuthors — author attributions out of client-facing remedy prose.
 *
 * Lifted out of client-app.ts on 2026-08-09 for the same reason as the
 * clientify pipelines: that module is `server-only` and cannot be unit-tested,
 * and this is a pure string transform with a denylist that will grow every time
 * a new source is ingested. Body is verbatim.
 */

/** Strip author attributions from client-facing remedy prose. The catalogue
 *  keeps them (provenance matters coach-side); the client should read
 *  tradition, not citations — "Lad's universal menstrual-pain remedy" reads
 *  as silly name-dropping in the app. */
const AUTHOR_RE = /\b(?:Dr\.?\s+)?(?:Vasant\s+)?(?:Lad|Frawley|Svoboda|Welch|O['’]Neill|Thurlow)\b/g;

export function scrubAuthors(text: string): string {
  if (!text) return text;
  let s = text
    // "Lad's Agni Tea kindles…" → "Agni Tea kindles…"
    .replace(/\b(?:Dr\.?\s+)?(?:Vasant\s+)?(?:Lad|Frawley|Svoboda|Welch|O['’]Neill|Thurlow)['’]s\s+/g, "")
    // "Lad recommends / describes / identifies / lists …" and bare mentions
    .replace(AUTHOR_RE, "Ayurvedic tradition");
  // tidy double-spaces and capitalize a now-leading lowercase letter
  s = s.replace(/\s{2,}/g, " ").trim();
  if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

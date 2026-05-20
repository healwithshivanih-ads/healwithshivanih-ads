/**
 * Supplement display-name helpers — strip brand prefixes (Vitaone,
 * Himalaya, Organic India, …) from user-facing names everywhere they
 * surface in the UI.
 *
 * Coach decision 2026-05-19: brand prefixes look weird to clients —
 * "Vitaone Ashwagandha" reads as the supplement being called "Vitaone
 * Ashwagandha" when it's just ashwagandha sold by VitaOne. The brand
 * shows up in the buy-link badge ("Buy ↗ [VitaOne]") which is where
 * brand attribution belongs.
 *
 * The slug stays untouched for catalogue lookups (vitaone-ashwagandha)
 * — only what the human sees is stripped.
 *
 * Pure presentation, no I/O — safe to import anywhere (server, client,
 * edge).
 */

const BRAND_PREFIX_RE =
  /^\s*(vita[\s\-]*one|vitaone|himalaya|organic\s*india|nature[\s\-]*made|now\s*foods|jarrow|thorne|garden\s*of\s*life|kerala\s*ayurveda|upakarma\s*ayurveda|charak\s*pharma)\s+/i;

/** Strip a leading brand prefix from a display name. Idempotent.
 *  "Vitaone Ashwagandha" → "Ashwagandha".
 *  "Magnesium Glycinate" → "Magnesium Glycinate" (no change). */
export function stripBrand(name: string | undefined | null): string {
  if (!name) return "";
  return name.replace(BRAND_PREFIX_RE, "").trim();
}

/** Best-effort human display name for a supplement reference.
 *  Prefers `display_name`, falls back to slug → title-case. Brand
 *  prefix always stripped. */
export function supplementDisplayName(input: {
  display_name?: string | null;
  supplement_slug?: string | null;
  slug?: string | null;
  name?: string | null;
}): string {
  const raw =
    input.display_name ??
    input.name ??
    input.supplement_slug ??
    input.slug ??
    "";
  if (!raw) return "—";
  // If we only have a slug, turn "vitaone-magnesium-glycinate" into
  // "Magnesium Glycinate" (strip + title-case the remainder).
  const looksLikeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw);
  const titled = looksLikeSlug
    ? raw
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : raw;
  return stripBrand(titled);
}

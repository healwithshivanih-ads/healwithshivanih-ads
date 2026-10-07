/**
 * Pure alias-index helpers for catalogue slugs (no fs — unit-testable).
 *
 * When two catalogue entries are merged, the retired slug becomes an ALIAS on
 * the survivor (`ginger-root` → alias on `ginger`). Published plans, sessions
 * and coach-managed product links still carry the retired slug, so any code
 * that looks an entry up by `<slug>.yaml` must fall back to this index — a
 * bare file read silently returns nothing, and the pregnancy-safety and
 * drug-interaction checks then skip the supplement without a word.
 *
 * Mirrors `fmdb/validator.py::_resolve_index`: a canonical slug always wins
 * over another entry's alias of the same string.
 */

export interface AliasRecord {
  slug?: unknown;
  aliases?: unknown;
}

export function buildAliasIndex(records: AliasRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  const canonical = new Set<string>();
  for (const r of records) {
    if (typeof r.slug === "string" && r.slug) {
      index.set(r.slug, r.slug);
      canonical.add(r.slug);
    }
  }
  for (const r of records) {
    if (typeof r.slug !== "string" || !r.slug) continue;
    for (const a of Array.isArray(r.aliases) ? r.aliases : []) {
      if (typeof a === "string" && a && !canonical.has(a) && !index.has(a)) {
        index.set(a, r.slug);
      }
    }
  }
  return index;
}

/**
 * Every slug that names the same entry as `slug`: its canonical slug plus all
 * of that entry's aliases. Used where an external key (a product link's
 * `covers:` list) may name either the old or the new slug.
 */
export function relatedSlugs(slug: string, index: Map<string, string>): string[] {
  const canonical = index.get(slug) ?? slug;
  const out = [canonical];
  for (const [k, v] of index) {
    if (v === canonical && k !== canonical) out.push(k);
  }
  if (!out.includes(slug)) out.push(slug);
  return out;
}

/**
 * Ingredient swap helpers — PURE module (no fs, no server-only) so the
 * client-side app components can import it. The server loader
 * (client-app.ts) uses the same matcher for its compliance gating, so
 * client and server can never disagree on what an ingredient "is".
 */

/** One compliant member of an ingredient swap group. */
export interface SwapMember {
  name: string;
  /** lowercase word/phrase identifiers — word-boundary matched */
  match: string[];
  note?: string;
}

/** An equivalence group from fm-database/data/swap_groups.yaml, already
 *  gated against the client's avoid tier + dietary preference. Only
 *  groups with ≥2 surviving members are exposed. */
export interface AppSwapGroup {
  id: string;
  label: string;
  note?: string;
  members: SwapMember[];
}

/** Word-boundary phrase match: does `term` appear in `text` as whole words?
 *  ("til" matches "sesame til" but never "lentil".) */
export function swapTermMatches(text: string, term: string): boolean {
  const esc = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(text.toLowerCase());
}

/** Find the swap-group member an ingredient/dish text refers to. */
export function findSwapMember(
  text: string,
  groups: AppSwapGroup[],
): { group: AppSwapGroup; member: SwapMember } | null {
  for (const group of groups) {
    for (const member of group.members) {
      if (member.match.some((t) => swapTermMatches(text, t))) return { group, member };
    }
  }
  return null;
}

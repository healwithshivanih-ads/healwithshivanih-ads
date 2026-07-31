/**
 * Dropping the half of a reading that is about someone else's version.
 *
 * A few source entries cover a condition that presents in opposite
 * directions and tag the roots accordingly — thyroid dysfunction carries both
 * "Emotional hibernation (hypothyroid pattern)" and "Chronic exclusion and
 * rage (hyperthyroid pattern)". Shown whole to a client with an UNDERactive
 * thyroid, half the card is about a condition he does not have, which reads
 * as padding and quietly undermines the half that does apply.
 *
 * The rule is deliberately conservative: a tagged root is dropped ONLY when
 * the client's own condition text positively names the OTHER variant. An
 * ambiguous condition ("thyroid problems", "thyroid imbalance") keeps
 * everything, because guessing which way it goes would be worse than showing
 * both. Only two roots in the corpus are tagged today; the pairs list is the
 * place to add more, and the fallback stays "show it" for anything unmatched.
 */

interface Variant {
  /** matches the "(… pattern)" qualifier on the root */
  tag: RegExp;
  /** matches the client's own condition wording */
  client: RegExp;
}

/** Opposing presentations of one condition. Extend as the source grows. */
const VARIANT_PAIRS: Variant[][] = [
  [
    { tag: /hypo-?thyroid/i, client: /\b(hypo-?thyroid|under-?active|hashimoto|myx)/i },
    { tag: /hyper-?thyroid/i, client: /\b(hyper-?thyroid|over-?active|graves|thyrotox)/i },
  ],
];

/**
 * Should this root be shown to a client with these conditions?
 *
 * `true` unless the root is tagged for one variant and the client's own words
 * name a different one.
 */
export function rootAppliesTo(pattern: string, conditions: string[]): boolean {
  const text = conditions.join(" · ");
  for (const pair of VARIANT_PAIRS) {
    const mine = pair.find((v) => v.tag.test(pattern));
    if (!mine) continue;                       // not a variant-tagged root
    if (mine.client.test(text)) return true;   // it IS their variant
    // drop only on positive evidence of a sibling variant
    const other = pair.some((v) => v !== mine && v.client.test(text));
    if (other) return false;
  }
  return true;
}

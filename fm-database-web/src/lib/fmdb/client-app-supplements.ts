/**
 * Supplement-row model + name matching for the client app.
 *
 * Extracted from client-app.ts (Codex audit #6). `LetterSupplementRow` is the
 * parsed shape of a supplement table row in a client letter; the matcher pairs
 * a plan supplement (by slug/display name) to its letter row by fuzzy token
 * overlap. Pure — no fs, no app types beyond the row shape it owns.
 */

export interface LetterSupplementRow {
  name: string;
  dose: string;
  when: string;
  why: string;
  buyLabel?: string;
  buyUrl?: string;
}

/** Coach-facing display names for supplement slugs that don't humanize cleanly. */
export const SUPP_NAME_OVERRIDES: Record<string, string> = {
  "vitamin-b6-p5p": "Vitamin B6 (P5P)",
  "ashwagandha-ksm66": "Ashwagandha (KSM-66)",
  "magnesium-glycinate": "Magnesium glycinate",
  "l-theanine": "L-Theanine",
  "coenzyme-q10": "Coenzyme Q10",
  "omega-3-fatty-acids": "Omega-3 (EPA + DHA)",
  selenium: "Selenium",
  methylfolate: "Methylfolate (5-MTHF)",
  "dpp-iv-enzyme": "DPP-IV Enzyme",
  "l-glutamine": "L-Glutamine",
  "algae-oil-dha-epa": "Omega-3 (algae, vegetarian)",
  "fish-oil-epa-dha": "Omega-3 (fish oil, EPA+DHA)",
};

/** Normalise a supplement name to a token key (drop parens + punctuation). */
export function suppKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Best-matching letter row for a supplement name, by token overlap (exact wins). */
export function matchSupplementRow(
  name: string,
  rows: LetterSupplementRow[],
): LetterSupplementRow | undefined {
  const key = suppKey(name);
  const tokens = key.split(" ").filter((t) => t.length > 2);
  let best: { row: LetterSupplementRow; score: number } | undefined;
  for (const row of rows) {
    const rk = suppKey(row.name);
    let score = 0;
    for (const t of tokens) if (rk.includes(t)) score++;
    if (rk === key) score += 10;
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best && best.score >= 1 ? best.row : undefined;
}

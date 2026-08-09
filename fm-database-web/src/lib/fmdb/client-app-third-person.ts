/**
 * The coach's third-person voice, rewritten for the person reading it.
 *
 * `toSecondPerson` turns she/he/her/his into you and your. It had no rule for
 * the coach naming the person as a NOUN — and "This client's anxiety, chronic
 * sleeplessness, and 'running on empty' feeling…" reached a real client's own
 * plan screen on the tissue-salt card.
 *
 * Both functions live HERE, not in client-app.ts, because that module is
 * `server-only` and therefore cannot be imported by a test. `toSecondPerson`
 * was moved across on 2026-08-09 after the possessive rule mangled a live
 * sentence on cl-022's magnesium card (see OBJECT_FOLLOWER below) — a bug that
 * a unit test would have caught at the time it was written.
 *
 * The client-as-noun rewrite is deliberately a normalisation to a PRONOUN
 * rather than a direct swap to "you": routing it through the pronoun rules
 * means verb agreement ("the client takes" → "you take", not "you takes"),
 * possessives and re-capitalisation all come for free and stay in one place.
 */

/** Client-as-noun → she/her, for `toSecondPerson` to finish the job. */
export function clientNounToPronoun(input: string): string {
  return (input || "")
    .replace(/\b(?:this|the|our|my)\s+client['’]s\b/gi, "her")
    .replace(/\b(?:this|the|our|my)\s+client\b/gi, "she")
    .replace(/\bclient['’]s\b/gi, "her")
    .replace(/\bthe\s+patient['’]s\b/gi, "her")
    .replace(/\b(?:this|the)\s+patient\b/gi, "she");
}

/**
 * Words that can follow "her"/"his" but can NEVER be the noun it possesses —
 * so a "her" in front of one of these is an OBJECT ("said to her that way",
 * "gave her the pills"), not a possessive, and becomes "you", not "your".
 *
 * Caught live: cl-022's magnesium card read "…it should be said to your that
 * way." The original list held only articles and prepositions, so "her that"
 * fell through to the possessive branch.
 *
 * Kept to closed-class function words on purpose. Anything that could plausibly
 * modify a noun in clinical prose stays OUT — "only" ("your only complaint"),
 * "very" ("your very low ferritin"), "own", "back", "right"/"left" — because a
 * false positive here mangles a correct possessive, which is the louder bug.
 */
const OBJECT_FOLLOWER = [
  // articles + prepositions (the original list)
  "the", "a", "an", "to", "for", "with", "at", "on", "in", "of", "and", "or", "but",
  // determiners + pronouns — cannot head a possessed noun phrase
  "that", "this", "these", "those", "it", "its", "they", "them", "we", "us",
  "you", "he", "she",
  // adverbs + subordinators
  "again", "too", "so", "as", "if", "when", "because", "since", "than", "then",
].join("|");

/**
 * The coach writes ABOUT the client in the third person ("Her calcium…", "she
 * keeps", "given her age"). On the client's own app that reads wrong — it must
 * be second person ("Your calcium…", "you keep", "given your age").
 * Deterministic pronoun/verb conversion, no AI. In coach_rationale / practice
 * text, she/he/her/his always refer to the CLIENT (the coach never writes about
 * herself there), so the conversion is unambiguous.
 */
export function toSecondPerson(input: string): string {
  let t = input || "";
  // "This client's anxiety…" is the coach talking ABOUT someone to herself,
  // and it reached a real client's screen on the tissue-salt card. Normalise
  // the noun to a pronoun FIRST so every rule below — verb agreement,
  // possessives, re-capitalisation — applies to it unchanged, rather than
  // bolting on a second half-tested path.
  t = clientNounToPronoun(t);
  // contractions first
  t = t
    .replace(/\b(?:she|he)['’]s\b/gi, "you're")
    .replace(/\b(?:she|he)['’]ll\b/gi, "you'll")
    .replace(/\b(?:she|he)['’]d\b/gi, "you'd")
    .replace(/\b(?:she|he)['’]ve\b/gi, "you've");
  // irregular "subject + verb" pairs (must precede the regular -s rule, or
  // "has"→"ha", "is"→"i")
  const IRREGULAR: [string, string][] = [
    ["is", "are"], ["was", "were"], ["has", "have"], ["does", "do"],
    ["goes", "go"], ["isn't", "aren't"], ["hasn't", "haven't"],
    ["doesn't", "don't"], ["wasn't", "weren't"],
  ];
  for (const [a, b] of IRREGULAR) {
    t = t.replace(
      new RegExp(`\\b(?:she|he)\\s+${a.replace(/'/g, "['’]")}\\b`, "gi"),
      `you ${b}`,
    );
  }
  // regular 3rd-person -s verbs: "she keeps" → "you keep", "he takes" → "you take"
  t = t.replace(/\b(?:she|he)\s+([a-z]+?)s\b/gi, (_m, v) => `you ${v}`);
  // any remaining subject she/he → you
  t = t.replace(/\b(?:she|he)\b/gi, "you");
  // possessive "her/his <noun>" → "your <noun>" — but NOT when what follows
  // cannot be a possessed noun, which means the "her" is an object and falls
  // through to the object rule below ("gave her the …" → "gave you the …").
  t = t.replace(
    new RegExp(String.raw`\b(?:her|his)\s+(?!(?:${OBJECT_FOLLOWER})\b)`, "gi"),
    "your ",
  );
  // possessive pronoun hers → yours; object her/him → you
  t = t.replace(/\bhers\b/gi, "yours").replace(/\b(?:her|him)\b/gi, "you");
  // re-capitalise a sentence that now starts lowercase ("Her …" → "your …")
  t = t.replace(/^\s*[a-z]/, (m) => m.toUpperCase());
  return t;
}

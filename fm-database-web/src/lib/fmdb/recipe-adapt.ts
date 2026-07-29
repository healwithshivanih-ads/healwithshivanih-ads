/**
 * Cook the recipe WITHOUT the thing this client avoids, instead of hiding it.
 *
 * The avoid gate is all-or-nothing: a curated recipe that names a food the
 * client avoids is dropped, so the dish reaches their phone with no method at
 * all. For an allium-avoiding or Jain client that is most of the catalogue —
 * 168 of 457 recipes name onion or garlic — and the dish is almost never ABOUT
 * the allium. Foxtail millet pulao is a pulao whether or not a sliced onion
 * went into the tempering.
 *
 * The first fix for this edited the seven recipes their live menus named, so
 * they were onion-free for everyone. That is the wrong trade: it changes the
 * dish for the twenty clients who eat onion in order to serve the one who does
 * not. This module makes the omission per-client instead — the catalogue keeps
 * the authentic recipe, and the client who avoids an ingredient is shown that
 * same recipe with the ingredient taken out, and told so.
 *
 * ── What is rewritten, and what is not ─────────────────────────────────────
 *
 * The INGREDIENT LIST is rewritten exactly: the offending lines are deleted.
 * That is a structural edit on a list, it cannot go wrong, and it is also the
 * only surface the avoid gate reads (title + mains + ingredients) — so it is
 * what makes the recipe legal to show at all.
 *
 * The METHOD is prose, and rewriting prose deterministically is where this
 * stops being safe. Three drafts of a clause-level scrubber were measured
 * against the real library and each shipped sentences like
 *
 *     "Add the cook off the raw smell"        ← "Add the ginger-garlic paste,
 *                                                cook off the raw smell"
 *     "Heat the ghee for 2 minutes."          ← lost its object entirely
 *     "sauté, cinnamon stick turns soft"      ← lost its "until the onion"
 *
 * so the method is now only touched where the edit is provably a list deletion:
 * the food is one item of an enumeration ("the onion, ginger and chilli"), and
 * removing it plus its connective leaves the sentence intact. A step that is
 * ONLY about the omitted food is dropped whole. EVERY OTHER STEP IS LEFT
 * VERBATIM, and `stepsStillMention` is set so the client is told, above the
 * method, to leave the ingredient out wherever it appears.
 *
 * That last case is not a compromise so much as the honest answer: a step the
 * client can read and adjust — "fry the onion until golden", under a line
 * saying "leave the onion out" — beats a mangled sentence, and beats the
 * current behaviour of showing them no method at all.
 *
 * Pure (no fs, no server-only) so the tests can sweep the whole library.
 */

/** The slice of a recipe this module reads and rewrites. */
export interface AdaptableRecipe {
  title: string;
  mains?: string[];
  ingredients: string[];
  ingredientsStructured?: { qty: string; unit: string; item: string }[];
  method: string[];
}

export interface Adaptation<T extends AdaptableRecipe> {
  /** the recipe with the avoided items taken out of every surface */
  recipe: T;
  /** the avoided foods actually removed, in the client's words ("onion") */
  omitted: string[];
  /** true when at least one method step still NAMES an omitted food, because
   *  removing it from that sentence could not be done safely. The client-facing
   *  line must then read as an instruction ("leave the onion out wherever the
   *  steps mention it") rather than a note. */
  stepsStillMention: boolean;
}

/**
 * Words that carry no food of their own. Two jobs: deciding whether a clause
 * still says anything once the omitted ingredient leaves it, and deciding
 * whether an "and" joins two foods (a list) or two actions (not a list).
 */
const NOT_A_FOOD = new Set([
  "a","an","the","and","or","with","without","then","in","into","on","to","for","of",
  "until","till","about","over","under","from","at","by","up","down","well","gently",
  "lightly","evenly","through","together","again","more","little","bit","few","some",
  "minute","minutes","min","mins","second","seconds","sec","low","medium","high",
  "add","adds","added","adding","fry","fries","frying","saute","sauté","sautee",
  "sauteed","sautéed","brown","browns","browned","browning","cook","cooks","cooked",
  "cooking","soften","softens","softened","stir","stirs","stirring","toss","tossed",
  "tossing","let","leave","leaves","keep","keeps","take","takes","put","puts","mix",
  "mixes","mixed","crackle","crackles","splutter","splutters","temper","tempers",
  "tempering","golden","translucent","soft","raw","edge","edges","smell","smells",
  "scent","aroma","fragrant","side","sides","pan","kadai","tawa","pot","cooker",
  "flame","heat","heats","heated","it","its","them","they","is","are","be","not",
  "no","do","does","this","that","these","those","first","next","last","also","just",
  "only","thinly","thickly","finely","coarsely","roughly","sliced","chopped","diced",
  "crushed","grated","minced","ground","whole","fresh","freshly","hot","cold","warm",
  "immediately","slowly","quickly","meanwhile","now","again","half","large","small",
  // FORM words: they describe what shape a food takes, they are not a food.
  // Without these, "then the ginger-garlic paste" looks like it still names
  // something ("paste") and the clause is kept instead of dropped.
  "paste","powder","mixture","pieces","piece","chunks","strips","cubes","slices",
]);

/** Verbs that make a method step an instruction rather than a fragment. */
const COOKING_VERBS = new Set([
  "add","heat","fry","saute","sauté","sautee","cook","stir","pour","cover","mix",
  "blend","grind","soak","rinse","drain","serve","garnish","temper","crackle",
  "splutter","simmer","boil","steam","roast","toss","fold","whisk","knead","rest",
  "spread","flip","remove","season","squeeze","top","finish","transfer","bring",
  "let","leave","keep","sprinkle","drizzle","press","mash","chop","slice","dice",
  "grate","peel","wash","warm","reheat","cool","set","place","arrange","layer",
  "scoop","ladle","shape","roll","cut","break","crush","marinate","coat","dust",
  "line","wrap","seal","turn","reduce","thicken","strain","skim","beat","dissolve",
  "sear","char","grill","bake","assemble","scatter","tip","swirl","adjust","taste",
]);

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/**
 * Match a food token, and take any hyphenated compound it sits inside WITH it.
 *
 * "ginger-garlic paste" must go entirely — an allium-free version of it is not
 * ginger paste, it is nothing, and leaving "ginger-" behind is worse than
 * either. The surrounding `[\w-]*` is what makes the compound one unit.
 */
/**
 * The other names a food goes by in an Indian recipe. Without these, a term
 * fails the "is the dish ABOUT it?" test on the exact recipes where it matters
 * most: "Aloo paratha" and "Aloo gobi sabzi" do not contain the string
 * "potato", so a potato-avoiding client was being handed an adapted aloo
 * paratha with the filling scrubbed out of it.
 */
const TERM_ALIASES: Record<string, string[]> = {
  potato: ["aloo", "alu"],
  // "spring onion" must be listed so the whole phrase goes: matching only
  // "onion" left the client "add the white parts of the spring".
  onion: ["spring onion", "green onion", "scallion", "pyaz", "pyaaz", "kanda"],
  garlic: ["lehsun", "lasan", "lasun"],
  beetroot: ["chukandar", "beet"],
  radish: ["mooli", "muli"],
  brinjal: ["baingan", "eggplant", "aubergine"],
};

/** Every spelling of a term, the canonical one first. */
const termWords = (term: string): string[] => [term, ...(TERM_ALIASES[term] ?? [])];

/**
 * Descriptors that belong to the food they precede. Removing "garlic" out of
 * "grated garlic and salt" without them leaves "grated salt", which reads as an
 * instruction to grate the salt.
 */
const DESCRIPTOR =
  "(?:\\b(?:finely|thinly|roughly|coarsely|freshly|well|lightly|very)\\s+)*" +
  "(?:\\b(?:sliced|chopped|grated|minced|crushed|diced|boiled|peeled|cooked|steamed|" +
  "roasted|raw|fresh|small|large|medium|whole|halved|quartered|julienned|shredded)\\s+)*";

/**
 * Match a food token, and take any hyphenated compound it sits inside WITH it.
 *
 * "ginger-garlic paste" must go entirely — an allium-free version of it is not
 * ginger paste, it is nothing, and leaving "ginger-" behind is worse than
 * either. The surrounding `[\w-]*` is what makes the compound one unit.
 */
function termRegex(term: string): RegExp {
  // Longest first: alternation is first-match-wins, so "spring onion" has to be
  // offered before "onion" or only the second word would be taken.
  const alts = termWords(term)
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+"))
    .join("|");
  return new RegExp(`[\\w-]*\\b(?:${alts})(?:e?s)?\\b[\\w-]*`, "i");
}
/**
 * The same match, but swallowing what belongs to it on either side: the
 * descriptors in front ("finely chopped garlic") and the form word behind
 * ("ginger-garlic paste"). Without the suffix the compound removal left a bare
 * "paste" and the client read "Add paste and cook 1 minute."
 */
const removalSource = (rx: RegExp) =>
  `${DESCRIPTOR}${rx.source}(?:\\s+(?:paste|powder|puree|purée))?`;
const global_ = (rx: RegExp) => new RegExp(rx.source, "gi");

/** Marks where a removal happened so the tidy-up below can act ONLY there.
 *  A private-use codepoint rather than NUL: it cannot occur in recipe text
 *  and does not trip the no-control-regex lint. */
const SENTINEL = "\uE000";

const mentions = (text: string, res: RegExp[]) => res.some((rx) => rx.test(text));

/** Does this text still name a food once the omitted terms are taken out? */
function hasOtherFood(text: string, res: RegExp[]): boolean {
  let rest = text;
  for (const rx of res) rest = rest.replace(global_(rx), " ");
  return words(rest).some((w) => w.length >= 3 && !NOT_A_FOOD.has(w));
}

/**
 * Remove the omitted terms from a clause that has other food in it.
 *
 * Only the LIST shapes are rewritten — "onion, ginger and chilli", "garlic and
 * chilli" — and only when the word on the connective's other side is a food.
 * That test is what separates a list of ingredients from a pair of actions
 * ("the onion and brown lightly"), which must not be rewritten at all.
 *
 * Returns null the moment a mention survives or the sentence is left dangling.
 */
function scrubClause(clause: string, res: RegExp[]): string | null {
  let out = clause;
  for (const rx of res) {
    const t = removalSource(rx);
    // "TERM, food"  |  "food, TERM"
    //
    // Only when the word RIGHT AFTER the comma is a food. The first draft asked
    // whether ANY later word was — and computed the "after" slice off the match
    // offset's string length rather than the offset itself, so it was reading
    // the wrong span entirely. Between them that turned "Add the ginger-garlic
    // paste, cook off the raw smell" into "Add the cook off the raw smell":
    // "cook" is a verb, the comma is a clause break, and there was no list here
    // to delete from.
    out = out.replace(new RegExp(`${t}\\s*,\\s*(?=\\S)`, "gi"), (m, ...a) => {
      const offset = a[a.length - 2] as number;
      const whole = String(a[a.length - 1]);
      const next = words(whole.slice(offset + m.length))[0];
      return next && !NOT_A_FOOD.has(next) ? SENTINEL : m;
    });
    out = out.replace(new RegExp(`\\s*,\\s*${t}(?=[\\s.,;!?]|$)`, "gi"), "");
    // "TERM and food"  |  "food and TERM". The article in front of the term goes
    // with it — without that, "add the garlic and the white parts" rebuilt as
    // "add the the white parts".
    out = out.replace(
      new RegExp(`(\\b(?:the|a|an)\\s+)?${t}\\s+and\\s+(the\\s+)?(\\w+)`, "gi"),
      (m, lead, _the, next) => {
        if (NOT_A_FOOD.has(String(next).toLowerCase())) return m;
        // The surviving item inherits the article the omitted one was carrying,
        // so "add the garlic and green chilli" reads "add the green chilli"
        // rather than "add green chilli".
        return `${_the ?? lead ?? ""}${next}`;
      },
    );
    // The gap after "and" may only hold ARTICLES and DESCRIPTORS — `t` already
    // carries the descriptor prefix. Allowing arbitrary words let this rule eat
    // a verb phrase: "Heat the ghee and soften the onion for 2 minutes" became
    // "Heat the ghee for 2 minutes."
    out = out.replace(new RegExp(`\\s+and\\s+(?:the\\s+)?${t}(?=[\\s.,;!?]|$)`, "gi"), "");
    // NOTHING ELSE. The earlier drafts also deleted a bare object ("the onion")
    // and then any surviving mention, which is where every mangled sentence came
    // from: "Heat the ghee and fry the onion for 2 minutes" became "Heat the
    // ghee for 2 minutes", "Add the ginger-garlic paste, cook off the raw smell"
    // became "Add the cook off the raw smell". Deleting a word out of the middle
    // of a sentence is only safe when the word is one item of a LIST, which is
    // exactly what the four rules above match. Every other shape is left to the
    // caller, which keeps the step verbatim and tells the client to leave the
    // ingredient out.
  }
  out = out
    // Tidy ONLY at the removal points. A blanket ",and" collapse also rewrote
    // punctuation the edit never touched ("the vegetables, and cook 3 minutes"),
    // which is not this module's business.
    .replace(/,\s*\uE000\s*and\s+/gi, " and ")
    .replace(/\uE000/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  if (!out) return null;
  if (/^(and|then|with|or|,|\.|;|-|—)\b/i.test(out)) return null;
  // A list inside a parenthetical shreds the same way: "(or cucumber or
  // beetroot — just one)" becomes "(or cucumber or — just one)".
  if (/\b(?:or|and)\s*[—–\-,;)]/i.test(out)) return null;
  if (/\(\s*(?:or|and)\b/i.test(out)) return null;
  // Punctuation-tolerant: "Peel and chop the carrots, ginger and." is dangling
  // even though the connective is not the last CHARACTER.
  if (/\b(and|with|the|a|an|of|or)[\s.,;!?]*$/i.test(out)) return null;
  if (mentions(out, res)) return null;
  return out;
}

/**
 * Did a rewrite leave a verb stranded against a connective? "Add and brown
 * lightly" and "Heat the ghee, fry, then add" read as damage, not instruction.
 * Cheap structural tell, used to reject a whole-step scrub before it ships.
 */
function looksMangled(s: string): boolean {
  if (/\b(?:add|heat|fry|cook|stir|pour|mix|serve|toss|fold|sprinkle|garnish|soften|saute|sauté)\s+(?:and|then|with|until)\b/i.test(s))
    return true;
  if (/\b(?:and|then|or)\s*[,.;:]/i.test(s)) return true;
  if (/\bthe\s+(?:and|then|with|until)\b/i.test(s)) return true;
  // A verb left hanging against a comma: "…and sauté, cinnamon stick turns…"
  if (/\b(?:add|heat|fry|cook|stir|pour|mix|toss|fold|sprinkle|garnish|soften|saute|sauté)\s*[,;]/i.test(s))
    return true;
  // "sauté, cinnamon stick turns soft" / "add the green chilli, turns golden" —
  // the clause carrying "until the onion" went, and the result now describes a
  // change of state with nothing to attach it to.
  if (/\b(?:turns|become|becomes|goes|soften|softens|wilts|browns)\b/i.test(s) && !/\buntil\b/i.test(s))
    return true;
  return false;
}

/**
 * The one bar every rewritten step must clear, whichever path produced it.
 *
 * Applying this to the whole-step attempt only was a real hole: the clause path
 * shipped "Add and stir for about 30 seconds" and "Add paste and cook 1 minute"
 * because nothing re-read what it had built.
 */
function stepIsGood(s: string, res: RegExp[]): boolean {
  if (!s) return false;
  if (mentions(s, res)) return false;
  if (looksMangled(s)) return false;
  if (!words(s).some((w) => COOKING_VERBS.has(w))) return false;
  if (!hasOtherFood(s, res)) return false;
  if (/^(and|then|with|or|,|\.|;)\b/i.test(s)) return false;
  if (/\b(and|with|the|a|an|of|or)[\s.,;!?]*$/i.test(s)) return false;
  return true;
}

/** Rejoin clauses, restoring capitalisation and the original terminator. */
function joinClauses(clauses: string[], original: string): string {
  let s = clauses.join(", ").replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  if (!s) return "";
  // Dropping the first clause can leave the sentence opening on a connective
  // ("then add the rice"). It reads better without, and it is the same
  // sentence: "Then add the rice." → "Add the rice."
  s = s.replace(/^(?:and|then)\s+/i, "");
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (/[.!?]$/.test(original.trim()) && !/[.!?]$/.test(s)) s += ".";
  return s;
}

/**
 * Rewrite a recipe without the foods this client avoids.
 *
 * Returns null — "leave it hidden" — when
 *   • a term is in the recipe's NAME. The dish IS the thing being avoided
 *     ("3-Egg Omelette (Onion & Cabbage)"); there is no version of it without.
 *   • nothing in the recipe actually names a term.
 *   • any method step cannot be scrubbed cleanly.
 *   • the rewrite would leave no ingredients, or no method.
 *
 * `terms` are the tokens that caused the rejection — AvoidFilter.blanket for a
 * coach-typed avoid list, plus the Jain screen's own words.
 */
export function adaptRecipeForAvoids<T extends AdaptableRecipe>(
  recipe: T,
  terms: string[],
): Adaptation<T> | null {
  const uniq = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!uniq.length) return null;

  // (1) The dish is the thing being avoided. Nothing to do.
  if (mentions(recipe.title, uniq.map(termRegex))) return null;

  // (2) Which terms does this recipe actually name — on ANY surface? Reading
  //     only the ingredient list let a garnish named in the method ("thinly
  //     sliced onion rings") survive the rewrite.
  const blob = [recipe.title, ...(recipe.mains ?? []), ...recipe.ingredients, ...recipe.method].join(" ");
  const omitted = uniq.filter((t) => termRegex(t).test(blob));
  if (!omitted.length) return null;
  const res = omitted.map(termRegex);

  // (3) Ingredients: drop every line that names one.
  const ingredients = recipe.ingredients.filter((i) => !mentions(i, res));
  if (!ingredients.length) return null; // the recipe WAS the omitted food

  // (4) Method. THREE outcomes per step, and never a fourth:
  //
  //   a. no mention                  → verbatim
  //   b. the step is ONLY about the  → dropped ("Fry the onion until golden.")
  //      omitted food
  //   c. the mention is one item of  → rewritten without it
  //      a list, cleanly removable
  //   d. anything else               → VERBATIM, and the client is told to
  //                                    leave the ingredient out
  //
  // (d) is the important one. The gate reads title + mains + ingredients only,
  // so a mention left in the prose does not put the recipe back in breach — and
  // a step the client can read and adjust ("fry the onion until golden", with
  // "leave out the onion" written above it) beats both a mangled sentence and
  // no method at all.
  const method: string[] = [];
  let verbatimMentions = false;
  for (const step of recipe.method) {
    if (!mentions(step, res)) {
      method.push(step);
      continue;
    }
    if (!hasOtherFood(step, res)) continue; // (b)
    const scrubbed = scrubClause(step, res); // (c)
    if (scrubbed !== null) {
      const rebuilt = joinClauses([scrubbed], step);
      if (stepIsGood(rebuilt, res)) {
        method.push(rebuilt);
        continue;
      }
    }
    method.push(step); // (d)
    verbatimMentions = true;
  }
  if (!method.length) return null;

  return {
    stepsStillMention: verbatimMentions,
    recipe: {
      ...recipe,
      ingredients,
      ...(recipe.mains ? { mains: recipe.mains.filter((m) => !mentions(m, res)) } : {}),
      ...(recipe.ingredientsStructured
        ? { ingredientsStructured: recipe.ingredientsStructured.filter((i) => !mentions(i.item, res)) }
        : {}),
      method,
    },
    omitted,
  };
}

/** "onion and garlic" — for the one warm line the client sees. */
export function omittedPhrase(omitted: string[]): string {
  const xs = omitted.map((o) => o.trim()).filter(Boolean);
  if (!xs.length) return "";
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

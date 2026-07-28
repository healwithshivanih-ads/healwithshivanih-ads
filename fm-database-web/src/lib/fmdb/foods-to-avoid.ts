/**
 * The `foods_to_avoid` safety gate — "a client must never be shown a recipe
 * naming a food they avoid".
 *
 * Lifted out of client-app.ts (2026-07-28) so it can be unit-tested, and
 * taught the one thing it could not previously express: PREPARATION.
 *
 * The problem it solves: the gate was a bare word-boundary match over the
 * whole library, so a client who only reacts to RAW onion could not be
 * recorded in `foods_to_avoid` at all — writing "raw onion" fired the onion
 * category and dropped every COOKED-onion recipe too. Measured on the live
 * 467-recipe library: "raw onion" dropped 149 recipes (butter chicken, every
 * sabzi, every dal, the egg dishes), which pushed the client off curated
 * recipes/kcal/images and silently onto the AI pack — which is NOT
 * avoid-filtered. So the honest options were "over-restrict" or "record it
 * nowhere". The coach picked nowhere, which is the unsafe one.
 *
 * Now a qualified entry ("raw onion", "raw: onion", "uncooked onion") drops
 * ONLY the recipes that use that food uncooked. Same measurement, new rule:
 * onion 149 → 18, garlic 112 → 0, tomato 70 → 11, cucumber 23 → 11.
 *
 * Unqualified entries ("onion") behave exactly as before — blanket drop.
 */

/** The shape this gate needs from a recipe. Structurally satisfied by
 *  `LetterRecipe` (library, letter-pack and home-remedy probes alike). */
export interface AvoidableRecipe {
  title: string;
  mains?: string[];
  ingredients: string[];
  method?: string[];
  /** minutes of actual cooking. `0` means nothing in this recipe is cooked —
   *  the strongest raw signal there is. `undefined` = not recorded (letter-pack
   *  recipes, home-remedy probes), which falls back to a verb scan. */
  cookTimeMin?: number;
}

/** One avoid trigger word → every ingredient that counts as a member. */
const AVOID_EXPAND: Record<string, string[]> = {
  dairy: ["milk", "curd", "dahi", "yogurt", "yoghurt", "paneer", "cheese", "cream", "khoya", "malai", "lassi", "buttermilk"],
  // "crouton" is bread the word "bread" does not catch — see the same
  // addition to the allergen scan in scripts/recipe_schema.py.
  gluten: ["wheat", "atta", "maida", "suji", "rava", "semolina", "bread", "crouton", "pasta", "barley", "rye", "dalia", "paratha", "roti", "chapati", "thepla", "poori"],
  nut: ["almond", "cashew", "walnut", "pistachio", "hazelnut", "pecan"],
  onion: ["onion", "shallot", "leek"],
  soy: ["soy", "soya", "tofu", "tempeh", "edamame"],
  // "No red meat" matched nothing — no recipe writes the phrase, they write
  // mutton and keema. Two live clients had the words on file and were being
  // offered mutton either way.
  red_meat: ["mutton", "lamb", "beef", "pork", "keema", "kheema", "bacon", "ham"],
};

const AVOID_CATEGORY_TRIGGERS: [RegExp, keyof typeof AVOID_EXPAND][] = [
  [/\b(dairy|lactose|milk)\b/, "dairy"],
  [/\b(gluten|wheat|atta|maida)\b/, "gluten"],
  [/\b(tree ?nut|nuts)\b/, "nut"],
  [/\bonion\b/, "onion"],
  [/\b(soy|soya)\b/, "soy"],
  [/\bred meats?\b/, "red_meat"],
];

/** Too generic to be worth dropping a recipe over. */
const AVOID_STOP = new Set(["oil", "salt", "water", "ghee"]);

/** Words that carry no food meaning once the "raw" qualifier is stripped, so
 *  "raw onion please" and "only raw onion" both reduce to "onion". */
const QUALIFIER_FILLER = new Set([
  "only", "just", "please", "the", "a", "an", "any", "all", "no", "not",
  "avoid", "avoids", "fine", "ok", "okay", "but", "is", "are", "and", "or",
]);

/** "raw onion" · "raw: onion" · "uncooked onion" — the preparation qualifier. */
const RAW_QUALIFIER = /\b(?:raw|uncooked)\b\s*:?\s*/;

/** The coach routinely writes the FOOD then why it is out: "Bread - causes
 *  constipation", "Brinjal — itchy tongue as a kid". Keep the head, drop the
 *  reason, or the whole entry reads as narrative and filters nothing. Split
 *  only on a SPACED dash (so "sugar-free" survives) or a colon — and only
 *  after the raw qualifier has been taken off, so "raw:onion" is not cut
 *  down to "raw". */
const REASON_TAIL = /\s+[-–—]\s+|:\s*/;

/** A recipe instruction that puts the food in UNCOOKED. */
const RAW_MARK =
  /\b(raw|uncooked|garnish\w*|sprinkl\w*|scatter\w*|topped with|top with|finish with|serves? alongside|on the side)\b/i;

/** "cook off the raw smell" / "until the raw tamarind taste goes" is a COOKING
 *  instruction that happens to contain the word "raw". Strip before testing. */
const RAW_MARK_FALSE = /\braw\s+(?:\w+\s+)?(?:smell|taste|aroma|flavou?rs?|edge|notes?)\b/gi;

/** Words in a method step that suggest heat was applied. Prefix-matched on
 *  purpose ("saut" catches saute/sauté/sauteing) — do NOT wrap these in
 *  `\b…\b`, that was the bug that made an earlier version of this scan
 *  classify every sauteed onion as raw. */
const COOK_VERBS =
  /\b(saut|fry|fried|frying|cook|boil|simmer|roast|bake|grill|griddle|temper|tadka|heat|steam|braise|caramelis|carameliz|brown|golden|translucent|soften|wilt|toast|pressure)/i;
/** Corroborating evidence that a step is actually a COOKING step. */
const COOK_CONTEXT =
  /\b(pan|tawa|kadai|skillet|wok|oven|flame|stove|griddle|pot|heat|hot|oil|ghee|butter|minute|minutes|min|second|seconds|sec|low|medium|high|until|side|lid|cover)\b/i;
/**
 * Heat in this step? Both a verb AND corroboration, because recipe prose is
 * full of cook words used as ingredient labels — "roasted cumin", "fried
 * gram", "boiled egg". Kachumber's "Add the lemon juice, roasted cumin, black
 * salt and pepper and mix" reads as cooking to a verb-only check, which would
 * have declared its raw onion cooked and defeated the whole feature.
 * Erring toward "not heat" errs toward calling the food RAW, which errs toward
 * dropping the recipe — the safe direction for an avoid list.
 */
const stepHasHeat = (s: string): boolean => COOK_VERBS.test(s) && COOK_CONTEXT.test(s);

/**
 * Is `token` used RAW in this recipe, judged from the METHOD alone?
 *
 * Rule: find where the food first enters, then look for heat FROM THAT POINT
 * ON. Anything earlier is irrelevant — chicken seared at step 3 says nothing
 * about onion laid on the wrap at step 5. Looking forward rather than at the
 * one step is what keeps batter dishes honest: a cheela mixes onion into besan
 * at step 1 with no verb, then griddles it at step 4, and that onion is cooked.
 *
 * Never named in the method? Then it's raw only if the dish never cooks at all
 * (salad, raita, chutney). Otherwise assume it goes in the pan — an unqualified
 * avoid entry stays available when a client needs the food gone outright.
 */
export function ingredientIsRawIn(r: { method?: string[] }, token: string): boolean {
  const steps = (r.method ?? []).filter(Boolean).map((s) => s.toLowerCase());
  if (!steps.length) return false;
  const rx = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const first = steps.findIndex((s) => rx.test(s));
  if (first === -1) return !steps.some(stepHasHeat);
  return !steps.slice(first).some(stepHasHeat);
}

/** Split a step into clauses so a raw marker only speaks for the food in its
 *  OWN clause: "fry the onion until golden, setting aside half for garnish"
 *  is a fried onion, not a raw one. */
const CLAUSE = /[,;.]|\bthen\b/i;

const clean = (s: string): string =>
  s.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const rawMarked = (text: string): boolean =>
  RAW_MARK.test(text.replace(RAW_MARK_FALSE, " "));

/** Word-boundary matcher that folds the trailing plural both ways, so an
 *  "onions" avoid entry catches an "onion" ingredient and vice-versa.
 *
 *  The plural fold is load-bearing, the same way it is in the allergen scan in
 *  scripts/recipe_schema.py: a bare `\bcrouton\b` does not match "croutons",
 *  which is the only spelling an ingredient list ever uses. An avoid list that
 *  misses the plural is an avoid list that does not protect anyone. */
function tokenRegex(token: string): RegExp {
  const stem = token.replace(/(?:es|s)$/, "");
  return new RegExp(`\\b${stem || token}(?:e?s)?\\b`, "i");
}

/**
 * Is this food used UNCOOKED in this recipe? Three independent signals, any
 * one of which is enough — they catch different things and a miss in either
 * direction is a real cost (drop too much and the client loses her menu; drop
 * too little and she eats the thing that hurts her).
 *
 *   1. The recipe cooks nothing at all — kachumber, raita, chutney.
 *   2. The ingredient line or a step CLAUSE marks this food raw. This is what
 *      catches a raw garnish inside an otherwise cooked dish: beetroot soup
 *      simmers for 30 minutes and finishes with "1 sprig spring onion, to
 *      garnish", which signal 3 cannot see because the token also appears
 *      earlier in "soften the onion".
 *   3. No heat from the point the food enters the method onward — the
 *      forward-looking scan, which is what tells a cheela (onion into cold
 *      batter, griddled later = cooked) from a wrap (chicken seared first,
 *      onion laid on after = raw).
 */
export function usesIngredientRaw(r: AvoidableRecipe, rx: RegExp, token: string): boolean {
  if (r.cookTimeMin === 0) return true;
  // ingredient LINE kept whole — its commas are qualifiers, not clause breaks
  if (r.ingredients.some((l) => rx.test(l) && rawMarked(l))) return true;
  for (const s of r.method ?? [])
    for (const cl of s.split(CLAUSE)) if (cl && rx.test(cl) && rawMarked(cl)) return true;
  return ingredientIsRawIn(r, token);
}

export interface AvoidFilter {
  /** false ⇒ this recipe names a food the client avoids. */
  safe: (r: AvoidableRecipe) => boolean;
  /** blanket-avoided tokens (diagnostics / tests) */
  blanket: string[];
  /** preparation-qualified tokens, raw-only (diagnostics / tests) */
  rawOnly: string[];
}

/**
 * Parse the coach's free-text `foods_to_avoid` into a recipe predicate.
 *
 * Two passes, as before: (1) category triggers scan the unqualified text and
 * expand to member ingredients (so "Gluten (wheat/atta…)" drops every wheat
 * recipe, not just the literal words); (2) short food tokens (≤3 words) —
 * long narrative fragments are skipped so a rambling avoid note can't nuke the
 * whole library.
 *
 * New: any segment carrying a "raw"/"uncooked" qualifier is routed to the
 * raw-only set INSTEAD, and is deliberately kept out of the category scan —
 * otherwise "raw onion" would fire the onion category and blanket-drop the
 * cooked onion recipes, which is the whole bug.
 */
export function buildAvoidFilter(foodsToAvoid: string): AvoidFilter {
  const text = (foodsToAvoid ?? "").toLowerCase();
  const blanketSegs: string[] = [];
  const rawSegs: string[] = [];
  // `.` is a separator too — the field is prose as often as it is a list
  // ("sea food. Tinda and karela"), and without it the whole sentence reads
  // as one over-long narrative fragment and is skipped.
  for (const seg0 of text.split(/[,;/&\n().]|\band\b/)) {
    if (!seg0.trim()) continue;
    const isRaw = RAW_QUALIFIER.test(seg0);
    const stripped = isRaw ? seg0.slice(seg0.search(RAW_QUALIFIER)).replace(RAW_QUALIFIER, "") : seg0;
    const seg = stripped.split(REASON_TAIL)[0];
    if (!seg.trim()) continue;
    (isRaw ? rawSegs : blanketSegs).push(seg);
  }

  const collect = (segs: string[]): Set<string> => {
    const out = new Set<string>();
    const joined = segs.join(" , ");
    for (const [rx, cat] of AVOID_CATEGORY_TRIGGERS)
      if (rx.test(joined)) for (const m of AVOID_EXPAND[cat]) out.add(m);
    for (const seg of segs) {
      const w = clean(seg)
        .split(" ")
        .filter((x) => x && !QUALIFIER_FILLER.has(x))
        .join(" ");
      const words = w ? w.split(" ") : [];
      if (words.length === 0 || words.length > 3) continue; // blank or narrative
      if (w.length < 3 || w.length > 22 || AVOID_STOP.has(w)) continue;
      out.add(w);
    }
    return out;
  };

  const blanket = [...collect(blanketSegs)];
  // A food already blanket-avoided doesn't need a raw rule on top.
  const rawOnly = [...collect(rawSegs)].filter((t) => !blanket.includes(t));

  const blanketRes = blanket.map(tokenRegex);
  const rawRes = rawOnly.map((t) => ({ t, rx: tokenRegex(t) }));

  const safe = (r: AvoidableRecipe): boolean => {
    if (!blanketRes.length && !rawRes.length) return true;
    const blob = `${r.title} ${(r.mains ?? []).join(" ")} ${r.ingredients.join(" ")}`.toLowerCase();
    if (blanketRes.some((rx) => rx.test(blob))) return false;
    // Preparation-qualified: only unsafe when this recipe uses it UNCOOKED.
    return !rawRes.some(({ t, rx }) => rx.test(blob) && usesIngredientRaw(r, rx, t));
  };

  return { safe, blanket, rawOnly };
}

/**
 * Dish-string anatomy — the single source of truth for breaking a menu cell
 * into components and deciding which one the dish actually IS.
 *
 * A menu cell is coach-authored free text that packs several foods into one
 * slot, joined by " + " (and, on multi-component dinners, "→" / "⇒" / ":"):
 *
 *   "Sabja seeds drink (1 glass water + 1 tsp sabja seeds soaked) + Masala Roasted Chana (2 tbsp)"
 *
 * Two things went wrong before this module existed, and both are why it does:
 *
 * 1. The separator was applied with a bare `split(/\s\+\s/)` on the RAW string,
 *    so a " + " INSIDE a portion annotation was treated as a component break.
 *    The dish above shredded into "Sabja seeds drink (1 glass water" +
 *    "1 tsp sabja seeds soaked)" + the chana — a garbled primary, a phantom
 *    component, and (for "Prawn and egg stir-fry (75g prawns + 2 eggs) + …")
 *    an unterminated string shown to the client as the dish title. Splitting
 *    is now bracket-aware: separators only count at nesting depth 0.
 *
 * 2. Every component was treated as an equal candidate for the slot's recipe,
 *    so when the FIRST one had no recipe in the library a trailing side won.
 *    Nazneen's evening snack (2026-07-24) headlined + opened Masala Roasted
 *    Chana for a slot whose primary item is the sabja drink. The dish's
 *    identity is its first SUBSTANTIVE component; anything after it is a side
 *    and must never supply the recipe. "No recipe" beats "someone else's
 *    recipe" — a wrong method on a client's phone is what erodes trust.
 *
 * 3. An em-dash was read as a descriptor even when it introduced the dish's own
 *    INGREDIENTS, so "ABC juice — apple (½ medium) + beetroot (¼ small) + …"
 *    split into three foods and titled itself after one of them. See "The gloss
 *    dash" below for why punctuation alone cannot decide this.
 *
 * Pure (no fs / no server-only) so both the server assembly and the tests can
 * share it, and so the six call sites that used to hand-roll the split can't
 * drift apart again.
 */

import PANTRY_PHRASES from "./dish-pantry.json";

/** One component of a dish — a clean title plus the portion lifted off it. */
export interface DishComponent {
  title: string;
  /** household portion, e.g. "2", "2 tbsp", "½ cup". Absent when none stated. */
  portion?: string;
}

/** A portion-shaped "(…)" — a count or a household/metric unit. Lets the app
 *  lift the portion off a dish component and show it as a clean muted token
 *  instead of raw inline parens. Kept deliberately in sync with dish-picker's
 *  PORTION_RE (coach authoring) — both sides must agree on what counts as a
 *  portion. Non-portion parens like "(new)" or "(fermented)" carry no digit or
 *  unit, so they're left untouched in the title. Global flag: a component can
 *  carry more than one (we keep the first, drop accidental doubles). */
const DISH_PORTION_RE =
  /\(\s*([^)]*?(?:\d|½|¼|¾|⅓|⅔|bowls?|cups?|glass(?:es)?|katori|tbsp|tsp|teaspoons?|tablespoons?|pieces?|small|large|medium|\bml\b|grams?|\bg\b|slices?|handful|palm)[^)]*?)\s*\)/gi;

/** Stop-words ignored when token-matching a dish to a library recipe title. */
export const RECIPE_LIB_STOP = new Set([
  "with", "and", "tbsp", "tsp", "cup", "roasted", "soaked", "ground", "fresh", "everyday", "style",
]);

/** Normalize a dish/recipe name for matching: drop "(portion)" annotations and
 *  punctuation so "Paneer sabzi (1 bowl)" keys the same as "Paneer sabzi" —
 *  the real reason menu photos vanished once dishes carried explicit portions
 *  (2026-06-15). */
export const recipeLibKey = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export const recipeLibToks = (s: string) => {
  const words = recipeLibKey(s).split(" ").filter((t) => !RECIPE_LIB_STOP.has(t));
  const strong = words.filter((t) => t.length > 3);
  if (strong.length >= 2) return strong;
  // A name must keep at least two tokens to be matchable — the near-equality
  // and whole-title-containment rules both need them. The >3 filter alone
  // deleted "dal" and "egg" and collapsed 22 catalogue titles ("Toor dal",
  // "Egg bhurji", "Moong dal", …) to a single token, so every drafter-
  // embellished cell ("Toor dal with turmeric and black pepper") fell through
  // to a paid AI recipe (2026-07-30, cl-005). Widening to 3-letter words ONLY
  // when the strict pass comes up short leaves every name that already had two
  // strong tokens — and therefore every existing match — untouched.
  const wide = words.filter((t) => t.length >= 3);
  return wide.length > strong.length ? wide : strong;
};

// Words that are dish-types / preparations / aromatics / units — NOT the
// distinctive "headline" food a dish is named after. Dropped before comparing.
export const DISH_GENERIC = new Set([
  "curry","sabzi","sabji","sabzee","dal","daal","masala","fry","stir","gravy",
  "soup","shorba","salad","chutney","raita","kachumber","roti","phulka","chapati",
  "bhakri","rice","pulao","pulav","biryani","khichdi","kitchari","chilla","cheela",
  "dosa","idli","upma","poha","paratha","thepla","bhurji","scramble","scrambled","stew",
  "poriyal","kootu","kadhi","kadi","tikka","bhaji","bhajji","wrap","bowl","toast",
  "spiced","roasted","steamed","boiled","fresh","plain","mixed","home","homemade",
  "light","warm","soft","cooked","tempered","seasoned","simple","everyday","style",
  "healing","detox","cleansing","weight","loss","herb","herbal","seasonal",
  "ginger","garlic","onion","tomato","jeera","cumin","salt","oil","ghee","butter",
  "coriander","cilantro","turmeric","haldi","pepper","chilli","chili","lemon",
  "lime","water","milk","spice","spices",
  "with","and","the","for","cup","glass","tbsp","tsp","katori","piece","small",
  "large","medium","serves","min","grams","slice","slices","handful","pinch",
]);

// Fold common Indian ↔ English food-name pairs so a synonym mismatch (dish says
// "spinach", recipe lists "palak") does NOT false-reject a correct recipe.
const FOOD_SYNONYM: Record<string, string> = {
  palak: "spinach", spinach: "spinach",
  chana: "chickpea", chole: "chickpea", chhole: "chickpea", chickpea: "chickpea",
  chickpeas: "chickpea", garbanzo: "chickpea", kabuli: "chickpea",
  paneer: "paneer", cottage: "paneer",
  baingan: "brinjal", brinjal: "brinjal", aubergine: "brinjal", eggplant: "brinjal",
  curd: "yogurt", dahi: "yogurt", yoghurt: "yogurt", yogurt: "yogurt", lassi: "yogurt",
  methi: "fenugreek", fenugreek: "fenugreek",
  lauki: "gourd", doodhi: "gourd", ghia: "gourd", bottle: "gourd", tinda: "gourd",
  turai: "gourd", ridge: "gourd", karela: "bittergourd",
  bhindi: "okra", okra: "okra",
  gobi: "cauliflower", cauliflower: "cauliflower",
  rajma: "kidneybean", kidney: "kidneybean",
  moong: "mung", mung: "mung", masoor: "lentil", toor: "lentil", arhar: "lentil",
  urad: "blackgram", chawli: "cowpea", lobia: "cowpea",
  aloo: "potato", potato: "potato",
  jowar: "sorghum", sorghum: "sorghum", ragi: "fingermillet", bajra: "pearlmillet",
  soya: "soy", soybean: "soy", tofu: "tofu",
};
export const foldFood = (t: string) => FOOD_SYNONYM[t] ?? t;

/** The distinctive foods a dish is named after — preparation words, aromatics
 *  and units removed. Empty means the text names no food of its own. */
export const dishHeadlineFoods = (s: string): string[] =>
  recipeLibKey(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !DISH_GENERIC.has(t) && !RECIPE_LIB_STOP.has(t))
    .map(foldFood);

/**
 * A SEQUENCE connective — "— then", "— then:", "then:", "— and then:".
 *
 * The coach writes it to mean EAT X, THEN EAT Y: a drink-led slot ("digestive
 * shot — then: the meal"), or a warm-banana ritual before dinner. It is a
 * genuine component boundary, and the connective itself belongs to NEITHER
 * side.
 *
 * That last clause is the bug this fixes. The separator list used to carry a
 * bare ":", which cut "… pre-meal shot (small cup) — then: Ridge gourd sabzi"
 * at the colon and welded the orphaned "— then" onto the drink. The fragment
 * "lime juice (1 tsp) pre-meal shot (small cup) — then" then WON the slot (it
 * names a food, so it passed namesADish) and became the lunch title on 14 of
 * Nidhi's days. Matching the whole phrase — dash, connective and colon as one
 * separator — is the general rule: a separator is consumed entirely or not at
 * all, never half of it.
 *
 * Deliberately punctuated: a dash before "then", or a colon after it. A bare
 * narrative "then" inside a component ("soak, then rinse") is not a boundary.
 */
const SEQ_THEN = String.raw`[—–-]\s*(?:and\s+)?then\b\s*:?|\bthen\s*:`;

/** Component separators as they appear in real menus. " + " is universal; the
 *  arrows show up on multi-component dinners ("Green moong sabzi ⇒ masoor dal
 *  ⇒ sama millet"). The sequence connective is matched FIRST so the bare ":"
 *  alternative can never claim half of it. */
const SEP_ALL = new RegExp(String.raw`${SEQ_THEN}|\s\+\s|→|⇒|:`, "y");
/** Display split — " + " plus the sequence connective. A bare arrow or colon
 *  is part of how a coach writes a single dish's narrative and must not
 *  fragment the label she typed, but "X — then: Y" is two things the client
 *  eats and belongs in two pills. */
const SEP_PLUS = new RegExp(String.raw`${SEQ_THEN}|\s\+\s`, "y");
/** Stage boundary only — splits a sequenced dish into "before" and "after". */
const SEP_SEQ = new RegExp(SEQ_THEN, "y");

/**
 * Split on `sep`, but ONLY at bracket depth 0, so a separator inside a portion
 * or ingredient annotation is left alone. This is the fix for the shredded
 * primary component: "(1 glass water + 1 tsp sabja seeds soaked)" is one
 * parenthetical, not two components.
 */
function splitTopLevel(s: string, sep: RegExp, max = Infinity): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length && parts.length < max; i++) {
    const c = s[i];
    if (c === "(" || c === "[") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]") {
      // clamp: coach text sometimes carries a stray closer, and going negative
      // would make every later separator invisible.
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    sep.lastIndex = i;
    const m = sep.exec(s);
    if (m) {
      parts.push(s.slice(start, i));
      i += m[0].length - 1;
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The raw component strings of a dish, in menu order, for RECIPE MATCHING
 *  (splits on " + ", "→", "⇒", ":"). A dash-plus-gloss yields the head alone:
 *  the dish IS "ABC juice", and matching on the ingredient list behind it is
 *  how a juice ends up opening someone else's recipe. */
export function splitDishParts(dish: string): string[] {
  const head = glossHead(dish);
  if (head) return [head];
  return splitTopLevel(dish ?? "", SEP_ALL);
}

/** The dish's components as the client reads them — VERBATIM, portions still
 *  attached ("Masala Roasted Chana (2 tbsp)"). The meal overlay lists these,
 *  so the portion must survive; only the bracket-aware boundary changes.
 *  A gloss is one pill, and it keeps the WHOLE cell: that ingredient list is
 *  the only method the client has for a drink with no recipe, so removing the
 *  false boundaries must not remove the ingredients with them. */
export function splitDishPills(dish: string): string[] {
  if (glossHead(dish)) return [(dish ?? "").trim()];
  return splitTopLevel(dish ?? "", SEP_PLUS);
}

/** The stages of a sequenced dish: "shot (1 cup) — then: khichdi (1 bowl)" is
 *  two. Almost every dish is a single stage. */
export function splitDishStages(dish: string): string[] {
  return splitTopLevel(dish ?? "", SEP_SEQ);
}

/** Break a composite dish ("Ragi dosa (2) + chutney (2 tbsp)") into clean
 *  components for DISPLAY, lifting each portion-shaped "(…)" out of the title
 *  wherever it sits — trailing ("dosa (2)"), leading ("(2) eggs"), or
 *  standalone ("(1) amla") — and dropping accidental doubles ("(1 cup)
 *  (1 bowl)" keeps the first). Tolerant by design: the generators and coach
 *  edits place portions inconsistently, so the DISPLAY is where they get
 *  normalised. */
export function splitDishComponents(dish: string): DishComponent[] {
  // A gloss is ONE component and its title is the head — the grid shows
  // "ABC juice", not "ABC juice — apple" with the rest of the drink beside it
  // as if they were separate foods.
  const head = glossHead(dish);
  if (head) return [toComponent(head)];
  return splitTopLevel(dish ?? "", SEP_PLUS).map(toComponent);
}

function toComponent(comp: string): DishComponent {
  const portions: string[] = [];
  const title = comp
    .replace(DISH_PORTION_RE, (_m, p) => {
      const v = String(p).trim();
      if (v) portions.push(v);
      return " ";
    })
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  return { title: title || comp, portion: portions[0] || undefined };
}

/**
 * Words that can never, on their own, make a component a dish: seasonings,
 * fats, plain liquids, preparation adjectives and household units.
 *
 * Deliberately NARROWER than DISH_GENERIC. DISH_GENERIC also drops dish-TYPE
 * nouns (dosa, dal, roti, khichdi, salad, kachumber…) because for the
 * consistency gate the question is "what distinctive FOOD is this named
 * after". Using that same list to ask "is this a dish at all" is a category
 * error, and a costly one: "Dosa (2)" and "Kachumber salad (1 bowl)" would
 * read as garnishes and hand their slot to the sambar / dal behind them.
 */
const NON_DISH_WORDS = new Set([
  // seasonings, aromatics, fats, plain liquids
  "ginger","garlic","onion","tomato","jeera","cumin","salt","oil","ghee","butter",
  "coriander","cilantro","turmeric","haldi","pepper","chilli","chili","lemon",
  "lime","water","milk","spice","spices","masala","herb","herbs","herbal",
  // preparation / descriptive
  "spiced","roasted","steamed","boiled","fresh","plain","mixed","home","homemade",
  "light","warm","hot","cold","cooked","tempered","seasoned","simple","everyday",
  "style","healing","detox","cleansing","seasonal","soaked","ground","raw",
  // units, counts, connectives
  "with","and","the","for","cup","cups","glass","glasses","bowl","bowls","tbsp",
  "tsp","katori","piece","pieces","small","large","medium","serves","min","gram",
  "grams","slice","slices","handful","pinch","clove","cloves","inch",
]);

/**
 * Words that are a VEHICLE, not a food: they say what FORM something takes, and
 * need a real food noun beside them before the component names a dish.
 *
 * "lime" is already a non-dish word, so "lime juice (1 tsp)" hung entirely on
 * "juice" to qualify as a dish — and it did, which handed the slot to a pre-meal
 * shot. Reported 2026-07-28 (nidhi-jain): her lunch cells read "Garlic (1 clove
 * crushed) + ginger (½ tsp) + lime juice (1 tsp) + Ridge gourd sabzi (¾ cup) +
 * …". The tempering was skipped correctly, the lime shot was not, so the meal
 * showed no method and titled itself "Garlic (1 clove crushed)" on her phone.
 *
 * Kept to the smallest set that fixes it. "tea" and "water" are deliberately
 * absent: "Tea with milk (1 cup) + pumpkin seeds + dates" would then retitle
 * itself after the seeds, which is worse than what it says now. A real drink
 * always carries its own noun — "ABC juice", "Bottle gourd juice", "Amla juice"
 * — so those keep naming a dish.
 */
const VEHICLE_WORDS = new Set(["juice", "drink", "shot", "extract"]);

/** True when a component names something a client would expect a method for —
 *  i.e. something survives once seasonings, units and prep words are removed.
 *
 *  `strict` additionally discounts the vehicle words above. primaryDishPart runs
 *  a strict pass first and a lenient one after, so a component that is ONLY a
 *  vehicle can still title a slot when nothing else in the cell names a dish
 *  (a lone "lime juice (1 tsp)" is still that slot's best answer). */
function namesADish(part: string, strict = false): boolean {
  return recipeLibKey(part)
    .split(" ")
    .some(
      (t) => t.length >= 3 && !NON_DISH_WORDS.has(t) && !(strict && VEHICLE_WORDS.has(t)),
    );
}

/**
 * ── The gloss dash ──────────────────────────────────────────────────────────
 *
 * An em-dash introduces one of two completely different things, and punctuation
 * alone cannot tell them apart:
 *
 *   GLOSS      "ABC juice — apple (½ medium) + beetroot (¼ small) + carrot (1 small)"
 *              …the post-dash items are the drink's OWN INGREDIENTS. The " + "
 *              are not component boundaries; the whole cell is ONE dish.
 *   DESCRIPTOR "Paneer & spinach sabzi — well cooked (1 bowl) + rajgira roti (1)
 *              + moong dal soup (1 bowl)"
 *              …the dash qualifies the sabzi and the " + " are three real
 *              dinner dishes.
 *
 * Read as a descriptor, the gloss shreds: the slot titles itself "ABC juice —
 * apple (½ medium)" and the client is shown a drink named after one of its
 * ingredients. Read as a gloss, the descriptor case is catastrophic — three
 * dinner dishes collapse into one and two of them vanish off the plate. So the
 * question is decided by asking what the post-dash items ARE, not where the
 * punctuation sits, and every ambiguity resolves to "descriptor" (today's
 * behaviour).
 *
 * The signal is the ingredient table (dish-pantry.json, generated from
 * fm-database/data/_ingredient_nutrients.yaml by scripts/gen-dish-pantry.py):
 * "apple", "beetroot", "raw honey", "warm water" are pantry ingredients;
 * "rajgira roti" and "moong dal soup" are prepared dishes. A gloss lists only
 * the former.
 */

/**
 * Words that mark a fragment as something SERVED IN ITS OWN RIGHT on an Indian
 * plate. A component carrying one can never be read as a gloss ingredient,
 * whatever else it contains.
 *
 * This veto is why the pantry test can be trusted. The ingredient table's
 * aliases include "moong dal", "brown rice", "foxtail millet" and "mixed salad
 * vegetables", so on the pantry list alone a real side would read as a bare
 * ingredient and be swallowed into the dish in front of it. Kept SEPARATE from
 * DISH_GENERIC, which mixes these nouns with aromatics and prep words for a
 * different question entirely.
 *
 * Grains and paneer are here for that reason, not because they aren't
 * ingredients — they are, but they also arrive as their own katori. Over-
 * including only means a gloss goes unmerged (today's behaviour);
 * under-including deletes food off a client's plate.
 *
 * Deliberately absent: juice / drink / tea / milk / water. Those name pantry
 * ingredients as often as dishes ("lemon juice (1 tsp)" inside a gloss), and
 * vetoing them would block the very cases this exists to fix.
 */
const DISH_TYPE_WORDS = new Set([
  "roti","phulka","chapati","chapatti","bhakri","paratha","thepla","naan","puri","poori",
  "dal","daal","sabzi","sabji","sabzee","curry","gravy","soup","shorba","stew","rasam",
  "sambar","kadhi","kadi","kootu","poriyal","thoran","bharta","bhurji","scramble",
  "omelette","omelet","shakshuka","salad","kachumber","raita","chutney","pickle","achar",
  "rice","pulao","pulav","biryani","khichdi","khichri","kitchari","risotto",
  "dosa","idli","uttapam","upma","poha","chilla","cheela","muthia","dhokla","paniyaram",
  "tikka","kebab","bhaji","bhajji","wrap","toast","sandwich","burger","medley",
  "halwa","kheer","porridge","pancake","smoothie","lassi","chaas","buttermilk",
  "millet","quinoa","pasta","noodles","cutlet","paneer",
]);

/**
 * Preparation and serving words a coach writes between the foods in a gloss —
 * "carrot (half medium) BLENDED with water", "ginger (½ inch) — FRESHLY
 * PRESSED, SERVED IMMEDIATELY". Without them those fragments carry a word the
 * pantry can't account for and the gloss goes unrecognised.
 *
 * This list is exactly the words the live menus need, and nothing else. Every
 * speculative addition ("chopped", "sliced", "optional", …) was tried and
 * dropped: each one widens the rule for a case no plan has ever written, and an
 * unrecognised word is precisely what stops "steamed FRENCH beans" and "BRAZIL
 * nuts" being swallowed as gloss items. The bar for adding one is a real menu
 * that needs it — plus the corpus diff to prove nothing else moves.
 * (NON_DISH_WORDS already supplies the seasonings, units and connectives.)
 */
const PREP_WORDS = new Set(["blended", "pressed", "freshly", "served", "immediately"]);

/** Pantry ingredient names, for longest-phrase matching. */
const PANTRY = new Set<string>(PANTRY_PHRASES);
const PANTRY_MAX_WORDS = Math.max(...PANTRY_PHRASES.map((p) => p.split(" ").length));

/**
 * True when a fragment is nothing but pantry ingredients — every word is either
 * part of an ingredient name, a preparation word or a unit, and at least one
 * real ingredient is named.
 *
 * The "every word must be accounted for" rule is what makes this safe. A single
 * unrecognised word ("steamed FRENCH beans", "BRAZIL nuts", "AGNI-reset light
 * dinner", "SOFT Medjool dates") is enough to refuse — so an unfamiliar side
 * dish is never mistaken for an ingredient of the dish in front of it.
 */
function isBareIngredient(part: string): boolean {
  const toks = recipeLibKey(part)
    .split(" ")
    // <3 chars is "of" / "in" / "or" / a stray unit letter; the pantry phrases
    // are built with the same filter, so dropping them here keeps both sides
    // aligned ("juice of half lemon" ⇄ "juice half lemon").
    .filter((t) => t.length >= 3);
  if (toks.some((t) => DISH_TYPE_WORDS.has(t))) return false;
  let foods = 0;
  for (let i = 0; i < toks.length; ) {
    let span = 0;
    for (let n = Math.min(PANTRY_MAX_WORDS, toks.length - i); n >= 1; n--)
      if (PANTRY.has(toks.slice(i, i + n).join(" "))) {
        span = n;
        break;
      }
    if (span) {
      foods++;
      i += span;
      continue;
    }
    if (NON_DISH_WORDS.has(toks[i]) || PREP_WORDS.has(toks[i])) {
      i++;
      continue;
    }
    return false;
  }
  return foods > 0;
}

/** A spaced dash — the only shape that can introduce a gloss. Unspaced hyphens
 *  are word-internal ("Dates-in-ghee", "skin-off", "3–4 nuts"). */
const GLOSS_DASH = /\s[—–-]\s/y;

/**
 * The pre-dash head when `dish` is a dash-plus-gloss, else null.
 *
 * Every clause is a refusal, and each one exists to protect a real menu:
 *  - a sequenced dish ("… — then: …") already owns its dash;
 *  - a head that is itself several components ("Banana (…) + ghee (…) + …
 *    — served warm") is a list, not a dish being glossed;
 *  - with nothing to split after the dash there is no boundary at stake, so
 *    changing the reading could only move recipe matching for no gain;
 *  - and one post-dash item that isn't a bare ingredient means the dash was a
 *    descriptor and the " + " after it are real dishes.
 */
function glossHead(dish: string): string | null {
  const s = dish ?? "";
  if (splitTopLevel(s, SEP_SEQ).length > 1) return null;
  const [head, tail] = splitTopLevel(s, GLOSS_DASH, 1);
  if (!tail || splitTopLevel(head, SEP_PLUS).length > 1) return null;
  const items = splitTopLevel(tail, SEP_PLUS);
  if (items.length < 2) return null;
  return items.every(isBareIngredient) ? head : null;
}

/**
 * The component that gives the dish its identity — the first one that names a
 * dish rather than a seasoning. A tempering listed ahead of the meal ("Garlic
 * (1 clove crushed) + ginger (½ inch) + … Pointed gourd sabzi") is skipped,
 * because a drafter putting the tadka first doesn't make garlic the meal.
 * Everything AFTER the primary is a side and never supplies the slot's recipe.
 *
 * A sequence connective is read the same way, and it is the stronger signal:
 * "digestive shot (small cup) — then: Ridge gourd sabzi (¾ cup) + …" says in
 * so many words that the shot is a preamble and the meal is what follows. So
 * the LAST stage that names a dish wins — a pre-meal ritual can no more claim
 * the slot's recipe than a tadka can.
 *
 * Falls back to the first component when nothing names a dish (e.g. "ghee +
 * jeera water") — no better answer exists, and it preserves the old behaviour
 * for those slots.
 */
export function primaryDishPart(dish: string): string {
  const stages = splitDishStages(dish);
  // STRICT first, then lenient. A pre-meal shot written inline — no connective
  // to mark it as a preamble — used to win the slot ahead of the meal behind it
  // because "lime juice" reads as a food. Discounting the vehicle words finds
  // the sabzi; the lenient pass then keeps the old answer for any cell where
  // the vehicle really is all there is.
  for (const strict of [true, false]) {
    for (let i = stages.length - 1; i >= 0; i--) {
      const hit = splitDishParts(stages[i]).find((p) => namesADish(p, strict));
      if (hit) return hit;
    }
  }
  const parts = splitDishParts(dish);
  if (!parts.length) return (dish ?? "").trim();
  return parts[0];
}

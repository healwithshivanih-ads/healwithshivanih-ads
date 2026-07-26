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
 * Pure (no fs / no server-only) so both the server assembly and the tests can
 * share it, and so the six call sites that used to hand-roll the split can't
 * drift apart again.
 */

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

export const recipeLibToks = (s: string) =>
  recipeLibKey(s).split(" ").filter((t) => t.length > 3 && !RECIPE_LIB_STOP.has(t));

// Words that are dish-types / preparations / aromatics / units — NOT the
// distinctive "headline" food a dish is named after. Dropped before comparing.
export const DISH_GENERIC = new Set([
  "curry","sabzi","sabji","sabzee","dal","daal","masala","fry","stir","gravy",
  "soup","shorba","salad","chutney","raita","kachumber","roti","phulka","chapati",
  "bhakri","rice","pulao","pulav","biryani","khichdi","kitchari","chilla","cheela",
  "dosa","idli","upma","poha","paratha","thepla","bhurji","scramble","stew",
  "poriyal","kootu","kadhi","kadi","tikka","bhaji","bhajji","wrap","bowl","toast",
  "spiced","roasted","steamed","boiled","fresh","plain","mixed","home","homemade",
  "light","warm","cooked","tempered","seasoned","simple","everyday","style",
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

/** Component separators as they appear in real menus. " + " is universal; the
 *  arrows and colon show up on multi-component dinners ("Green moong sabzi ⇒
 *  masoor dal ⇒ sama millet") and on "… — then: <meal>" drink-led slots. */
const SEP_ALL = /\s\+\s|→|⇒|:/y;
/** Display split — " + " only. Arrows/colons are part of how a coach writes a
 *  single dish's narrative, so they must not fragment the label she typed. */
const SEP_PLUS = /\s\+\s/y;

/**
 * Split on `sep`, but ONLY at bracket depth 0, so a separator inside a portion
 * or ingredient annotation is left alone. This is the fix for the shredded
 * primary component: "(1 glass water + 1 tsp sabja seeds soaked)" is one
 * parenthetical, not two components.
 */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
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
 *  (splits on " + ", "→", "⇒", ":"). */
export function splitDishParts(dish: string): string[] {
  return splitTopLevel(dish ?? "", SEP_ALL);
}

/** The dish's components as the client reads them — VERBATIM, portions still
 *  attached ("Masala Roasted Chana (2 tbsp)"). The meal overlay lists these,
 *  so the portion must survive; only the bracket-aware boundary changes. */
export function splitDishPills(dish: string): string[] {
  return splitTopLevel(dish ?? "", SEP_PLUS);
}

/** Break a composite dish ("Ragi dosa (2) + chutney (2 tbsp)") into clean
 *  components for DISPLAY, lifting each portion-shaped "(…)" out of the title
 *  wherever it sits — trailing ("dosa (2)"), leading ("(2) eggs"), or
 *  standalone ("(1) amla") — and dropping accidental doubles ("(1 cup)
 *  (1 bowl)" keeps the first). Tolerant by design: the generators and coach
 *  edits place portions inconsistently, so the DISPLAY is where they get
 *  normalised. */
export function splitDishComponents(dish: string): DishComponent[] {
  return splitTopLevel(dish ?? "", SEP_PLUS).map((comp) => {
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
  });
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

/** True when a component names something a client would expect a method for —
 *  i.e. something survives once seasonings, units and prep words are removed. */
function namesADish(part: string): boolean {
  return recipeLibKey(part)
    .split(" ")
    .some((t) => t.length >= 3 && !NON_DISH_WORDS.has(t));
}

/**
 * The component that gives the dish its identity — the first one that names a
 * dish rather than a seasoning. A tempering listed ahead of the meal ("Garlic
 * (1 clove crushed) + ginger (½ inch) + … Pointed gourd sabzi") is skipped,
 * because a drafter putting the tadka first doesn't make garlic the meal.
 * Everything AFTER the primary is a side and never supplies the slot's recipe.
 *
 * Falls back to the first component when nothing names a dish (e.g. "ghee +
 * jeera water") — no better answer exists, and it preserves the old behaviour
 * for those slots.
 */
export function primaryDishPart(dish: string): string {
  const parts = splitDishParts(dish);
  if (!parts.length) return (dish ?? "").trim();
  return parts.find(namesADish) ?? parts[0];
}

/**
 * Food diary — what the CLIENT sees about their plates (docs/FOOD_DIARY_PLAN.md §5b).
 *
 * Coach decision 2026-10-23: clients should see when protein is too little and
 * carbs too much — as PLATE BALANCE, never grams. A photo can judge
 * proportions ("half the plate is rice, no dal"); it cannot judge grams (a
 * photo protein estimate is 30–50% off and dish coverage is ~55%). So the AI
 * reading carries three words per plate and this module turns them into:
 *
 *   - per-meal marks: protein present / light / none, veg the same, and a soft
 *     "carb-heavy" tag;
 *   - at the end, ONE strength and ONE fix, in food words from THIS client's
 *     own diet — the swap list is filtered by diet, allergies, foods to avoid
 *     and the dairy resolver, so a gluten-free client is never told "a roti"
 *     and a no-paneer client never "paneer".
 *
 * Tone is observation, never verdict: "leaned on", "light on", "had protein".
 * The words "bad", "too much", "failed", "should" never appear — a test greps.
 *
 * Gentle mode (anxious / on benzodiazepines or SSRIs / eating-disorder risk):
 * protein dots and the tip only — no carb-heavy tags, and the fix speaks of
 * adding protein, never of what the plate leaned on.
 *
 * Pure: no node imports. Runs on Fly when the app renders.
 */

import { resolveDairy, treatsAsAllergy, type DairyClient } from "./dairy-reaction";

export type ProteinMark = "present" | "light" | "none";
export type VegMark = "present" | "light" | "none";
export type CarbMark = "balanced" | "heavy";

export interface PlateBalance {
  protein: ProteinMark;
  /** Absent when the reader gave no valid word for it. */
  veg?: VegMark;
  carbs?: CarbMark;
}

const PROTEIN: readonly string[] = ["present", "light", "none"];
const CARBS: readonly string[] = ["balanced", "heavy"];

/** Accept only the known words per axis. Protein is required; veg and carbs
 *  are kept only when valid. Anything else → null. */
export function parseBalance(raw: unknown): PlateBalance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!PROTEIN.includes(String(r.protein))) return null;
  const out: PlateBalance = { protein: r.protein as ProteinMark };
  if (PROTEIN.includes(String(r.veg))) out.veg = r.veg as VegMark;
  if (CARBS.includes(String(r.carbs))) out.carbs = r.carbs as CarbMark;
  return out;
}

// ── who gets the gentle version ──────────────────────────────────────────────

const GENTLE_TERMS = [
  // anxiety
  "anxiety", "anxious", "panic", "health anxiety",
  // eating-disorder risk
  "eating disorder", "anorexi", "bulimi", "binge eating", "orthorexi", "arfid", "disordered eating",
  // SSRIs / SNRIs / benzodiazepines — generic names first, brands common in India
  "ssri", "snri", "benzo", "sertraline", "escitalopram", "citalopram", "fluoxetine", "paroxetine",
  "fluvoxamine", "venlafaxine", "duloxetine", "desvenlafaxine", "alprazolam", "clonazepam",
  "lorazepam", "diazepam", "etizolam", "nitrazepam", "chlordiazepoxide",
  "nexito", "stalopam", "rivotril", "restyl", "zapiz", "etilaam", "trika", "petril", "dulane",
];

function flatText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flatText).join(" ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(flatText).join(" ");
  return String(v);
}

/** Should this client see the gentler diary (protein dots + tip only, never
 *  grams)? Same signals the brief and letters already treat as "anxious". */
export function diaryGentle(client: Record<string, unknown> | null | undefined): boolean {
  if (!client) return false;
  const text = [
    client.active_conditions,
    client.medical_history,
    client.current_medications,
    client.medications,
    client.goals,
  ]
    .map(flatText)
    .join(" ")
    .toLowerCase();
  return GENTLE_TERMS.some((t) => text.includes(t));
}

// ── swaps, filtered by what this client can eat ─────────────────────────────

type Tag = "dairy" | "egg" | "nonveg" | "soy" | "legume" | "gluten" | "nuts" | "root";
interface Swap {
  text: string;
  bands: ("morning" | "midday" | "evening")[];
  tags: Tag[];
  /** Words that, if they appear in what the client avoids, rule this out. */
  words: string[];
}

const SWAPS: Swap[] = [
  { text: "a moong dal chilla", bands: ["morning", "evening"], tags: ["legume"], words: ["moong", "chilla"] },
  { text: "a besan chilla", bands: ["morning", "evening"], tags: ["legume"], words: ["besan", "chickpea", "gram flour"] },
  { text: "a bowl of curd", bands: ["morning", "midday", "evening"], tags: ["dairy"], words: ["curd", "yogurt", "yoghurt", "dahi"] },
  { text: "paneer bhurji", bands: ["morning", "evening"], tags: ["dairy"], words: ["paneer"] },
  { text: "two boiled eggs", bands: ["morning"], tags: ["egg"], words: ["egg"] },
  { text: "a bowl of sprouts chaat", bands: ["morning", "evening"], tags: ["legume"], words: ["sprout", "moong"] },
  { text: "a handful of roasted chana", bands: ["morning", "evening"], tags: ["legume"], words: ["chana", "chickpea"] },
  { text: "a tofu scramble", bands: ["morning"], tags: ["soy"], words: ["tofu", "soy"] },
  { text: "a katori of dal", bands: ["midday", "evening"], tags: ["legume"], words: ["dal", "lentil"] },
  { text: "rajma or chole", bands: ["midday"], tags: ["legume"], words: ["rajma", "chole", "chickpea", "kidney bean"] },
  { text: "a bowl of raita", bands: ["midday", "evening"], tags: ["dairy"], words: ["raita", "curd", "yogurt", "dahi"] },
  { text: "a piece of grilled chicken or fish", bands: ["midday", "evening"], tags: ["nonveg"], words: ["chicken", "fish"] },
  { text: "an egg bhurji", bands: ["evening"], tags: ["egg"], words: ["egg"] },
];

/** Diet words → tags it rules out. Never substring on "vegetarian": it is
 *  contained in "non-vegetarian" (shipped once already, see meal-check.ts). */
function dietExcludes(raw: unknown): Set<Tag> {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.startsWith("non veg") || s.startsWith("nonveg")) return new Set();
  if (s.startsWith("pesc")) return new Set();
  if (s.startsWith("egg") || s.startsWith("ovo")) return new Set<Tag>(["nonveg"]);
  if (s.startsWith("vegan")) return new Set<Tag>(["nonveg", "egg", "dairy"]);
  if (s.includes("jain")) return new Set<Tag>(["nonveg", "egg", "root"]);
  // vegetarian, and an UNKNOWN diet: the safe reading is vegetarian.
  return new Set<Tag>(["nonveg", "egg"]);
}

export type DietContext = DairyClient & {
  dietary_preference?: unknown;
  known_allergies?: unknown;
  foods_to_avoid?: unknown;
  reported_triggers?: unknown;
  non_negotiables?: unknown;
};

/** The swaps this client may be offered, in the table's order. */
export function allowedSwaps(client: DietContext | null | undefined, band: "morning" | "midday" | "evening"): string[] {
  const c = client ?? {};
  const excluded = dietExcludes(c.dietary_preference);
  if (treatsAsAllergy(resolveDairy(c))) excluded.add("dairy");
  const avoid = [c.known_allergies, c.foods_to_avoid, c.reported_triggers].map(flatText).join(" ").toLowerCase();
  if (/\bsoy|\btofu/.test(avoid)) excluded.add("soy");
  if (/\begg/.test(avoid)) excluded.add("egg");
  if (/\b(dairy|milk protein|casein)\b/.test(avoid)) excluded.add("dairy");
  if (/\b(legume|pulse|lentil)s?\b/.test(avoid)) excluded.add("legume");
  return SWAPS.filter(
    (s) =>
      s.bands.includes(band) &&
      !s.tags.some((t) => excluded.has(t)) &&
      !s.words.some((w) => avoid.includes(w)),
  ).map((s) => s.text);
}

// ── the AI's protein idea, checked before a client sees it ──────────────────

const TAG_WORDS: Record<Tag, string[]> = {
  nonveg: [
    "chicken", "fish", "mutton", "lamb", "prawn", "shrimp", "meat", "keema", "pork", "beef", "bacon",
    "ham", "turkey", "tuna", "salmon", "sardine", "crab", "seafood", "anchov", "sausage", "salami",
  ],
  egg: ["egg", "omelet", "anda"],
  dairy: [
    "paneer", "curd", "yogurt", "yoghurt", "cheese", "milk", "dahi", "raita", "whey", "ricotta",
    "cottage", "cream", "kefir", "labneh", "feta", "lassi", "chaas", "buttermilk", "mozzarella", "parmesan",
  ],
  soy: ["tofu", "soy", "soya", "edamame", "tempeh"],
  legume: ["dal", "lentil", "chickpea", "chana", "rajma", "bean", "moong", "besan", "hummus", "sprout"],
  gluten: ["wheat", "seitan", "bread", "roti", "chapati", "couscous", "bulgur", "pasta"],
  nuts: ["almond", "cashew", "walnut", "peanut", "pistachio", "nut"],
  root: ["potato", "onion", "garlic", "carrot", "beet", "radish", "ginger"],
};

const STOP = new Set(["with", "and", "only", "free", "avoid", "none", "food", "foods", "less", "more", "very", "from"]);

/**
 * May this client be shown this idea? A HARD filter, applied on render: the
 * model was told the diet, allergies and avoid list, but its word is not what
 * keeps meat off a vegetarian's screen. Rejects anything naming a food her
 * diet / dairy reaction / allergies / avoid list rule out.
 */
export function ideaAllowed(idea: string | undefined | null, client: DietContext | null | undefined): boolean {
  const text = String(idea ?? "").toLowerCase().trim();
  if (!text || text.length > 100) return false;
  const c = client ?? {};
  const excluded = dietExcludes(c.dietary_preference);
  if (treatsAsAllergy(resolveDairy(c))) excluded.add("dairy");
  const avoid = [c.known_allergies, c.foods_to_avoid, c.reported_triggers].map(flatText).join(" ").toLowerCase();
  if (/\b(soy|soya|tofu)/.test(avoid)) excluded.add("soy");
  if (/\begg/.test(avoid)) excluded.add("egg");
  if (/\b(dairy|milk protein|casein)\b/.test(avoid)) excluded.add("dairy");
  if (/\b(legume|pulse|lentil)s?\b/.test(avoid)) excluded.add("legume");
  if (/\b(gluten|wheat)\b/.test(avoid)) excluded.add("gluten");
  if (/\b(nut|nuts|peanut|almond|cashew)\b/.test(avoid)) excluded.add("nuts");
  for (const tag of excluded) if (TAG_WORDS[tag].some((w) => text.includes(w))) return false;
  const tokens = avoid.split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOP.has(t));
  return !tokens.some((t) => text.includes(t));
}

// ── the end-of-diary strength + fix ─────────────────────────────────────────

/** Meals the tip talks about. Early-morning drinks and late-night snacks are
 *  never the fix — a tea is not a meal that lacked protein. */
const MEAL_BANDS = ["morning", "midday", "evening"] as const;
type MealBand = (typeof MEAL_BANDS)[number];
const MEAL_NAME: Record<MealBand, string> = { morning: "Breakfast", midday: "Lunch", evening: "Dinner" };

export interface PlateForTip {
  band: string;
  /** The diary day — a one-day diary is not "most days". */
  date?: string;
  balance: PlateBalance;
  /** Dish names, for "leaned on poha". Coach correction first if any. */
  dishes: string[];
  /** The reader's protein addition for this plate, if any (unfiltered). */
  idea?: string;
}

export interface DiaryTip {
  strength: string;
  fix: string | null;
}

const CARB_WORDS = [
  "poha", "upma", "rice", "roti", "chapati", "paratha", "bread", "toast", "biscuit", "cookie", "noodle",
  "pasta", "idli", "dosa", "puri", "khichdi", "sandwich", "cereal", "cornflakes", "thepla", "sabudana",
];

function carbDish(plates: PlateForTip[]): string | null {
  const counts = new Map<string, number>();
  for (const p of plates) {
    for (const d of p.dishes) {
      const low = d.toLowerCase();
      const w = CARB_WORDS.find((c) => low.includes(c));
      if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let n = 0;
  for (const [w, c] of counts) if (c > n) [best, n] = [w, c];
  return best;
}

function orList(items: string[]): string {
  return items.length === 1 ? items[0] : `${items[0]} or ${items[1]}`;
}

/**
 * One strength, at most one fix. Needs at least two readable meal plates.
 *
 * The fix goes to the meal most often light on protein (≥ half its plates).
 * With no allowed swap for that meal (every option ruled out by her diet or
 * avoid list) the fix is dropped rather than offering something she cannot eat.
 */
export function diaryTip(
  plates: PlateForTip[],
  client: DietContext | null | undefined,
  opts: { gentle: boolean },
): DiaryTip | null {
  const meals = plates.filter((p) => (MEAL_BANDS as readonly string[]).includes(p.band));
  if (meals.length < 2) return null;

  const byBand = MEAL_BANDS.map((band) => {
    const ps = meals.filter((p) => p.band === band);
    const withProtein = ps.filter((p) => p.balance.protein === "present").length;
    const balanced = ps.filter(
      (p) => p.balance.protein === "present" && !!p.balance.veg && p.balance.veg !== "none" && p.balance.carbs === "balanced",
    ).length;
    return { band, ps, share: ps.length ? withProtein / ps.length : 0, balancedShare: ps.length ? balanced / ps.length : 0 };
  }).filter((b) => b.ps.length > 0);

  const multiDay = new Set(meals.map((p) => p.date ?? "")).size > 1;
  const most = multiDay ? " most days" : "";
  const often = multiDay ? "often " : "";
  const best = [...byBand].sort((a, b) => b.share - a.share || b.ps.length - a.ps.length)[0];
  let strength: string;
  if (best && best.share >= 0.67) {
    const name = MEAL_NAME[best.band];
    strength =
      !opts.gentle && best.balancedShare >= 0.67
        ? `${name} was well balanced${most}.`
        : `${name} had protein${most} — keep that going.`;
  } else {
    strength = "You photographed your meals through the diary — that's the hard part done.";
  }

  const weakest = [...byBand]
    .filter((b) => b.band !== best?.band || byBand.length === 1)
    .sort((a, b) => a.share - b.share || b.ps.length - a.ps.length)[0];
  let fix: string | null = null;
  if (weakest && weakest.share <= 0.5) {
    // The reader's own ideas for those plates first — they suit the actual
    // dish ("chickpeas tossed through" for spaghetti, never "dal"); the fixed
    // list is only the backstop. Every idea passes ideaAllowed.
    const fromPlates = [
      ...new Set(
        weakest.ps
          .filter((p) => p.balance.protein !== "present")
          .map((p) => (p.idea ?? "").trim())
          .filter((i) => ideaAllowed(i, client)),
      ),
    ];
    const swaps = (fromPlates.length ? fromPlates : allowedSwaps(client, weakest.band)).slice(0, 2);
    if (swaps.length) {
      const name = MEAL_NAME[weakest.band];
      const heavy = weakest.ps.filter((p) => p.balance.carbs === "heavy").length >= weakest.ps.length / 2;
      const leaned = heavy ? carbDish(weakest.ps) : null;
      fix =
        !opts.gentle && leaned
          ? `${name} ${often}leaned on ${leaned} with little protein. Try adding ${orList(swaps)}.`
          : `${name} was ${often}light on protein. Adding ${orList(swaps)} would help.`;
    }
  }
  return { strength, fix };
}

// ── one line per meal (coach decision 2026-10-23: "as the client I want some
//    feedback on my meals") ─────────────────────────────────────────────────

const SWAP_BAND: Record<string, "morning" | "midday" | "evening" | null> = {
  waking: null,
  morning: "morning",
  midday: "midday",
  evening: "evening",
  bedtime: null,
};

/**
 * One observational line about a meal, from its plate balance. Same rules as
 * the tip: food words, never numbers, never a verdict, and any swap comes from
 * allowedSwaps — so it is something this client can eat. Gentle (or balance
 * marks off): protein only, never carbs. Early-morning drinks and late-night
 * items get no line — "no protein" under a cup of tea is not useful.
 */
export function mealFeedback(
  balance: PlateBalance,
  band: string,
  client: DietContext | null | undefined,
  opts: { gentle: boolean; idea?: string | null },
): string | null {
  if (!SWAP_BAND[band]) return null;
  // ONLY the reader's idea for this dish — a fixed list cannot know that
  // nobody adds dal to spaghetti (coach, 2026-10-23). No safe idea → a plain
  // "some protein", never a mismatched dish.
  const idea = opts.idea && ideaAllowed(opts.idea, client) ? opts.idea.trim().replace(/\.$/, "") : null;
  const { protein, veg, carbs } = balance;

  if (opts.gentle) {
    if (protein === "present") return "Protein ✓ — nice.";
    return idea ? `Next time, try adding ${idea} for some protein.` : "Next time, adding some protein would help.";
  }
  if (protein === "present") {
    if (carbs === "heavy") return "Good protein. The plate leans on carbs — a little more veg would even it out.";
    if (veg === "none" || veg === "light") return "Good protein here. Some veg or a salad on the side would round it out.";
    return "Well balanced — protein, veg and carbs all there.";
  }
  const add = idea ? `Try adding ${idea}.` : "Adding some protein would help.";
  if (protein === "light") return `A little protein here. ${add}`;
  if (carbs === "heavy") return `Mostly carbs on this plate. ${add}`;
  return `No protein on this plate. ${add}`;
}

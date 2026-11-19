/**
 * THE EATING-OUT GUIDE, as the client app reads it.
 *
 * A plan carries `eating_out`: one guide for the whole plan, or one per
 * section of it (a 5R protocol's Remove weeks, then its Repair weeks). The
 * coach writes it with the plan; plan-check (fmdb/plan/checker.py
 * `_check_eating_out`) refuses a plan without one and screens every line
 * against the client's diet and dairy status.
 *
 * This file only chooses WHICH guide applies this week and WHICH card answers
 * a question. It never writes a line of its own: everything the client reads
 * is the coach's text, as written.
 */

export interface AppEatingOutSituation {
  /** the card's heading: "At a restaurant" */
  where: string;
  keywords: string[];
  choose: string[];
  skip: string[];
  note: string;
}

export interface AppEatingOut {
  /** the section of the plan it is for ("Remove phase"); "" for the whole plan */
  label: string;
  rules: string[];
  situations: AppEatingOutSituation[];
  /** what to do about a food the plan does not mention; "" when the coach gave none */
  notOnList: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/**
 * The guide for this plan week, or null when the plan has none.
 *
 * A guide whose weeks hold the current week wins; otherwise the whole-plan
 * guide (no weeks set). When several sections overlap, the first listed wins,
 * which is what plan-check tells the coach. A week no guide covers gets null:
 * the app then hands eating-out questions to the coach rather than showing a
 * guide written for a different phase.
 */
export function pickEatingOutGuide(raw: unknown, week: number): AppEatingOut | null {
  if (!Array.isArray(raw)) return null;
  let whole: Record<string, unknown> | null = null;
  let hit: Record<string, unknown> | null = null;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const from = int(g.from_week);
    const to = int(g.to_week);
    if (from === null && to === null) {
      whole ??= g;
    } else if (!hit && week >= (from ?? 1) && week <= (to ?? Number.MAX_SAFE_INTEGER)) {
      hit = g;
    }
  }
  const g = hit ?? whole;
  if (!g) return null;
  const situations: AppEatingOutSituation[] = (Array.isArray(g.situations) ? g.situations : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({ where: str(s.where), keywords: strs(s.keywords).map((k) => k.toLowerCase()), choose: strs(s.choose), skip: strs(s.skip), note: str(s.note) }))
    .filter((s) => s.where && s.choose.length > 0);
  const guide: AppEatingOut = { label: str(g.label), rules: strs(g.rules), situations, notOnList: str(g.not_on_list) };
  // A guide with nothing a client could act on is the same as no guide.
  return guide.situations.length === 0 && guide.rules.length === 0 ? null : guide;
}

/**
 * Words the app already knows for the common places, matched against a
 * situation's own heading — so "At a hotel buffet" answers "hotel breakfast"
 * without the coach listing keywords. A situation's own `keywords` are tried
 * first: they are the more particular ("italian", "pizza").
 */
const KINDS: [inHeading: RegExp, inQuestion: RegExp][] = [
  // A wedding buffet is a wedding, so the celebration is tried before the buffet.
  [/wedding|party|celebrat|function|festival|guest/, /wedding|shaadi|party|function|celebrat|festival|birthday|reception/],
  [/buffet|hotel/, /buffet|hotel/],
  [/airport|station|train|flight|road|travel|journey/, /airport|lounge|station|\btrain\b|flight|flying|road trip|on the road|travel|\btrip\b|journey|out of (town|station)/],
  [/order|deliver|takeaway|take.?away/, /order(ing)? in|deliver|takeaway|take.?away|swiggy|zomato/],
  [/office|work|canteen/, /office|canteen|at work|work lunch/],
  // cuisines
  [/north indian|punjabi|mughlai|tandoor/, /north indian|punjabi|mughlai|tandoor|dhaba/],
  [/south indian|udupi/, /south indian|udupi|dosa place|tiffin/],
  [/chinese|asian|thai/, /chinese|indo.?chinese|\bthai\b|\basian\b|japanese|korean/],
  [/italian|continental|pizza|pasta/, /italian|continental|pizzeria|pizza place/],
  [/cafe|café|fast food|burger|sandwich/, /\bcafe\b|café|coffee shop|fast food|mcdonald|subway|starbucks|burger place/],
  [/street|chaat/, /street food|chaat/],
  [/sweet|dessert|mithai/, /sweet shop|dessert|mithai/],
  [/drinks?\b|beverage|juice/, /what (can|do|should) i drink|something to drink|beverage/],
  [/restaurant|eating out|dinner out/, /restaurant|eating out|eat out|(dinner|lunch) out|(client|business|team) (dinner|lunch)|dhaba/],
];

/** The situation a question is about, or null when none of them fits. */
export function matchSituation(question: string, guide: AppEatingOut): AppEatingOutSituation | null {
  const q = question.toLowerCase();
  const word = (k: string) => new RegExp(`\\b${k.replace(/[^a-z0-9 ]/g, ".")}`).test(q);
  const own = guide.situations.find((s) => s.keywords.some((k) => k.length >= 3 && word(k)));
  if (own) return own;
  for (const [inHeading, inQuestion] of KINDS) {
    if (!inQuestion.test(q)) continue;
    const s = guide.situations.find((x) => inHeading.test(x.where.toLowerCase()));
    if (s) return s;
  }
  return null;
}

/** The situation to show when the question is about eating out but names no
 *  place the guide has: the restaurant card, else the first one. */
export function defaultSituation(guide: AppEatingOut): AppEatingOutSituation | null {
  return guide.situations.find((s) => /restaurant|eating out/i.test(s.where)) ?? guide.situations[0] ?? null;
}

// ── a named dish ───────────────────────────────────────────────────────────

/** Words that say nothing about which dish it is. */
const GENERIC = new Set(
  "the and for with some any can may could should would have has had eat eating order ordering get take try want like this that these those here there today tonight tomorrow now please what which about okay fine allowed alright instead only they them their place restaurant menu dish dishes food item items small little bit piece slice bowl plate cup glass portion vegetarian breakfast lunch dinner snack meal anything everything nothing else made kind kinds type other others all more less extra without home homemade just really very good bad healthy sure safe one two three four once twice still also maybe not yes its are was will does did you your mine kya hai main mai mujhe kha khana khau sakti sakta sakte lena chalega nahi".split(
    " ",
  ),
);

/** Words that describe a dish without saying what it is ("masala", "plain"). */
const QUALIFIER = new Set("masala curry gravy plain special style fresh hot cold veg vegetable vegetables mixed mix dry roasted steamed grilled".split(" "));

const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
const dishWords = (s: string): string[] => tokens(s).filter((w) => w.length >= 3 && !GENERIC.has(w));
const stem = (w: string): string => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const same = (a: string, b: string): boolean => stem(a) === stem(b);
/** Whole word, singular or plural: "dosa" finds "dosas", "rice" does not find "price". */
const lineHas = (line: string, w: string): boolean => tokens(line).some((t) => same(t, w));

/**
 * A guide line may carry the coach's reason after a spaced dash:
 *   "Idli, dosa and uttapam — they are made of rice"
 * Only the part before the dash names foods. The reason is shown to the
 * client but never matched, so a word in it cannot rule a dish in or out.
 */
export const lineLabel = (line: string): string => line.split(/\s[—–]\s/)[0];
/** What a choose line OFFERS: its label, minus anything it says to leave out.
 *  "Tea with milk, without sugar" offers tea and milk, not sugar. */
const offered = (line: string): string => lineLabel(line).replace(/\b(without|no|not|leave|leaving|minus|hold)\b[^,;()]*/gi, " ");
/** The foods a line lists, each as its words: "Naan, kulcha and puri" → three. */
const lineItems = (line: string): string[][] =>
  lineLabel(line)
    .split(/,|\(|\)|;| or | and /)
    .map(dishWords)
    .filter((w) => w.length > 0);

/** The dish a part of a question is about: the words after "eat", "have",
 *  "order"…, cut at a trailing place ("…at the temple"). */
function dishPhrase(part: string): string {
  // Hindi and Hinglish put the dish first: "aloo paratha kha sakti hu".
  const before = part.match(/^(.+?)\s+(?:kha|khau|khaun|khana|pi|piyu|chalega|chalegi|mil|le)\b/);
  if (before && dishWords(before[1]).length) return before[1];
  const after = part.match(/\b(?:eat|have|order|get|take|try)\b\s+(.+)$/);
  const asked = part.match(/^(?:is|are|what about|how about)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:ok|okay|fine|allowed|alright|safe|good)\b/);
  const phrase = asked?.[1] ?? after?.[1] ?? part;
  return phrase.split(/\s(?:at|in|from|on|for|when|if|because|since)\s/)[0];
}

export interface DishVerdict {
  /** depends: the bare word names both something to choose and something to skip */
  verdict: "choose" | "skip" | "depends";
  /** the dish as she named it */
  dish: string;
  /** the coach's own line that settles it, as written */
  line: string;
  /** the card it is on */
  where: string;
  /** skip: up to two things to have there instead; depends: the kind that is fine */
  instead: string[];
}

/**
 * What the guide says about each dish a question names, or [] when it does
 * not settle every one of them.
 *
 * Deliberately lopsided, because a wrong "yes" is the costly mistake:
 *   1. yes  — a dish of two or more words, ALL of them close together in one
 *             choose line ("jowar roti" in "…with jowar or bajra roti…").
 *             The most particular match, so it is tried first.
 *   2. skip — the dish contains EVERY word of a food a skip line lists:
 *             "butter naan" contains "naan"; "masala dosa" contains "dosa".
 *             "Filter coffee" does not contain "cold coffee", so a skip on
 *             cold coffee says nothing about it. The longest such food wins,
 *             so "egg fried rice" quotes the fried-rice line, not the rice one.
 *   3. yes  — a one-word dish that a choose line lists exactly ("omelette").
 * A bare word that a skip line lists AND a choose line also uses ("roti",
 * when jowar roti is fine) is "depends": both lines are shown.
 * Anything else is not settled: "chicken curry" is never a yes because
 * "egg curry" is.
 *
 * "X with Y" is judged as two dishes: "roti with my dal" must not be a yes
 * because one choose line happens to hold both words.
 *
 * If one of several dishes is not settled, the answer is [] and the question
 * goes to the model — a card that answers half a question reads as a yes to
 * the other half.
 */
export function dishesInGuide(question: string, guide: AppEatingOut): DishVerdict[] {
  const out: DishVerdict[] = [];
  const parts = question
    .toLowerCase()
    .split(/,|\.| and | or | with | aur | ya |\/|\?|\bwhich one\b/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const all = dishWords(dishPhrase(part));
    if (all.length === 0) continue; // "which one", "can I", "nothing else"
    const has = (w: string) => all.some((d) => same(d, w));
    let hit: DishVerdict | null = null;

    // 1. the whole dish, close together in one choose line
    if (all.length >= 2) {
      for (const s of guide.situations) {
        const line = s.choose.find((l) =>
          offered(l)
            .split(/,|\(|\)|;/)
            .some((seg) => {
              const t = tokens(seg);
              const at = all.map((w) => t.findIndex((x) => same(x, w)));
              return at.every((i) => i >= 0) && Math.max(...at) - Math.min(...at) <= all.length + 2;
            }),
        );
        if (line) {
          hit = { verdict: "choose", dish: all.join(" "), line, where: s.where, instead: [] };
          break;
        }
      }
    }

    // 2. a food a skip line lists, every word of which is in the dish
    if (!hit) {
      let best = 0;
      for (const s of guide.situations) {
        for (const line of s.skip) {
          for (const item of lineItems(line)) {
            if (item.length > best && item.every(has)) {
              best = item.length;
              hit = { verdict: "skip", dish: all.join(" "), line, where: s.where, instead: s.choose.slice(0, 2) };
            }
          }
        }
      }
      // A bare word that is also part of something to choose: it depends which.
      if (hit && all.length === 1) {
        for (const s of guide.situations) {
          const ok = s.choose.find((l) => lineHas(offered(l), all[0]));
          if (ok) {
            hit = { ...hit, verdict: "depends", instead: [ok] };
            break;
          }
        }
      }
    }

    // 3. a one-word dish a choose line lists exactly
    if (!hit && all.length === 1) {
      for (const s of guide.situations) {
        const line = s.choose.find((l) =>
          offered(l)
            .split(/,|\(|\)|;| or | and | with /)
            .some((item) => {
              const t = dishWords(item).filter((w) => !QUALIFIER.has(w));
              return t.length === 1 && same(t[0], all[0]);
            }),
        );
        if (line) {
          hit = { verdict: "choose", dish: all[0], line, where: s.where, instead: [] };
          break;
        }
      }
    }

    if (!hit) return [];
    out.push(hit);
  }
  return out;
}

/**
 * The part of the guide a question needs, for the model: the rules, the line
 * for a food the plan does not mention, and up to three cards that share a
 * word with the question (else the restaurant card). A full guide runs to a
 * dozen cards; sending all of it would triple the cost of every question.
 */
export function eatingOutContextFor(question: string, guide: AppEatingOut): string {
  const words = dishWords(question);
  const scored = guide.situations
    .map((s) => {
      const text = [s.where, ...s.keywords, ...s.choose, ...s.skip].join(" ");
      return { s, score: words.filter((w) => lineHas(text, w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);
  const place = matchSituation(question, guide);
  const picked = [...new Set([...(place ? [place] : []), ...scored])].slice(0, 3);
  const fallback = defaultSituation(guide);
  const situations = picked.length ? picked : fallback ? [fallback] : [];
  return eatingOutContext({ ...guide, situations });
}

/** The guide as plain lines for the model's context. */
export function eatingOutContext(guide: AppEatingOut): string {
  const lines: string[] = [];
  if (guide.rules.length) lines.push(`Rules anywhere: ${guide.rules.join("; ")}.`);
  for (const s of guide.situations) {
    lines.push(`${s.where} — choose: ${s.choose.join("; ")}.${s.skip.length ? ` Skip: ${s.skip.join("; ")}.` : ""}${s.note ? ` ${s.note}` : ""}`);
  }
  if (guide.notOnList) lines.push(`A food the plan does not mention: ${guide.notOnList}`);
  return lines.join(" ");
}

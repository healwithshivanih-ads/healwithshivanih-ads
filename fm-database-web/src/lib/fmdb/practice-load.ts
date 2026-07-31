/**
 * How much of a client's DAY a plan actually asks for.
 *
 * Counting practices is the wrong measure, and that is why nobody caught a
 * 14-practice plan: "hibiscus tea, 1–2 cups" and "abhyanga — warm sesame oil
 * self-massage" are one item each and twenty minutes apart in cost. The
 * expensive ones are those needing a DEDICATED STOPPED MOMENT — a slot carved
 * out of the day. The cheap ones ride a moment that already exists: a meal, a
 * cup of tea, getting into bed.
 *
 * Nobody has six spare stopped moments a day. Given six, a client does one and
 * feels bad about five — which is worse than having been given one, because
 * the failure attaches to the plan and then to the coaching.
 *
 * This is a HEURISTIC over free text and it will misjudge some entries, so it
 * never blocks anything and always shows its working: the coach sees which
 * practices were counted as dedicated and can disagree at a glance. Silent
 * arithmetic she cannot audit would be worse than no check.
 */

/** Things that need a slot carved out of the day. */
const DEDICATED = [
  /\bwalk(ing|s)?\b/i,
  /\byoga\b/i,
  /\b(strength|strengthening|exercise|workout|resistance|pilates)\b/i,
  /\b(breath(ing|work)?|pranayama|4-?7-?8|extended[- ]exhale)\b/i,
  /\b(eft|tapping)\b/i,
  /\bjournal(ling|ing)?\b/i,
  /\bgratitude\b/i,
  /\b(abhyanga|self[- ]massage|body[- ]?scan)\b/i,
  /\b(meditat|mindfulness|visualis|visualiz)/i,
  /\bsunlight|daylight|grounding\b/i,
  /\b(nervous[- ]system regulation|stress[- ]reduction|reset|ritual|routine|practice)\b/i,
  /\bstretch/i,
];

/** Things that ride a moment the client is already having. */
const ATTACHED = [
  /\b(tea|chai|coffee|kadha|kashayam|drink|water|juice|milk)\b/i,
  /\b(meal|meals|eat|eating|chew|food|dinner|lunch|breakfast|snack)\b/i,
  /\bfast(ing)?\b/i,
  /\b(bedtime|bed time|lights?|screens?|sleep schedule|sleep-wake|wind[- ]down)\b/i,
  /\b(spray|tape|taping|drops?|nasya|seeds?|salt|electrolyte|supplement)\b/i,
  /\b(swap|instead of|modification|sequencing|pairing|separation|front[- ]load)\b/i,
];

export type MomentCost = "dedicated" | "attached";

export interface ClassifiedPractice {
  name: string;
  cost: MomentCost;
  /** true when the app runs a guided session for it — always a stopped moment */
  guided: boolean;
}

/**
 * Does this practice need its own moment?
 *
 * A guided session always does — the app literally opens a full-screen player.
 * Otherwise the wording decides, and ATTACHED is checked FIRST: "10-minute
 * walk after every meal" contains both signals, and the meal is what makes it
 * cheap. It is bolted onto something already happening.
 *
 * Unmatched text defaults to `attached`, deliberately. This drives a warning,
 * and a warning that cries wolf gets ignored — better to under-count and stay
 * believable than to flag every plan.
 */
export function classifyPractice(name: string, guided = false): ClassifiedPractice {
  const n = name || "";
  if (guided) return { name, cost: "dedicated", guided: true };
  if (ATTACHED.some((re) => re.test(n))) return { name, cost: "attached", guided: false };
  if (DEDICATED.some((re) => re.test(n))) return { name, cost: "dedicated", guided: false };
  return { name, cost: "attached", guided: false };
}

export type LoadVerdict = "comfortable" | "full" | "heavy";

export interface PracticeLoad {
  total: number;
  dedicated: ClassifiedPractice[];
  attachedCount: number;
  guidedCount: number;
  verdict: LoadVerdict;
  /** one line the coach can act on */
  headline: string;
}

/**
 * Thresholds measured against the real roster, not invented. Across the 15
 * published plans the median is 7 practices with 2 dedicated moments, and the
 * spread runs 5–14. `comfortable` therefore has to cover 7/2 comfortably or
 * the check fires on every plan and gets ignored; at these values 13 plans
 * read comfortable, one full (10 practices) and one heavy — Hariharan, at 14
 * practices and 7 dedicated moments, which is the plan that prompted this.
 * A check that flags everything is a check nobody reads.
 */
const FULL_TOTAL = 9;
const FULL_DEDICATED = 4;
const HEAVY_TOTAL = 11;
const HEAVY_DEDICATED = 6;

export function practiceLoad(
  practices: { name: string; guided?: boolean }[],
): PracticeLoad {
  const all = practices.map((p) => classifyPractice(p.name, p.guided));
  const dedicated = all.filter((p) => p.cost === "dedicated");
  const total = all.length;
  const d = dedicated.length;

  const verdict: LoadVerdict =
    total >= HEAVY_TOTAL || d >= HEAVY_DEDICATED
      ? "heavy"
      : total > FULL_TOTAL || d > FULL_DEDICATED
        ? "full"
        : "comfortable";

  const headline =
    verdict === "heavy"
      ? `${total} practices, ${d} needing their own moment in the day — enough that most clients will quietly do a few and feel behind on the rest.`
      : verdict === "full"
        ? `${total} practices, ${d} needing their own moment. Workable, but there is no room for another.`
        : `${total} practices, ${d} needing their own moment in the day.`;

  return {
    total,
    dedicated,
    attachedCount: total - d,
    guidedCount: all.filter((p) => p.guided).length,
    verdict,
    headline,
  };
}

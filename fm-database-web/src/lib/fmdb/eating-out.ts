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
  [/buffet|hotel/, /buffet|hotel/],
  [/airport|station|train|flight|road|travel|journey/, /airport|lounge|station|\btrain\b|flight|flying|road trip|on the road|travel|\btrip\b|journey|out of (town|station)/],
  [/wedding|party|celebrat|function|festival|guest/, /wedding|shaadi|party|function|celebrat|festival|birthday|reception/],
  [/order|deliver|takeaway|take.?away/, /order(ing)? in|deliver|takeaway|take.?away|swiggy|zomato/],
  [/office|work|canteen/, /office|canteen|at work|work lunch/],
  [/restaurant|eating out|dinner out/, /restaurant|eating out|eat out|(dinner|lunch) out|(client|business|team) (dinner|lunch)|\bcafe\b|dhaba/],
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

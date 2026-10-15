/**
 * Programme feedback — how the CLIENT says we did.
 *
 * Everything else the coach sees is measured by us (MSQ, weight, labs,
 * adherence). This is the one place the client grades the programme in her
 * own terms: did the things she came in for change, which parts helped, would
 * she send a friend, and may we quote her.
 *
 * Asked three times, each once:
 *   - midpoint   — halfway through an active plan (≥ 8 weeks), so a part that
 *                  isn't working can still be fixed for THIS client;
 *   - graduation — once the plan has actually ended (not during the final-
 *                  stretch lead-in, where the end-game banner is already asking
 *                  her to decide what's next), and kept open afterwards, so a
 *                  client who lapsed without answering is still asked the next
 *                  time she opens the app (or the coach's link);
 *   - followup   — ~3 months after the plan ended: did it hold?
 *
 * Responses land as `sessions/<date>-NNN-app-feedback.yaml` with a
 * `feedback_response` block (scripts/save-app-feedback.py), the same shape
 * and sync path as the weekly check-in.
 *
 * Pure module — no fs, no React — so the app, the API route, the coach panel
 * and the tests all share one definition.
 */

export type FeedbackStage = "midpoint" | "graduation" | "followup";

export const FEEDBACK_STAGES: readonly FeedbackStage[] = ["midpoint", "graduation", "followup"];

/** Days after the effective end before the "did it hold?" follow-up opens. */
export const FOLLOWUP_AFTER_DAYS = 90;

/** Plans shorter than this get no midpoint ask — half of a month-long plan is
 *  two weeks, too early to judge anything. */
export const MIDPOINT_MIN_WEEKS = 8;

/** The parts of the programme the client rates. `id` is the stored key —
 *  never rename one, or older responses stop lining up on the dashboard. */
export const FEEDBACK_PARTS: readonly { id: string; label: string }[] = [
  { id: "menus", label: "Weekly menus & recipes" },
  { id: "supplements", label: "Supplement plan" },
  { id: "app", label: "This app" },
  { id: "whatsapp", label: "WhatsApp support" },
  { id: "calls", label: "Calls with Shivani" },
];

/** How much a goal has changed. Stored as the number. */
export const GOAL_CHANGE: readonly { v: number; label: string }[] = [
  { v: -1, label: "Worse" },
  { v: 0, label: "No change" },
  { v: 1, label: "A little better" },
  { v: 2, label: "Much better" },
  { v: 3, label: "Resolved" },
];

export type TestimonialConsent = "named" | "anonymous" | "no";

export interface FeedbackResponse {
  stage: FeedbackStage;
  week: number;
  /** one per goal shown, in the order shown */
  goals: { goal: string; change: number | null }[];
  /** part id → 1..5, or null for "didn't use" */
  parts: Record<string, number | null>;
  /** 0..10, null if skipped */
  recommend: number | null;
  biggest_change: string;
  hardest: string;
  change_one_thing: string;
  /** only asked at graduation / followup; "no" otherwise */
  testimonial: TestimonialConsent;
  received_at?: string;
}

/** What the app needs to know to ask. */
export interface AppFeedback {
  /** the stage to ask now, or null when nothing is due */
  due: FeedbackStage | null;
  /** stages already answered */
  done: FeedbackStage[];
  /** her own intake goals, cleaned, at most MAX_GOALS */
  goals: string[];
}

export const MAX_GOALS = 5;
const MAX_TEXT = 2000;

/**
 * Turn `client.goals` into a short list of distinct goals in her own words.
 *
 * The field is messy in practice: the intake form stores one entry that is
 * itself a bulleted, newline-separated block, a re-submit appends the same
 * goals again, and a goal often carries a bracketed aside. Split on lines,
 * drop bullet marks, and de-duplicate on a normalised form so "getting my
 * sleep back on track" is asked once, not three times.
 */
export function parseClientGoals(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  const seen: string[] = [];
  for (const e of entries) {
    if (typeof e !== "string") continue;
    for (const line of e.split(/\r?\n/)) {
      let g = line.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "").trim();
      if (!g) continue;
      g = g.replace(/\s+/g, " ");
      if (g.length > 140) g = g.slice(0, 137).trimEnd() + "…";
      const key = normaliseGoal(g);
      if (!key) continue;
      // A later, longer statement of the same goal ("getting my sleep back on
      // track" vs "getting my sleep back on track - and hormones…") keeps the
      // first, shorter one; a strict prefix counts as the same goal.
      if (seen.some((s) => s === key || s.startsWith(key) || key.startsWith(s))) continue;
      seen.push(key);
      out.push(g.charAt(0).toUpperCase() + g.slice(1));
      if (out.length >= MAX_GOALS) return out;
    }
  }
  return out;
}

function normaliseGoal(g: string): string {
  return g
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Which stage (if any) to ask now.
 *
 * Graduation outranks the others: a client who never answered at the end is
 * asked for THAT, not skipped ahead to the follow-up, because the end-of-plan
 * answer is the one the dashboard is built around. The midpoint is dropped once
 * the plan reaches its final stretch — asking "how's it going so far" a week
 * before the end only to ask again at the end is one form too many.
 */
export function resolveFeedbackDue(input: {
  mode: "ACTIVE" | "REVIEW" | "MAINTENANCE" | "GRACE" | "LIBRARY";
  /** REVIEW only: true while still BEFORE the end date (the final-stretch
   *  lead-in). Nothing is asked then. */
  approaching?: boolean;
  week: number;
  totalWeeks: number;
  /** effective end / recheck date, YYYY-MM-DD */
  recheckDate: string | null;
  todayYmd: string;
  done: ReadonlySet<FeedbackStage>;
}): FeedbackStage | null {
  const { mode, approaching, week, totalWeeks, recheckDate, todayYmd, done } = input;
  if (mode === "ACTIVE") {
    if (done.has("midpoint") || done.has("graduation")) return null;
    if (totalWeeks < MIDPOINT_MIN_WEEKS) return null;
    return week >= Math.ceil(totalWeeks / 2) ? "midpoint" : null;
  }
  if (mode === "REVIEW" && approaching) return null;
  if (!done.has("graduation")) return "graduation";
  if (mode === "REVIEW") return null;
  if (done.has("followup") || !recheckDate) return null;
  return todayYmd >= addDaysYmd(recheckDate, FOLLOWUP_AFTER_DAYS) ? "followup" : null;
}

/**
 * Validate an untrusted POST body into a FeedbackResponse. Returns an error
 * string instead when the body is unusable. Unknown parts and goals beyond
 * MAX_GOALS are dropped rather than rejected — the form is the only writer.
 */
export function sanitiseFeedback(body: Record<string, unknown>): FeedbackResponse | string {
  const stage = body.stage;
  if (stage !== "midpoint" && stage !== "graduation" && stage !== "followup") return "unknown stage";

  const goals: FeedbackResponse["goals"] = [];
  if (Array.isArray(body.goals)) {
    for (const g of body.goals.slice(0, MAX_GOALS)) {
      if (!g || typeof g !== "object") continue;
      const goal = typeof (g as Record<string, unknown>).goal === "string" ? ((g as Record<string, unknown>).goal as string).slice(0, 200) : "";
      if (!goal) continue;
      goals.push({ goal, change: intIn((g as Record<string, unknown>).change, -1, 3) });
    }
  }

  const parts: Record<string, number | null> = {};
  const rawParts = body.parts && typeof body.parts === "object" ? (body.parts as Record<string, unknown>) : {};
  for (const p of FEEDBACK_PARTS) parts[p.id] = intIn(rawParts[p.id], 1, 5);

  const recommend = intIn(body.recommend, 0, 10);
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "");
  const biggest_change = text(body.biggest_change);
  const hardest = text(body.hardest);
  const change_one_thing = text(body.change_one_thing);

  const t = body.testimonial;
  const testimonial: TestimonialConsent =
    stage !== "midpoint" && (t === "named" || t === "anonymous") ? t : "no";

  const answered =
    goals.some((g) => g.change !== null) ||
    Object.values(parts).some((v) => v !== null) ||
    recommend !== null ||
    !!(biggest_change || hardest || change_one_thing);
  if (!answered) return "nothing answered";

  return {
    stage,
    week: intIn(body.week, 0, 200) ?? 0,
    goals,
    parts,
    recommend,
    biggest_change,
    hardest,
    change_one_thing,
    testimonial,
  };
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) return null;
  return n;
}

// ── coach-side summary ─────────────────────────────────────────────────────

export interface FeedbackRow extends FeedbackResponse {
  clientId: string;
  clientName: string;
  date: string;
}

export interface FeedbackSummary {
  responses: number;
  clients: number;
  /** Net Promoter Score: % promoters (9–10) − % detractors (0–6), over
   *  responses that answered the question. null with no answers. */
  nps: number | null;
  npsAnswered: number;
  /** part id → { avg 1..5 (1 dp), n } — only parts somebody rated */
  parts: Record<string, { avg: number; n: number }>;
  /** goal ratings across all responses: how many landed in each bucket */
  goalChange: { worse: number; same: number; better: number; resolved: number; rated: number };
}

/** Roll up feedback rows. Graduation and follow-up answers count; a midpoint
 *  answer is a progress check, not a verdict, so it stays out of the NPS and
 *  goal figures (it is still listed for the coach to read). */
export function summariseFeedback(rows: readonly FeedbackRow[]): FeedbackSummary {
  const verdicts = rows.filter((r) => r.stage !== "midpoint");
  const recs = verdicts.map((r) => r.recommend).filter((n): n is number => n !== null);
  const promoters = recs.filter((n) => n >= 9).length;
  const detractors = recs.filter((n) => n <= 6).length;
  const nps = recs.length ? Math.round(((promoters - detractors) / recs.length) * 100) : null;

  const parts: FeedbackSummary["parts"] = {};
  for (const p of FEEDBACK_PARTS) {
    const vals = verdicts.map((r) => r.parts?.[p.id]).filter((n): n is number => typeof n === "number");
    if (vals.length) parts[p.id] = { avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, n: vals.length };
  }

  const goalChange = { worse: 0, same: 0, better: 0, resolved: 0, rated: 0 };
  for (const r of verdicts) {
    for (const g of r.goals ?? []) {
      if (g.change === null || g.change === undefined) continue;
      goalChange.rated++;
      if (g.change < 0) goalChange.worse++;
      else if (g.change === 0) goalChange.same++;
      else if (g.change === 3) goalChange.resolved++;
      else goalChange.better++;
    }
  }

  return {
    responses: rows.length,
    clients: new Set(rows.map((r) => r.clientId)).size,
    nps,
    npsAnswered: recs.length,
    parts,
    goalChange,
  };
}

/**
 * Give a plan to a client one layer at a time.
 *
 * The load check (practice-load.ts) told the coach when a plan asked too much;
 * it could not do anything about it. Hariharan's plan is 14 practices with 7
 * dedicated moments, and every one of them appeared on day one. A client given
 * seven stopped moments does one and feels behind on six — and the failure
 * attaches to the plan, then to the coaching.
 *
 * So the plan stays whole and arrives in phases. Phase 1 is what they start
 * with; later phases open on the calendar as the plan runs.
 *
 * TWO DESIGN COMMITMENTS, both load-bearing:
 *
 *   Release is TIME-based, not behaviour-based. A behaviour gate ("open phase
 *   2 once they've done phase 1 for a week") needs practice-log data, and the
 *   log is empty — two files across the whole roster. A gate reading an empty
 *   sensor never opens, and a client whose plan silently stalls at phase 1 for
 *   twelve weeks is far worse off than one who got everything at once. Time
 *   cannot stall.
 *
 *   The gate is MONOTONE BY CONSTRUCTION. A client who has a practice and then
 *   loses it reads that as the app breaking, or as a punishment; both are
 *   worse than a slow drip. The obvious brake — "drop the ceiling by one while
 *   they're struggling" — is NOT monotone, and the counter-example is ordinary:
 *   active in week 4 with phase 2 open, silent a fortnight, back in week 6, and
 *   phase 2 disappears. So the brake instead asks about the client's state AT
 *   THE WEEK EACH PHASE CAME DUE, which is a fact about the past and cannot
 *   change underneath them. A held phase is DELAYED by a fixed grace, never
 *   withheld indefinitely.
 *
 * What this buys and what it does not: the brake stops a new layer landing on
 * someone who is absent or struggling AT THE MOMENT it would have landed. It
 * does not eliminate pile-up for a client who is away for months — they come
 * back to everything their calendar week has reached. That is deliberate; the
 * alternative stalls, and the coach already has a dormancy chip for the truly
 * absent.
 */

const DAY_MS = 86_400_000;

/** A weekly-poll score, as `classifyPollReply` produces it. */
export type PollScore = "good" | "partial" | "struggling";

/**
 * Weeks between phases.
 *
 * Three on a standard 12-week plan: long enough that a layer becomes ordinary
 * before the next arrives, short enough that a 4-phase plan has all of it in
 * play by week 10 with time to bed in. Shorter plans get two, so a 6-week
 * reset is not still handing out new work in its final week.
 */
export function phaseInterval(totalWeeks: number): number {
  return totalWeeks >= 10 ? 3 : 2;
}

/** The plan week this phase becomes due. Phase 1 (and anything unnumbered)
 *  is week 1 — a client always starts with a foundation.
 *
 *  Clamped so the last phase always lands with at least a week of plan left
 *  to run: an over-staged short plan collapses its late layers together,
 *  which is the right failure. Never showing a prescribed practice at all is
 *  not. */
export function phaseOpensAtWeek(phase: number, totalWeeks: number): number {
  if (!Number.isFinite(phase) || phase <= 1) return 1;
  const due = 1 + (Math.floor(phase) - 1) * phaseInterval(totalWeeks);
  return Math.max(1, Math.min(due, totalWeeks - 1));
}

/**
 * How recent a "struggling" poll has to be to still mean anything.
 *
 * Three weeks: long enough to span the weekly poll cadence with a missed week
 * of slack, short enough that a bad fortnight in month one is not still
 * throttling the plan in month three.
 */
export const STRUGGLING_WINDOW_DAYS = 21;

export type HeldReason = "dormant" | "struggling";

/**
 * How long a held phase waits before opening anyway.
 *
 * Two weeks. Long enough to be a real pause rather than a rounding error,
 * short enough that a client who went quiet once is not still paying for it a
 * month later. Bounded on purpose: an unbounded hold needs releasing by hand,
 * and anything needing releasing by hand eventually doesn't get released.
 */
export const HELD_GRACE_WEEKS = 2;

export interface PhaseGateInput {
  /** current plan week, 1-based — the app's own counter, travel-pause included */
  week: number;
  totalWeeks: number;
  /** highest phase number any practice on this plan carries */
  maxPhase: number;
  /**
   * The client's state at the week a phase came due, or null if they were
   * fine. Asked about a PAST week, never about now — that is what makes the
   * gate monotone. Callers supply this from the app-opens log and the poll
   * history; both are append-only, so an answer once given never changes.
   */
  stateAtDue: (dueWeek: number) => HeldReason | null;
}

export interface PhaseGate {
  /** highest phase the client may see right now */
  openPhase: number;
  /** what the calendar alone would have opened */
  scheduledPhase: number;
  /** why the newest layer is running late — coach-facing only */
  held: HeldReason | null;
  /** phases that exist on the plan but are not open yet */
  waiting: number;
}

/**
 * Which phases are open, and whether the newest one is running late.
 *
 * Each phase is independently either on time or delayed by its own fixed
 * grace, so the answer for a given week is the same however many times it is
 * asked and whatever the client is doing right now.
 */
export function gatePhases(input: PhaseGateInput): PhaseGate {
  const { week, totalWeeks, maxPhase, stateAtDue } = input;
  const top = Math.max(1, maxPhase);

  let scheduled = 1;
  let openPhase = 1;
  let held: HeldReason | null = null;

  for (let p = 2; p <= top; p++) {
    const due = phaseOpensAtWeek(p, totalWeeks);
    if (week < due) break;
    scheduled = p;
    // Phase 1 is never held; from here on, a phase that came due while the
    // client was away or struggling simply arrives late.
    const reason = stateAtDue(due);
    if (!reason || week >= due + HELD_GRACE_WEEKS) {
      openPhase = p;
      held = null;
    } else {
      held = reason;
      break; // later phases can't be open if this one isn't
    }
  }

  return {
    openPhase,
    scheduledPhase: scheduled,
    held,
    waiting: Math.max(0, top - openPhase),
  };
}

/**
 * Build the `stateAtDue` answer from the two append-only histories the app
 * already keeps: the app-opens log and the weekly-poll replies on sessions.
 *
 * Both are asked about a fixed past date, so an answer once given never
 * changes — which is exactly the property `gatePhases` relies on to stay
 * monotone. Nothing here looks at "now".
 *
 * No start anchor means no answer: a plan with no Day 1 has no due dates
 * worth reasoning about, and guessing would gate a client out of practices on
 * the strength of a date we invented.
 */
export function stateAtDueFrom(opts: {
  /** ms timestamp of plan Day 1, or null when the plan has no anchor yet */
  startMs: number | null;
  /** ISO timestamps from _app_opens.yaml */
  opens: string[];
  /** weekly-poll replies, ISO date + score */
  polls: { date: string; score: PollScore }[];
  dormantDays: number;
}): (dueWeek: number) => HeldReason | null {
  const { startMs, opens, polls, dormantDays } = opts;
  if (startMs === null) return () => null;

  const openMs = opens
    .map((o) => Date.parse(o))
    .filter((t) => Number.isFinite(t));
  const pollMs = polls
    .map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), score: p.score }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  return (dueWeek: number): HeldReason | null => {
    const at = startMs + (dueWeek - 1) * 7 * DAY_MS;

    // Away: nothing at all in the dormancy window ending on the due date.
    // dormantDays 0 disables this arm, matching the menu cron's override.
    if (dormantDays > 0) {
      const from = at - dormantDays * DAY_MS;
      if (!openMs.some((t) => t >= from && t <= at)) return "dormant";
    }

    // Struggling: the most recent poll ON OR BEFORE the due date, if it is
    // recent enough to still describe them. An older poll is not evidence
    // about this week.
    const recent = pollMs.filter(
      (p) => p.t <= at && at - p.t <= STRUGGLING_WINDOW_DAYS * DAY_MS,
    );
    const last = recent[recent.length - 1];
    if (last?.score === "struggling") return "struggling";

    return null;
  };
}

/**
 * Split practices into what the client sees now and what is still to come.
 *
 * An absent or unparseable `phase` is phase 1 — the safe default, because the
 * failure mode of guessing high is a practice that never appears at all. Every
 * plan written before phasing existed therefore behaves exactly as it did.
 */
export function normalisePhase(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function splitByPhase<T>(
  items: T[],
  phaseOf: (item: T) => unknown,
  openPhase: number,
): { open: T[]; later: T[] } {
  const open: T[] = [];
  const later: T[] = [];
  for (const it of items) {
    (normalisePhase(phaseOf(it)) <= openPhase ? open : later).push(it);
  }
  return { open, later };
}

/** Highest phase any of these practices carries. */
export function maxPhaseOf<T>(items: T[], phaseOf: (item: T) => unknown): number {
  return items.reduce((m, it) => Math.max(m, normalisePhase(phaseOf(it))), 1);
}

/**
 * Seed phases for a plan that has none, from the load check's own reading.
 *
 * The expensive practices are the ones needing a stopped moment, so those are
 * what get staged; the cheap ones (a tea with breakfast, a swap at dinner)
 * cost the client nothing extra and all start on day one.
 *
 * ORDER IS THE COACH'S. She writes the practice that matters most first, and
 * that judgement is clinical — nothing here is entitled to outrank it. An
 * earlier version sorted app-guided practices to the front and promptly
 * displaced the first practice she had written on Hariharan's plan, which is a
 * worse error than the one it fixed.
 *
 * The one exception is a guarantee, not a preference: if her order would leave
 * EVERY app-guided practice outside the foundation, the last foundation slot
 * goes to the earliest guided one. Those are the practices the app actually
 * walks the client through, so a plan whose day one contains none of them has
 * staged away the part most likely to happen. On Hariharan's plan that rescued
 * the EFT round he uses for the anxiety he came in with, which plan order alone
 * had pushed to week 7.
 *
 * A suggestion only, either way. The coach sets the real number per row in the
 * plan editor and hers wins.
 */
export function seedPhases(
  practices: { name: string; guided?: boolean }[],
  classify: (name: string, guided?: boolean) => { cost: string },
  keepDedicated = 3,
  perPhase = 2,
): number[] {
  const out = practices.map(() => 1);
  const dedicated = practices
    .map((p, i) => ({ i, guided: !!p.guided }))
    .filter(({ i }) => classify(practices[i].name, practices[i].guided).cost === "dedicated");

  const order = dedicated.map((d) => d.i);
  const foundation = order.slice(0, keepDedicated);
  const guided = dedicated.filter((d) => d.guided);
  if (guided.length > 0 && !foundation.some((i) => guided.some((g) => g.i === i))) {
    // Swap the LAST foundation slot, so her top choices are untouched.
    const promoted = guided[0].i;
    order.splice(order.indexOf(promoted), 1);
    order.splice(keepDedicated - 1, 0, promoted);
  }

  order.forEach((i, rank) => {
    out[i] = rank < keepDedicated ? 1 : 2 + Math.floor((rank - keepDedicated) / perPhase);
  });
  return out;
}

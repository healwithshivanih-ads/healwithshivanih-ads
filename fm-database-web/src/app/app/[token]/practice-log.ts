/**
 * Recording that a practice happened — including when it was not finished.
 *
 * The mind-body drip decides what to unlock from `_practice_log.jsonl`, so
 * what this does NOT send decides what a client is never offered. Two gaps
 * kept it empty: `somatic` was rejected by the API, and every player only
 * logged on full completion. A client who breathes for two minutes and closes
 * the app has done the practice; the log said she had not, so the gate read
 * zero for everyone and every unlock had to be done by hand.
 *
 * MIN_MEANINGFUL_SECONDS is the honesty line. Opening a session and shutting
 * it immediately is not practice, and logging it would make adherence look
 * better than it is — which is the one thing a compliance dataset must never
 * do. Twenty seconds is long enough to have actually begun.
 */

export const MIN_MEANINGFUL_SECONDS = 20;

export interface PracticeLogInput {
  token: string;
  kind: "breath" | "eft" | "sleep" | "somatic" | "exercise" | "feeling";
  practiceId?: string;
  name?: string;
  slug?: string | null;
  theme?: string | null;
  sudsBefore?: number | null;
  sudsAfter?: number | null;
  rounds?: number | null;
  seconds?: number | null;
  /** false when she closed it part-way */
  completed: boolean;
}

/**
 * Fire-and-forget. `keepalive` so it survives the page being closed, and every
 * failure is swallowed — a client mid-practice must never see a network error,
 * and an offline session is not worth interrupting her for.
 */
export function logPractice(input: PracticeLogInput): void {
  if (!input.token) return;
  // Do not inflate adherence with sessions that never really started.
  if (!input.completed && (input.seconds ?? 0) < MIN_MEANINGFUL_SECONDS) return;
  send(input);
}

/**
 * A "Find a reset" chip tap — the client named a state ("I'm on edge") and the
 * router offered a practice. That pairing is clinical signal (what state, what
 * was offered, at what hour) and used to evaporate in component state. It is
 * NOT practice: kind "feeling" is filtered out by every adherence/drip reader,
 * which match on their own kind strings, so this can never count as a session.
 * The session itself, if she takes the offer, is logged by the player as usual
 * and sits time-adjacent in the same JSONL.
 */
export function logFeeling(input: {
  token: string;
  /** stable feeling key, e.g. "on-edge" */
  feeling: string;
  /** the chip's human label, e.g. "I'm on edge" */
  label: string;
  /** where the router sent her: breath | eft | sleep | somatic */
  routedKind: string;
  /** resolved practice id when the route is somatic */
  routedPracticeId?: string | null;
}): void {
  if (!input.token) return;
  send({
    token: input.token,
    kind: "feeling",
    practiceId: input.routedPracticeId ?? input.routedKind,
    name: input.label,
    theme: input.feeling,
    completed: true,
  });
}

function send(input: PracticeLogInput): void {
  try {
    fetch("/api/app-practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        token: input.token,
        kind: input.kind,
        practice_id: input.practiceId ?? "",
        name: input.name ?? "",
        slug: input.slug ?? null,
        theme: input.theme ?? null,
        suds_before: input.sudsBefore ?? null,
        suds_after: input.sudsAfter ?? null,
        rounds: input.rounds ?? null,
        seconds: input.seconds ?? null,
        completed: input.completed,
      }),
    }).catch(() => {});
  } catch {
    /* offline — skip */
  }
}

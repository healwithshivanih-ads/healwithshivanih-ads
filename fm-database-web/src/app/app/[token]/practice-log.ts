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
  kind: "breath" | "eft" | "sleep" | "somatic";
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

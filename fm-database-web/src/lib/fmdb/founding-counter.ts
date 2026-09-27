/**
 * Feeds the "places taken" counter on the marketing site (ochre-funnel,
 * grow.theochretree.com) whenever the coach marks or unmarks a Sequoya
 * founding member.
 *
 *   POST https://grow.theochretree.com/api/sequoya/founding
 *   x-sequoya-secret: <SEQUOYA_FOUNDING_SECRET>
 *   { "taken": <int> }
 *
 * Best-effort by contract: it never throws and never blocks the save that
 * triggered it — a failure is logged and returned so the coach card can say
 * "counter not updated". No secret → nothing is sent (logged once per call).
 */

export const FOUNDING_COUNTER_URL_DEFAULT = "https://grow.theochretree.com/api/sequoya/founding";

export interface FoundingCounterRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

/** The exact request the counter expects. Pure — the shape is what the test pins. */
export function buildFoundingCounterRequest(taken: number, secret: string, url?: string): FoundingCounterRequest {
  return {
    url: (url || FOUNDING_COUNTER_URL_DEFAULT).trim(),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-sequoya-secret": secret },
      body: JSON.stringify({ taken: Math.max(0, Math.trunc(taken)) }),
    },
  };
}

export type FoundingCounterResult =
  | { ok: true; taken: number; status: number }
  | { ok: false; taken: number; error: string };

export async function pushFoundingCount(
  taken: number,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FoundingCounterResult> {
  const secret = (process.env.SEQUOYA_FOUNDING_SECRET || "").trim();
  if (!secret) {
    console.warn("[founding-counter] SEQUOYA_FOUNDING_SECRET unset — places counter not updated");
    return { ok: false, taken, error: "SEQUOYA_FOUNDING_SECRET not set" };
  }
  const req = buildFoundingCounterRequest(taken, secret, process.env.SEQUOYA_FOUNDING_URL);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(req.url, { ...req.init, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
    if (!res.ok) {
      console.error(`[founding-counter] POST ${req.url} → ${res.status}`);
      return { ok: false, taken, error: `counter endpoint answered ${res.status}` };
    }
    return { ok: true, taken, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[founding-counter] POST ${req.url} failed: ${msg}`);
    return { ok: false, taken, error: msg };
  }
}

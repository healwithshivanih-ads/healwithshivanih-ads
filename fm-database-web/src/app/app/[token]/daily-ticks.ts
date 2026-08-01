/**
 * Sending the daily checklist to the coach — quietly, and without ever
 * getting in the client's way.
 *
 * Ticking a box is the smallest, most frequent thing a client does, so this
 * has to be invisible: a POST per tap would spam the endpoint, and a failed
 * POST must never surface. Three rules follow from that.
 *
 *  1. DEBOUNCE. A client ticking her way down the list produces one write,
 *     not eight. The whole of today's checklist goes each time (not a delta),
 *     so a dropped post costs nothing — the next one carries the full truth,
 *     and the server upserts by date.
 *  2. FLUSH ON LEAVE. The app is a phone PWA; it gets backgrounded mid-list.
 *     `visibilitychange` and `pagehide` flush the pending payload with
 *     `keepalive` so the last tick before she switches away still lands.
 *  3. SWALLOW EVERYTHING. Offline, expired token, rate-limited — all silent.
 *     Her ticks are already saved locally; a network error tells her nothing
 *     she can act on and would only make a good habit feel broken.
 */

export type TickKind = "supplement" | "remedy" | "practice";

export interface TickItem {
  kind: TickKind;
  id: string;
  name: string;
  done: boolean;
  /** display time the client ticked it ("8:30 am"), supplements/remedies only */
  at?: string | null;
}

export interface TickPayload {
  token: string;
  /** the DEVICE's local calendar day — not UTC */
  date: string;
  planSlug?: string;
  week?: number;
  items: TickItem[];
}

/** Long enough to coalesce a run down the list, short enough that a client who
 *  ticks one box and pockets the phone is captured by the flush, not lost. */
const DEBOUNCE_MS = 3500;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: TickPayload | null = null;
let listening = false;

function send(p: TickPayload): void {
  if (!p.token || p.items.length === 0) return;
  try {
    void fetch("/api/app-ticks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        token: p.token,
        date: p.date,
        plan_slug: p.planSlug ?? null,
        week: p.week ?? null,
        items: p.items.map((i) => ({
          kind: i.kind,
          id: i.id,
          name: i.name,
          done: i.done,
          at: i.at ?? null,
        })),
      }),
    }).catch(() => {});
  } catch {
    /* offline / storage-partitioned — the ticks stay local, which is fine */
  }
}

/** Send whatever is queued right now. Safe to call when nothing is queued. */
export function flushTicks(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const p = pending;
  pending = null;
  if (p) send(p);
}

function ensureListeners(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Both, deliberately: iOS Safari fires `pagehide` on a home-screen swipe and
  // may never fire `visibilitychange`; Android Chrome is the other way round.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushTicks();
  });
  window.addEventListener("pagehide", flushTicks);
}

/**
 * Queue today's checklist. Replaces anything already queued — the payload is a
 * full snapshot, so only the newest matters.
 */
export function queueTicks(p: TickPayload): void {
  if (!p.token || p.items.length === 0) return;
  ensureListeners();
  pending = p;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushTicks, DEBOUNCE_MS);
}

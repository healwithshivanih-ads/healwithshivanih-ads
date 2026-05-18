import "server-only";
import { loadAllPlans } from "./loader";

/** 28-day window cap on each WhatsApp rollup file. After this many
 *  days the next inbound/outbound message starts a fresh session with
 *  the next window anchor — keeps file size + write amplification
 *  bounded. */
const WHATSAPP_WINDOW_DAYS = 28;

/**
 * Resolve the active WhatsApp-rollup marker for a client. Combines:
 *   - Published-plan slug (the natural grouping unit per coach request)
 *   - 28-day window anchor within the plan (file-size mitigation —
 *     each rollup file caps at ~28 days; new window → new file →
 *     no unbounded growth even on chatty clients across long plans)
 *
 * Marker format: `[plan: <slug>] [window: <YYYY-MM-DD>]`
 *   - <slug>      → published-plan slug, or sentinel "prospect"
 *   - <YYYY-MM-DD>→ start of the current 28-day window, anchored to
 *                   plan_period_start (so windows align with the plan
 *                   cycle, not arbitrary calendar dates)
 *
 * Tie-breaker on multiple published plans (shouldn't happen post-
 * auto-supersede, but defensive): highest version, then latest
 * updated_at.
 */
export async function getActivePlanSlugForClient(
  clientId: string,
): Promise<{ slug: string; window_start: string; marker: string }> {
  if (!clientId) {
    return _prospectMarker();
  }
  const plans = (await loadAllPlans()) as Array<Record<string, unknown>>;
  const published = plans
    .filter(
      (p) =>
        p.client_id === clientId &&
        ((p.status as string) ?? (p._bucket as string)) === "published",
    )
    .sort((a, b) => {
      const av = (a.version as number) ?? 0;
      const bv = (b.version as number) ?? 0;
      if (av !== bv) return bv - av;
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
  if (published.length === 0) return _prospectMarker();

  const slug = (published[0].slug as string) || "prospect";
  const start = published[0].plan_period_start as string | undefined;
  const window_start = _computeWindowStart(start);
  return {
    slug,
    window_start,
    marker: `[plan: ${slug}] [window: ${window_start}]`,
  };
}

// All window computations use UTC explicitly. Previously these helpers
// constructed Dates with the local-timezone constructor (e.g.
// `new Date(year, month, 1)` or `new Date("YYYY-MM-DDT00:00:00")` with no
// trailing Z), which produced DIFFERENT window dates depending on the
// host's timezone. Same client, same day, two different markers — sessions
// fragmented between the IST-local Mac mini coach process and the
// UTC-local Fly intake receiver. Fixed 2026-05-18.

function _prospectMarker(): { slug: string; window_start: string; marker: string } {
  // For prospects (no published plan), anchor windows to the first of
  // each calendar month — predictable rotation, no plan_period_start
  // to base off.
  const monthStart = _utcMonthStart(new Date());
  return {
    slug: "prospect",
    window_start: monthStart,
    marker: `[plan: prospect] [window: ${monthStart}]`,
  };
}

function _computeWindowStart(planPeriodStart: string | undefined): string {
  if (!planPeriodStart) {
    // No plan_period_start known → fall back to month boundaries.
    return _utcMonthStart(new Date());
  }
  // Trailing `Z` forces UTC interpretation; never local.
  const start = new Date(`${planPeriodStart}T00:00:00Z`);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (diffDays < 0) {
    // Plan hasn't started yet — anchor at the plan start date
    return planPeriodStart;
  }
  const windowIdx = Math.floor(diffDays / WHATSAPP_WINDOW_DAYS);
  const anchor = new Date(start.getTime() + windowIdx * WHATSAPP_WINDOW_DAYS * 86_400_000);
  return anchor.toISOString().slice(0, 10);
}

function _utcMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

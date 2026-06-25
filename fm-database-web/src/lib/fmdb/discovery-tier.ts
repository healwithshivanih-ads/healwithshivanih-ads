/**
 * Discovery-tier resolver — the commercial layer ABOVE app-mode.ts.
 *
 * Two tiers:
 *   discovery — consult-only (₹12,000 call). Read-only app: Lab Vault + Summary,
 *               Plan/Progress locked. An upgrade-credit window runs for
 *               DISCOVERY_CREDIT_WINDOW_DAYS from the discovery call.
 *   package   — signed up / has a published plan. The full Ochre Tree app; its
 *               sub-states (ACTIVE/REVIEW/MAINTENANCE/GRACE/LIBRARY) are resolved
 *               separately by resolveAppMode() in app-mode.ts.
 *
 * This file owns ONLY the tier split + the discovery credit-window state. It does
 * NOT resolve package sub-modes — keep that in app-mode.ts. Callers resolve tier
 * first; if tier === "package", then call resolveAppMode().
 *
 * PURE function — no I/O, no React. Mirrors the UTC-YYYY-MM-DD date discipline in
 * app-mode.ts / plan-timing.ts so comparisons never skew in IST.
 *
 * See docs/DISCOVERY_TIER_SPEC.md.
 */

/** Length of the upgrade-credit window after a discovery call. Within it, the
 *  ₹12,000 consult fee adjusts against the package; after it, the credit lapses
 *  (full price, or re-book a fresh call which resets this clock). Coach decision
 *  2026-06-25. */
export const DISCOVERY_CREDIT_WINDOW_DAYS = 15;

export type AppTier = "discovery" | "package";

/** Credit-window state — drives the upgrade CTA in the Summary + Coach tabs. */
export type DiscoveryCreditState = "credit_live" | "credit_expired";

export interface DiscoveryCredit {
  state: DiscoveryCreditState;
  /** Last day the ₹12,000 still adjusts (YYYY-MM-DD); null if no call date. */
  expiresOn: string | null;
  /** Whole days remaining in the window (0 on the final day); null if no call
   *  date or already expired. Use for the countdown chip. */
  daysLeft: number | null;
}

export interface AppTierInput {
  /** Client.engagement_status — "signed_up" means enrolled/paid for the package
   *  (says nothing about a plan existing; see project memory). */
  engagementStatus?: string | null;
  /** True when the client has any published plan. */
  hasPublishedPlan?: boolean;
  /** Client.discovery_call_date (YYYY-MM-DD) — the credit-window anchor. */
  discoveryCallDate?: string | null;
}

export interface AppTierResult {
  tier: AppTier;
  /** Human-readable why, for telemetry + the coach-facing chip. */
  reason: string;
  /** Present only when tier === "discovery". */
  credit: DiscoveryCredit | null;
}

/** The consult-tier "Your Starting Map" artifact, authored by the coach into a
 *  `discovery_summary` block on client.yaml. Deliberately orientation-only — it
 *  carries NO protocol (doses, meal plans). All four sections are optional; the
 *  Summary screen renders graceful placeholders for whatever isn't authored yet.
 *  See docs/DISCOVERY_TIER_SPEC.md ("The Summary view"). */
export interface DiscoverySummaryPoint {
  title: string;
  note: string;
}
export interface DiscoverySummary {
  /** Warm one-liner; falls back to a default greeting when empty. */
  headline: string;
  /** Top 2–3 root-cause hypotheses (orientation, scope-safe). */
  hypotheses: DiscoverySummaryPoint[];
  /** 2–3 generic-safe foundational starting changes (principles, not doses). */
  foundationalChanges: DiscoverySummaryPoint[];
  /** The honest "what your full journey would add" list — the upsell bridge. */
  journeyPreview: string[];
}

/** Add n days to a YYYY-MM-DD string in UTC, returning YYYY-MM-DD. */
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromYmd` to `toYmd` (UTC). Negative if `toYmd` is earlier. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00Z").getTime();
  const b = new Date(toYmd + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD strings compare lexicographically === chronologically. */
function isValidYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Resolve the credit-window state for a discovery client. `todayYmd` is the
 * caller's "today" in YYYY-MM-DD (pass IST-local day; the app uses Asia/Kolkata).
 *
 * Fail-open: if the call date is missing/malformed we cannot compute the window,
 * so we show credit_live WITHOUT a countdown rather than wrongly telling a client
 * their credit has expired.
 */
export function resolveDiscoveryCredit(
  discoveryCallDate: string | null | undefined,
  todayYmd: string,
): DiscoveryCredit {
  if (!isValidYmd(discoveryCallDate)) {
    return { state: "credit_live", expiresOn: null, daysLeft: null };
  }
  const expiresOn = addDaysYmd(discoveryCallDate, DISCOVERY_CREDIT_WINDOW_DAYS);
  if (todayYmd <= expiresOn) {
    // daysLeft clamps at 0 on the final day; never negative inside this branch.
    const daysLeft = Math.max(0, daysBetweenYmd(todayYmd, expiresOn));
    return { state: "credit_live", expiresOn, daysLeft };
  }
  return { state: "credit_expired", expiresOn, daysLeft: null };
}

/**
 * Resolve which tier the app renders in.
 *
 * Precedence: a client is "package" the moment they've signed up OR a published
 * plan exists. Any other reachable app (it's reached via the per-client app_token)
 * is a consult-only "discovery" client — and carries a credit-window state.
 */
export function resolveAppTier(
  input: AppTierInput,
  todayYmd: string,
): AppTierResult {
  if (input.engagementStatus === "signed_up") {
    return { tier: "package", reason: "engagement_status = signed_up", credit: null };
  }
  if (input.hasPublishedPlan) {
    return { tier: "package", reason: "published plan on file", credit: null };
  }
  const credit = resolveDiscoveryCredit(input.discoveryCallDate, todayYmd);
  return {
    tier: "discovery",
    reason: isValidYmd(input.discoveryCallDate)
      ? `discovery call ${input.discoveryCallDate}; ${credit.state}`
      : "discovery (no call date on file)",
    credit,
  };
}

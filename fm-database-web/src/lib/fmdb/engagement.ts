import "server-only";

/**
 * Who counts as a client.
 *
 * Everyone the coach talks to gets a record — including people who only ever
 * had a discovery chat. `engagement_status` is the discriminator, and it is
 * already load-bearing across the app (assess guardrail, app tier resolution,
 * revenue export, dashboard, clients list). This module is the shared vocabulary
 * so new call sites don't each invent their own check.
 *
 * Two layers keep non-clients out of the way, and they are complementary:
 *
 *  1. **Parking** (`fmdb prospects-sweep`) moves people who never signed up and
 *     have gone quiet for 15+ days out of `clients/` into `prospects/`. Since
 *     `loadAllClients()` only walks `clients/`, that alone removes cold leads
 *     from every roster count, scan and cron.
 *
 *  2. **These guards** cover the residual case: someone non-signed-up who is
 *     still *inside* the 15-day grace window, so still sitting in `clients/`.
 *     They should show up in the coach's triage — but must not be messaged by
 *     automation as though they were a paying client.
 *
 * Most crons already gate on "has a published plan", which a non-signed-up
 * person never has, so they need no extra guard. Use these only where a cron
 * reaches clients *without* a plan gate.
 */

/** The one engagement_status that means "this is a real, enrolled client". */
export const SIGNED_UP = "signed_up";

/** Days of quiet after which `fmdb prospects-sweep` parks a non-signed-up
 *  person. Mirrors `PROSPECT_QUIET_DAYS` in `fmdb/plan/prospects.py`. */
export const PROSPECT_QUIET_DAYS = 15;

type MaybeClient = { engagement_status?: unknown } | Record<string, unknown> | null | undefined;

function statusOf(client: MaybeClient): string {
  if (!client) return "pending";
  const raw = (client as Record<string, unknown>).engagement_status;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : "pending";
}

/** True only for enrolled clients. Records with the field missing entirely
 *  count as NOT signed up — the field has been forgotten on real clients
 *  before, so the safe reading is "prove it, don't assume it". */
export function isSignedUp(client: MaybeClient): boolean {
  return statusOf(client) === SIGNED_UP;
}

/** True when the coach has explicitly ruled this person out. */
export function isDeclined(client: MaybeClient): boolean {
  return statusOf(client) === "declined";
}

/**
 * Filter a client list down to enrolled clients only.
 *
 * Use in automation that would otherwise message or bill against a prospect.
 * Do NOT use on surfaces whose whole job is working prospects — the intake
 * reminder chase and the triage/pipeline views are supposed to see them.
 */
export function onlySignedUp<T extends MaybeClient>(clients: readonly T[]): T[] {
  return clients.filter((c) => isSignedUp(c));
}

/** One person the roster review is unsure about. */
export interface UnevidencedSignup {
  client_id: string;
  display_name: string;
  /** Days since the last human touch, or null when nothing is dateable. */
  quiet_days: number | null;
  /** Plain-English reason, for the coach to judge against. */
  reason: string;
}

export interface RosterCandidate {
  client_id: string;
  display_name?: string | null;
  engagement_status?: unknown;
  intake_submitted_at?: unknown;
  /** Newest human touch as YYYY-MM-DD — caller decides how to derive it. */
  last_touch?: string | null;
}

/** Whole days from `fromYmd` to `toYmd`, or null if either is unusable. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Records marked `signed_up` that show no evidence of actually being a client.
 *
 * The inverse of the problem `prospects-sweep` solves. The sweep only looks at
 * people who are NOT signed_up, so a record wrongly marked signed_up is
 * invisible to it and quietly inflates the roster — which is exactly what
 * happened to Anita Pansari (cl-020): discovery consult, intake never
 * submitted, no plan, 24 days quiet, yet counted as an active client.
 *
 * Evidence of being a real client = a submitted intake OR a plan. Either alone
 * is enough; Kamla and Nazneen have both, Anita had neither.
 *
 * REPORT ONLY. Nothing here moves or edits anyone. Auto-parking a signed_up
 * record risks exiling a genuinely paying client over a data gap, which is far
 * worse than the roster being one too high. The coach judges each one.
 *
 * A brand-new signup mid-onboarding legitimately has neither yet, so the quiet
 * window keeps them off the list (cl-023 Siddharth, 7 days in, is not flagged).
 */
export function findUnevidencedSignups(
  clients: readonly RosterCandidate[],
  clientIdsWithAnyPlan: ReadonlySet<string>,
  todayYmd: string,
  quietAfterDays: number = PROSPECT_QUIET_DAYS
): UnevidencedSignup[] {
  const out: UnevidencedSignup[] = [];
  for (const c of clients) {
    if (!isSignedUp(c)) continue;
    if (clientIdsWithAnyPlan.has(c.client_id)) continue;
    const submitted =
      typeof c.intake_submitted_at === "string" && c.intake_submitted_at.trim().length > 0;
    if (submitted) continue;

    const quiet =
      typeof c.last_touch === "string" && c.last_touch
        ? daysBetweenYmd(c.last_touch.slice(0, 10), todayYmd)
        : null;
    // Still inside the grace window — normal fresh onboarding, not a flag.
    if (quiet !== null && quiet < quietAfterDays) continue;

    out.push({
      client_id: c.client_id,
      display_name: (c.display_name || c.client_id).trim(),
      quiet_days: quiet,
      reason:
        quiet === null
          ? "marked signed up, but no intake submitted, no plan, and no dateable activity"
          : `marked signed up, but no intake submitted, no plan, and quiet ${quiet} days`,
    });
  }
  out.sort((a, b) => (b.quiet_days ?? 1e9) - (a.quiet_days ?? 1e9));
  return out;
}

/**
 * Does the name the coach typed match the client's actual display name?
 *
 * Gates the one override that can build a plan before signup (see
 * `generateDraftAction`). A one-click "generate anyway" is how a plan ends up
 * built for someone who never signed up — the click becomes momentum rather
 * than a decision. Retyping the name forces a look at who this actually is.
 *
 * Forgiving about case and surrounding whitespace — the coach is retyping what
 * is on screen, not entering a password — but nothing else. Blank, partial and
 * non-string values never pass.
 *
 * Lives here rather than beside its caller because that file is `"use server"`,
 * which only permits async exports, so a pure helper there is untestable.
 */
export function confirmationNameMatches(
  typed: string | null | undefined,
  actual: string | null | undefined
): boolean {
  const a = typeof typed === "string" ? typed.trim().toLowerCase() : "";
  const b = typeof actual === "string" ? actual.trim().toLowerCase() : "";
  return a.length > 0 && b.length > 0 && a === b;
}

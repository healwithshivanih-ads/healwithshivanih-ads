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

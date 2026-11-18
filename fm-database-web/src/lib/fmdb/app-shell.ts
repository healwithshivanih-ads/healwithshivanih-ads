/**
 * Which FRONT of the client app (/app/<token>) a client sees.
 *
 *   "classic" — today's app (ochre-app.tsx and the ochre-* screens)
 *   "sq"      — the new Sequoya shell (sq-app.tsx), built beside it
 *
 * Both fronts read and write the same records and the same on-device store,
 * so moving a client either way loses nothing.
 *
 * This is the ONE place that decides. It is a pure function (no I/O, no
 * React) so the rule can be tested exhaustively; ochre-app.tsx calls it once.
 * Never branch on `appShell` anywhere else.
 *
 * The new front is shown only when ALL of these hold:
 *   1. the client record carries `app_shell: v2` (the per-client switch);
 *   2. the tier is "package" — not the discovery app ("discovery" and
 *      "enrolled" both render through it) and not the guided tier;
 *   3. the app mode is ACTIVE — REVIEW, MAINTENANCE, GRACE and LIBRARY keep
 *      today's end-of-programme screens;
 *   4. the plan is not on setup hold (no start date yet) — that keeps today's
 *      "being set up" screen.
 *
 * Anything else, including a missing or unrecognised switch value, is
 * today's app. Failing towards "classic" is deliberate: the new front
 * carries the Sequoya name, which no real client may see before 2 Jan 2027.
 */

import type { AppMode } from "./app-mode";
import type { AppTier } from "./discovery-tier";

export type AppShell = "classic" | "sq";

/** client.yaml#app_shell → the typed switch. Only the exact string "v2" turns
 *  the new front on; every other value (absent, empty, a typo, a future
 *  version this build does not know) reads as off. */
export function parseAppShell(raw: unknown): "v2" | null {
  return raw === "v2" ? "v2" : null;
}

/** The slice of ClientAppData["client"] the hold check reads. */
export interface PlanStartState {
  notStarted: boolean;
  startsInDays: number;
}

/**
 * Setup hold: the plan has not started AND no start date is committed yet, so
 * there is nothing to show but the "being set up" screen. A plan with a
 * committed future start date is NOT on hold — the app previews it frozen at
 * its Day-1 state.
 */
export function isPlanSetupHold(client: PlanStartState): boolean {
  return client.notStarted && !(client.startsInDays > 0);
}

/** The slice of ClientAppData the decision reads (duck-typed so a test can
 *  build one without a full payload). */
export interface AppShellInput {
  appShell?: string | null;
  tier: AppTier;
  mode: AppMode;
  client: PlanStartState;
}

export function pickAppShell(data: AppShellInput): AppShell {
  if (parseAppShell(data.appShell) !== "v2") return "classic";
  if (data.tier !== "package") return "classic";
  if (data.mode !== "ACTIVE") return "classic";
  if (isPlanSetupHold(data.client)) return "classic";
  return "sq";
}

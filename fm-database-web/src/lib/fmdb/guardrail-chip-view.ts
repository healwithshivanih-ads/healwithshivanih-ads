/**
 * The one decision every catalogue guardrail chip makes, in one place.
 *
 * Both chips (orphans, duplicates) answer the same question — render nothing,
 * render an alarm, or say the scan could not run — and both used to answer it
 * with a single early-out:
 *
 *     if (!status || status.blocking === 0) return null;   // orphans
 *     if (!status || status.newCount === 0) return null;   // duplicates
 *
 * Once the actions became discriminated, the minimal edit that satisfies the
 * type-checker is:
 *
 *     if (!status || status.status !== "ok" || status.newCount === 0) return null;
 *
 * That compiles, keeps the ratchet intact, reads like a correct narrowing — and
 * silently restores the exact fail-closed hide this whole change removed, because
 * an unavailable scan lands back in `return null`. It is the one-token version of
 * the bug and the likeliest way it comes back.
 *
 * So the decision is a pure function with all four outcomes enumerated and pinned
 * (guardrail-chip-view.test.ts). A chip that calls this cannot collapse
 * "unavailable" into "hide" without deleting a case the test asserts.
 */

/** null status = still loading; the chip renders nothing yet. */
export type ChipStatus =
  | null
  | { status: "unavailable" }
  | { status: "ok"; actionable: number };

export type ChipView =
  /** not loaded yet — render nothing, but do NOT treat as good news */
  | "loading"
  /** the scan could not run — render "couldn't check", never nothing */
  | "unavailable"
  /** scan succeeded and found nothing actionable — the normal quiet state */
  | "hide"
  /** scan succeeded and found something — render the alarm */
  | "alarm";

export function chipView(status: ChipStatus): ChipView {
  if (!status) return "loading";
  if (status.status === "unavailable") return "unavailable";
  return status.actionable === 0 ? "hide" : "alarm";
}

/**
 * growing-tree-flag.ts — staged rollout gate for the procedural growing-tree hero.
 *
 * The tree replaces the Today DailyRing ONLY for the client ids listed here;
 * every other client keeps the DailyRing (unchanged production behaviour).
 * Widen the rollout by adding ids; disable entirely with an empty array.
 */
export const GROWING_TREE_CLIENT_IDS: readonly string[] = [
  "cl-005", // Hariharan Raman — first live account (currently in preview)
  "cl-006", // Geetika Mahendru — mid-plan, for active-state testing
];

/** True when the growing-tree hero should show for this client. */
export function isGrowingTreeEnabled(clientId: string | null | undefined): boolean {
  return !!clientId && GROWING_TREE_CLIENT_IDS.includes(clientId);
}

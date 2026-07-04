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
  "nidhi-jain", // Nidhi Jain — mid-plan
  "cl-019", // Krittika Krishnan — plan just started
];

/** When true, the tree is on for EVERY client (overrides the id list above).
 *  Flip to false to return to the staged, id-gated rollout. */
export const GROWING_TREE_ALL_CLIENTS = true;

/** True when the growing-tree hero should show for this client. */
export function isGrowingTreeEnabled(clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  if (GROWING_TREE_ALL_CLIENTS) return true;
  return GROWING_TREE_CLIENT_IDS.includes(clientId);
}

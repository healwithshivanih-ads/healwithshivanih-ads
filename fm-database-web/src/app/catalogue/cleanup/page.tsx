import { loadCleanupPlanAction } from "./actions";
import { CleanupClient } from "./cleanup-client";

export const dynamic = "force-dynamic";

export default async function CleanupPage() {
  const plan = await loadCleanupPlanAction();
  return <CleanupClient initialPlan={plan} />;
}

import { loadCleanupPlanAction } from "./actions";
import { CleanupClient } from "./cleanup-client";
import { FmAppShell } from "@/components/fm";

export const dynamic = "force-dynamic";

export default async function CleanupPage() {
  const plan = await loadCleanupPlanAction();
  return (
    <FmAppShell
      activeNavId="catalogue"
      crumbs={[
        { label: "Catalogue", href: "/catalogue" },
        { label: "Cleanup" },
      ]}
    >
      <CleanupClient initialPlan={plan} />
    </FmAppShell>
  );
}

/**
 * /plans — legacy v1 plans list, deprecated.
 *
 * The dashboard at /dashboard-v2 surfaces all triage-relevant plan
 * state (follow-ups due, protocol-complete, active, draft). Per-client
 * plan inventory lives at /clients-v2/[id]/plan with an archived-plans
 * disclosure for older drafts/published. Flat global list is no longer
 * a coach surface — redirect to the dashboard.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyPlansListPage() {
  redirect("/dashboard-v2");
}

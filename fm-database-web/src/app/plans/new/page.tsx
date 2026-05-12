/**
 * /plans/new — legacy v1 manual plan creation wizard, deprecated.
 *
 * The v2 flow is: Full Assessment on /clients-v2/[id]/analyse/full
 * generates a draft via AI synthesis. There's no longer a "create
 * blank plan" surface — coach is always working from a session.
 *
 * Redirects to /clients-v2 so coach picks a client first. The v1
 * NewPlanWizard component is preserved in git history.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyPlansNewPage(): never {
  redirect("/clients-v2");
}

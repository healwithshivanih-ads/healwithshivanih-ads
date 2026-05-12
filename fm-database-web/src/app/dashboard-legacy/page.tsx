/**
 * /dashboard-legacy — was the v1 dashboard escape hatch. Now redirects
 * to /dashboard-v2 since v2 has full parity (catalogue commit banner,
 * AiSensy inbox, broadcast panel, triage signals all preserved).
 *
 * The v1 implementation is in git history if we ever need to resurrect.
 */
import { redirect } from "next/navigation";

export default function LegacyDashboardPage(): never {
  redirect("/dashboard-v2");
}

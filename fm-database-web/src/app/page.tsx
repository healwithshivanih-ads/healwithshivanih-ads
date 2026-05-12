/**
 * Root landing route — redirects to the v2 dashboard.
 *
 * The legacy v1 dashboard (was here through 2026-05-12) is preserved at
 * /dashboard-legacy as an escape hatch. Once v2 has full migration
 * coverage, /dashboard-legacy can be deleted.
 */
import { redirect } from "next/navigation";

export default function HomePage(): never {
  redirect("/dashboard-v2");
}

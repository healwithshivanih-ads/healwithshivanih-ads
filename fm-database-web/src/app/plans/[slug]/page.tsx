/**
 * /plans/[slug] — legacy v1 plan editor page, deprecated.
 *
 * Redirects to /clients-v2/[client_id]/plan/edit/[slug] after looking
 * up the plan's client_id. Falls back to /dashboard-v2 if the plan
 * isn't found (was deleted), or to /clients-v2 if the plan has no
 * client_id (shouldn't happen, but defensive).
 *
 * The v1 editor itself (plan-editor.tsx, lifecycle-panel.tsx, etc.)
 * is still imported by the v2 plan-editor route — that's where the
 * editor actually renders now. This file is purely a forwarder.
 */
import { redirect, notFound } from "next/navigation";
import { loadPlanBySlug } from "@/lib/fmdb/loader";

export const dynamic = "force-dynamic";

export default async function LegacyPlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = await loadPlanBySlug(slug);
  if (!plan) notFound();
  if (!plan.client_id) {
    redirect("/clients-v2");
  }
  redirect(`/clients-v2/${plan.client_id}/plan/edit/${slug}`);
}

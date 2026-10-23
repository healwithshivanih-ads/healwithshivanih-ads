/**
 * /clients-v2/[id] — lands on the Brief (2026-10-23).
 *
 * The old overview (56 components on one screen) lives at ./overview as the
 * "More" tab until the coach says which of its widgets she still wants. Every
 * link into a client goes through here, so the first thing she sees is the
 * same brief chat reads. `?tab=plan` (old deep links) → the Plan tab.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClientLanding({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const known: Record<string, string> = {
    plan: "plan",
    protocol: "plan",
    send: "communicate",
    communicate: "communicate",
    sessions: "sessions",
    timeline: "sessions",
    history: "sessions",
    record: "analyse",
    analyse: "analyse",
    overview: "overview",
    more: "overview",
    brief: "brief",
  };
  const target = tab && known[tab] ? known[tab] : "brief";
  redirect(`/clients-v2/${id}/${target}`);
}

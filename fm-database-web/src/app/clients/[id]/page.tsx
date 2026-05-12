/**
 * /clients/[id] — legacy v1 client page, deprecated.
 *
 * Redirects to /clients-v2/[id]. Honours legacy ?tab= query so old
 * deep-links (`?tab=sessions`, `?tab=plan`, `?tab=overview`) land on
 * the equivalent v2 subroute.
 *
 * The 458-line v1 implementation (ClientPageTabs + client-tabs.tsx,
 * 3,000+ lines) is preserved in git history. The v2 client surface
 * (overview / analyse / plan / communicate / sessions / handoff) has
 * full feature parity as of v0.67.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TAB_TO_V2: Record<string, string> = {
  overview: "",
  sessions: "/sessions",
  plan: "/plan",
  // Backwards-compat for very old deep-links
  timeline: "/sessions",
  protocol: "/plan",
  send: "/communicate",
  documents: "/plan",
};

export default async function LegacyClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const v2Suffix = tab && TAB_TO_V2[tab] !== undefined ? TAB_TO_V2[tab] : "";
  redirect(`/clients-v2/${id}${v2Suffix}`);
}

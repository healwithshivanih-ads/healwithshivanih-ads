/**
 * /clients-v2/[id]/timeline — alias redirect to /sessions.
 *
 * The v2 subnav labels this tab "Timeline" (renamed from "Sessions" to
 * disambiguate from the new Analyse-renamed-to-Sessions tab), but the
 * underlying route is still /sessions. Anyone who types the URL based
 * on the visible tab label — or has an old autocomplete suggestion —
 * lands on /timeline. Bounce them to /sessions instead of a 404.
 *
 * Honours ?sid=<session_id> and ?type=<filter> so deep-links survive.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TimelineAliasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sid?: string; type?: string }>;
}) {
  const { id } = await params;
  const { sid, type } = await searchParams;
  const q = new URLSearchParams();
  if (sid) q.set("sid", sid);
  if (type) q.set("type", type);
  const suffix = q.toString();
  redirect(`/clients-v2/${id}/sessions${suffix ? `?${suffix}` : ""}`);
}

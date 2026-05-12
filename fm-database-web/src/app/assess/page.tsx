/**
 * /assess — legacy global assess page, deprecated.
 *
 * v2 replaced this with per-client analyse routes:
 *   /clients-v2/[id]/analyse/full       (Full Assessment)
 *   /clients-v2/[id]/analyse/intake     (Intake)
 *   /clients-v2/[id]/analyse/discovery  (Discovery consultation)
 *   /clients-v2/[id]/analyse/checkin    (Check-in)
 *   /clients-v2/[id]/analyse/quick      (Quick note)
 *
 * The v1 single-page picker + assess flow is gone. If a coach lands here
 * via bookmark, we honour the `?client=<id>` param and bounce to the v2
 * Full Assessment for that client. Without a client param, drop them at
 * /clients-v2 so they pick one.
 *
 * The v1 implementation (131 lines + assess-client.tsx 3000+ lines) is
 * still in git history if we ever need to resurrect it. assess-client.tsx
 * remains because v2's full-form.tsx imports `SuggestionsView` from it.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyAssessPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  if (client) {
    redirect(`/clients-v2/${client}/analyse/full`);
  }
  redirect("/clients-v2");
}

/**
 * /clients — legacy v1 clients list, deprecated.
 *
 * Redirects to /clients-v2 (the v2 list view). Honours legacy ?new=1
 * by bouncing through to the v2 new-client form.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyClientsListPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: isNew } = await searchParams;
  if (isNew) {
    redirect("/clients-v2/new");
  }
  redirect("/clients-v2");
}

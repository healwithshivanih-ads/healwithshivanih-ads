"use server";

/**
 * Server actions for the WhatsApp inbox surface (/messages).
 *
 * Currently a thin wrapper over the existing `markWhatsappInboxRead`
 * loader so the inbox-mark-read-button.tsx client component can call it
 * via the standard "use server" boundary + revalidate the inbox page
 * after a mark so the badge dot disappears in-place.
 */
import { revalidatePath } from "next/cache";
import { markWhatsappInboxRead } from "@/lib/fmdb/loader-extras";

export async function markInboxReadAction(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "clientId required" };
  try {
    await markWhatsappInboxRead(clientId);
    // Revalidate the inbox + the dashboard banner + the client's
    // overview so the unread counts drop in-place after the click.
    revalidatePath("/messages");
    revalidatePath("/dashboard-v2");
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

"use server";

/**
 * Coach-side write for programme feedback: record that a client was asked.
 * The panel's WhatsApp button calls this as it opens the pre-filled chat, so
 * the "Finished" list reads "asked 20 Oct" instead of "not asked" forever.
 */
import { revalidatePath } from "next/cache";
import { recordFeedbackAsk, type FeedbackAskChannel } from "@/lib/fmdb/programme-feedback-loader";

export async function recordFeedbackAskAction(
  clientId: string,
  via: FeedbackAskChannel,
): Promise<{ ok: boolean }> {
  if (via !== "email" && via !== "whatsapp") return { ok: false };
  const ok = await recordFeedbackAsk(clientId, via);
  if (ok) revalidatePath("/dashboard-v2");
  return { ok };
}

"use server";

/**
 * Server actions for the in-app client chat.
 *
 * Shared by every surface that shows the conversation — the coach mobile app
 * (/m), the desktop thread panel, and (from phase 2) the client's own app —
 * so the three can never drift into showing different histories.
 *
 * A coach reply NOTIFIES the client — push where they have granted it, a
 * short WhatsApp nudge where they have not. The outcome comes back to the
 * caller so the UI can say how it was delivered, because "sent" meaning
 * "written to a file nobody was told about" is the failure mode this whole
 * feature has to avoid.
 */
import {
  appendMessage,
  markRead,
  mergeForDisplay,
  readThread,
  unreadCount,
  type ThreadView,
} from "@/lib/fmdb/client-thread";
import { loadWhatsAppThreadAction } from "@/app/api/whatsapp/actions";
import { notifyClientOfCoachReply } from "@/lib/fmdb/chat-notify";
import { clientAppUrl } from "@/lib/fmdb/coach-mobile";
import { loadClientById } from "@/lib/fmdb/loader-extras";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MAX_LEN = 4000;

/**
 * The whole conversation — in-app messages merged with WhatsApp history.
 *
 * WhatsApp is read through its existing loader rather than reimplemented:
 * that parser handles a lot of accumulated shape (multi-message sessions,
 * per-segment direction tags, provenance headers, legacy files) and forking
 * it would guarantee the two views diverge.
 */
export async function loadClientChatAction(
  clientId: string,
  daysBack = 90,
): Promise<{ ok: boolean; messages: ThreadView[]; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, messages: [], error: "bad client id" };
  try {
    const wa = await loadWhatsAppThreadAction(clientId, daysBack);
    return { ok: true, messages: mergeForDisplay(readThread(clientId), wa) };
  } catch (err) {
    // A failure to read WhatsApp history must not hide the in-app thread.
    console.error("[client-chat] whatsapp history failed:", err);
    return { ok: true, messages: mergeForDisplay(readThread(clientId), []) };
  }
}

/** Send a message from the coach to the client, in-app (no per-message cost,
 *  no 24-hour window). */
export async function sendCoachMessageAction(
  clientId: string,
  text: string,
): Promise<{
  ok: boolean;
  error?: string;
  notified?: { channel: "push" | "whatsapp" | "none"; ok: boolean; error?: string };
}> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const body = (text ?? "").trim();
  if (!body) return { ok: false, error: "Message can't be empty." };
  if (body.length > MAX_LEN) return { ok: false, error: "Message is too long." };

  const stored = appendMessage(clientId, { dir: "outbound", kind: "text", text: body });
  if (!stored) return { ok: false, error: "Couldn't save the message." };

  // Delivery is best-effort and reported, never fatal: the message IS stored,
  // and failing the send because a nudge failed would lose the coach's words.
  let notified: Awaited<ReturnType<typeof notifyClientOfCoachReply>> = {
    channel: "none",
    ok: false,
  };
  try {
    const client = (await loadClientById(clientId)) as
      | { mobile_number?: string; app_token?: string }
      | null;
    notified = await notifyClientOfCoachReply(clientId, {
      appUrl: clientAppUrl(client?.app_token) ?? undefined,
      phone: client?.mobile_number ?? null,
      messageId: stored.id,
    });
  } catch (err) {
    console.error("[client-chat] notify failed:", err);
  }

  return { ok: true, notified };
}

/**
 * Record a message FROM the client. Phase 2 calls this from the client app;
 * it lives here now so both directions share one write path and one set of
 * validation rules.
 */
export async function recordClientMessageAction(
  clientId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const body = (text ?? "").trim();
  if (!body) return { ok: false, error: "empty" };
  const stored = appendMessage(clientId, {
    dir: "inbound",
    kind: "text",
    text: body.slice(0, MAX_LEN),
  });
  return stored ? { ok: true } : { ok: false, error: "write failed" };
}

/** Mark the client's messages as read by the coach. */
export async function markChatReadAction(
  clientId: string,
): Promise<{ ok: boolean; marked: number }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, marked: 0 };
  return { ok: true, marked: markRead(clientId, "inbound") };
}

/** How many client messages are waiting on a reply. */
export async function chatUnreadAction(clientId: string): Promise<number> {
  if (!SAFE_ID.test(clientId)) return 0;
  return unreadCount(clientId, "inbound");
}

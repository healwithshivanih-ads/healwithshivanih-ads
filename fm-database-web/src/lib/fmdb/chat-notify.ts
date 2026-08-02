/**
 * Telling the other side a message arrived.
 *
 * THIS IS THE WHOLE FINANCIAL CASE. WhatsApp's value was never its chat UI —
 * it was that a message landed on a screen the client already looks at. An
 * in-app chat with no notification is a chat nobody reads, and the failure is
 * silent: clients simply go quiet and nobody knows why.
 *
 * So: push where the client has granted it (free, unlimited), and a WhatsApp
 * nudge ONLY where they have not (paid, and the thing we are trying to stop
 * paying for). The nudge is one short line rather than the message body —
 * it exists to make them open the app, not to carry the conversation. That
 * also keeps the content out of a channel we are deliberately moving off.
 *
 * At the time of writing 2 of 21 clients have push; 11 more have the app
 * installed and simply have not been asked. Every one of those who says yes
 * removes a paid message per exchange.
 */
import { sendPushToClient } from "./push-server";
import { pushStatus } from "./push-server";

export type NotifyOutcome = {
  channel: "push" | "whatsapp" | "none";
  ok: boolean;
  error?: string;
};

/** One short line. Deliberately NOT the message body: the point is to move
 *  them into the app, and a WhatsApp fallback should not become a second
 *  place the conversation happens. */
function nudgeText(coachName = "Shivani"): string {
  return `${coachName} replied in your app.`;
}

/**
 * Tell a client their coach replied.
 *
 * Push first. Only if push is unavailable or fails do we spend a WhatsApp
 * message — and if neither is possible we say so rather than reporting
 * success, so a silently unreachable client is visible instead of assumed
 * fine.
 */
export async function notifyClientOfCoachReply(
  clientId: string,
  opts: { appUrl?: string; phone?: string | null; coachName?: string } = {},
): Promise<NotifyOutcome> {
  const title = "The Ochre Tree";
  const body = nudgeText(opts.coachName);

  try {
    if ((await pushStatus(clientId)).enabled) {
      const sent = await sendPushToClient(clientId, {
        title,
        body,
        url: opts.appUrl,
        // One tag per client so a second reply REPLACES the first rather than
        // stacking — three notifications for three sentences is why people
        // turn notifications off.
        tag: `chat-${clientId}`,
      });
      if (sent) return { channel: "push", ok: true };
    }
  } catch (e) {
    console.error("[chat-notify] push failed:", e);
  }

  // ── fallback: WhatsApp ──────────────────────────────────────────────────
  const url = (process.env.WHATSAPP_SERVER_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.WHATSAPP_SERVER_API_KEY ?? "";
  const phone = (opts.phone ?? "").trim();
  if (!url || !apiKey || !phone) {
    return { channel: "none", ok: false, error: "no push and no WhatsApp route" };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${url}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          phone,
          type: "text",
          text: `${body}${opts.appUrl ? ` ${opts.appUrl}` : ""}`,
          origin: "api",
          originRef: "chat-nudge",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return { channel: "whatsapp", ok: false, error: `WhatsApp HTTP ${res.status}` };
      }
      // Outside Meta's 24-hour window a free-text send is refused; the server
      // reports that in the body rather than the status.
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (json.ok === false) {
        return { channel: "whatsapp", ok: false, error: json.error ?? "WhatsApp refused" };
      }
      return { channel: "whatsapp", ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { channel: "whatsapp", ok: false, error: (e as Error).message };
  }
}

/**
 * Tell the coach a client wrote.
 *
 * Deliberately a no-op for now. She has no push subscription of her own, and
 * her app already surfaces unread counts on the roster — inventing a second
 * channel before the first one is proven would be noise. The call site exists
 * so this becomes one function to fill in rather than a hunt for every place
 * a client message is stored.
 */
export async function notifyCoachOfClientMessage(clientId: string): Promise<NotifyOutcome> {
  void clientId;
  return { channel: "none", ok: true };
}

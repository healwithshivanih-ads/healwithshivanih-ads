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
import { sendPushToCoach } from "./coach-push";
import { loadClientById } from "./loader-extras";
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
 * Goes to every device she has registered. The notification carries the
 * client's name and the opening of the message, because "you have a message"
 * forces her to open the app to learn whether it can wait — and a
 * notification that cannot be triaged from the lock screen is one she will
 * eventually turn off.
 *
 * Tagged per client so a client sending three lines replaces one notification
 * rather than stacking three.
 */
export async function notifyCoachOfClientMessage(
  clientId: string,
  opts: { clientName?: string; preview?: string } = {},
): Promise<NotifyOutcome> {
  // Resolved here rather than at the call site: every caller has a client id
  // and none of them should have to know how a display name is looked up.
  let who = clientId;
  if (opts.clientName) {
    who = opts.clientName;
  } else {
    try {
      const c = (await loadClientById(clientId)) as { display_name?: string } | null;
      if (c?.display_name) who = c.display_name;
    } catch {
      // Fall back to the id — a notification with a client code still beats
      // no notification.
    }
  }
  who = who.split(" ")[0];
  const preview = (opts.preview || "").replace(/\s+/g, " ").trim();
  try {
    const { sent } = await sendPushToCoach({
      title: who,
      body: preview.length > 120 ? `${preview.slice(0, 117)}…` : preview || "sent you a message",
      url: `/m/clients/${clientId}/chat`,
      tag: `client-${clientId}`,
    });
    // No devices registered is not an error — it is the state before she has
    // turned notifications on, and the roster still shows the unread count.
    return sent > 0
      ? { channel: "push", ok: true }
      : { channel: "none", ok: false, error: "no coach device registered" };
  } catch (e) {
    console.error("[chat-notify] coach push failed:", e);
    return { channel: "none", ok: false, error: (e as Error).message };
  }
}

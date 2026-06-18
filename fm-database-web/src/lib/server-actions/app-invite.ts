"use server";

/**
 * App-invite send (rollout, 2026-06-12).
 *
 * Sends the Meta-approved `fm_app_invite_v1` template with the client's
 * personal /app/<letter_token> link, via the one-call helper that can't
 * skip the chat-thread record (sendAndRecordOutboundAction). The recorded
 * `[template: fm_app_invite_v1] [sent_at: …]` tag is what the dashboard
 * adoption panel reads back as "✓ Invite sent" (persisted state rule).
 */

import { loadAllClients } from "@/lib/fmdb/loader";
import { ensureLetterToken } from "./letter-token";
import { sendAndRecordOutboundAction } from "@/app/api/whatsapp/actions";

// Mirror of the template body in whatsapp-server/scripts/submit-templates.js —
// recordOutbound stores the rendered text so the chat thread shows what
// Meta actually delivered.
function renderInviteBody(firstName: string, url: string): string {
  return (
    `Hi ${firstName}, your plan now lives in your own app — your daily routine, ` +
    `this week's menu, your shopping list and your practices, all in one place ` +
    `and always up to date. Open your personal link below, then choose Add to ` +
    `Home Screen from your browser menu so it stays on your phone like a ` +
    `regular app:\n\n${url}\n\n— Shivani Hari\nYour Functional Health Coach`
  );
}

export async function sendAppInviteAction(
  clientId: string,
  planSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  const tok = await ensureLetterToken(planSlug);
  if (!tok.ok || !tok.token) {
    return { ok: false, error: tok.ok ? "no token" : tok.error };
  }
  return sendAppInviteLinkAction(clientId, tok.token);
}

/**
 * Send the app invite using a specific /app token (the per-client stable
 * app_token, or a plan letter_token — both resolve to /app). The public
 * URL is built server-side from NEXT_PUBLIC_APP_URL so a client-passed
 * value can never leak a localhost link into the WhatsApp message.
 *
 * This is what the per-client "📨 Send via WhatsApp" button on the
 * Communicate tab calls — sending through the brand Cloud-API number via
 * the approved fm_app_invite_v1 template (NOT a wa.me hand-off).
 */
export async function sendAppInviteLinkAction(
  clientId: string,
  appToken: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.WHATSAPP_SERVER_URL) {
    return { ok: false, error: "WhatsApp server not configured" };
  }
  if (!appToken) return { ok: false, error: "no token" };
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!origin) return { ok: false, error: "NEXT_PUBLIC_APP_URL not set" };
  const url = `${origin}/app/${appToken}`;

  const clients = (await loadAllClients()) as {
    client_id?: string;
    display_name?: string;
    mobile_number?: string;
  }[];
  const client = clients.find((c) => c.client_id === clientId);
  if (!client) return { ok: false, error: `client not found: ${clientId}` };
  // Pass the number with its "+"/country code intact — the WA server
  // normalises it (libphonenumber). Stripping non-digits here removes the
  // leading "+", which for an international number (e.g. a US "+1 …") loses
  // the country-code signal and the server then mis-parses it as Indian.
  // See the normalizePhone hardening in whatsapp-server/src/util/phone.js.
  const phone = (client.mobile_number || "").trim();
  if (!phone) return { ok: false, error: "no mobile number on file" };
  const firstName = (client.display_name || clientId).split(" ")[0];

  return sendAndRecordOutboundAction({
    phone,
    clientId,
    templateName: "fm_app_invite_v1",
    templateParams: [firstName, url],
    renderedBody: renderInviteBody(firstName, url),
    opts: { name: client.display_name },
  });
}

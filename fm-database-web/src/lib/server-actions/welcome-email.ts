"use server";

/**
 * Welcome-email send (replaces the retired AI welcome letter).
 * Static, no-API: per-client first name + their /app link, screenshots
 * attached inline (CID). Auto-fires once on first plan publish (see
 * publishPlan) and can be re-sent from the Communicate tab.
 */

import fs from "fs/promises";
import path from "path";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { ensureLetterToken } from "./letter-token";
import {
  sendClientEmailAction,
  recordLetterSendAction,
  loadLetterSendLogAction,
} from "@/app/api/email/actions";
import { recordOutboundMessageAction } from "@/app/api/whatsapp/actions";
import {
  buildWelcomeEmailHtml,
  welcomeEmailSubject,
  WELCOME_SHOTS,
  type WelcomeVariant,
} from "@/lib/welcome-email";

/** Has this client already been onboarded? Reads the send log the welcome
 *  itself writes. The auto-fire on publish checks this so a returning client
 *  — new plan slug, version back to 1 — is never welcomed a second time.
 *  Manual re-sends from the Communicate tab are unaffected: this is only a
 *  guard on the automatic path. */
export async function hasBeenWelcomed(clientId: string): Promise<boolean> {
  if (!clientId) return false;
  const log = await loadLetterSendLogAction(clientId);
  return log.some((e) => (e.letter_types ?? []).includes("welcome"));
}

export async function sendWelcomeEmailAction(
  clientId: string,
  planSlug: string,
  variant: WelcomeVariant = "welcome",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = await loadClientById(clientId);
  if (!client) return { ok: false, error: `client not found: ${clientId}` };
  const to = (client.email || "").trim();
  if (!to) return { ok: false, error: "no email on file for this client" };
  const firstName = (client.display_name || clientId).split(" ")[0];

  // Their real /app link (built server-side from NEXT_PUBLIC_APP_URL).
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!origin) return { ok: false, error: "NEXT_PUBLIC_APP_URL not set" };
  const tok = await ensureLetterToken(planSlug);
  if (!tok.ok || !tok.token) return { ok: false, error: tok.ok ? "no token" : tok.error };
  const appUrl = `${origin}/app/${tok.token}`;

  // Attach the screenshots (CID) from public/welcome/.
  const dir = path.join(process.cwd(), "public", "welcome");
  const attachments: { filename: string; contentBase64: string; mimeType: string; cid: string }[] = [];
  for (const s of WELCOME_SHOTS) {
    try {
      const buf = await fs.readFile(path.join(dir, s.file));
      attachments.push({ filename: s.file, contentBase64: buf.toString("base64"), mimeType: "image/jpeg", cid: s.cid });
    } catch {
      return { ok: false, error: `welcome asset missing: ${s.file}` };
    }
  }

  const res = await sendClientEmailAction({
    to,
    subject: welcomeEmailSubject(firstName, variant),
    htmlBody: buildWelcomeEmailHtml(firstName, appUrl, variant),
    attachments,
  });
  if (!res.ok) return res;

  // Best-effort audit trail (also what the "once on publish" guard reads).
  // Both variants log as "welcome" so a client never gets the auto welcome
  // AND a manual transition note counted as two separate onboardings.
  try {
    await recordLetterSendAction({ clientId, planSlug, letterTypes: ["welcome"], to });
  } catch { /* non-fatal */ }

  // Also log to the communication thread (recordOutboundMessageAction,
  // channel: "email") — the flagship first-touch email was previously
  // invisible in the Communicate tab even though _send_log.yaml tracked
  // that a "welcome" letter type had gone out. That log is metadata only
  // (no subject/body); this is what makes the actual email show up as a
  // bubble in the client's thread, same as every other send.
  try {
    await recordOutboundMessageAction({
      clientId,
      templateName: variant === "welcome" ? "(welcome email)" : `(welcome email: ${variant})`,
      renderedBody: `Subject: ${welcomeEmailSubject(firstName, variant)}\n\n(Welcome email with app link: ${appUrl})`,
      channel: "email",
    });
  } catch { /* non-fatal */ }

  return { ok: true };
}

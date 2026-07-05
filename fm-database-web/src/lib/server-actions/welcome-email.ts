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
import { sendClientEmailAction, recordLetterSendAction } from "@/app/api/email/actions";
import {
  buildWelcomeEmailHtml,
  welcomeEmailSubject,
  WELCOME_SHOTS,
  type WelcomeVariant,
} from "@/lib/welcome-email";

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
  return { ok: true };
}

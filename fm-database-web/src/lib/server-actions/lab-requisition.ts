"use server";

/**
 * Lab requisition — single-page A4 sheet the client hands to Dr Lal /
 * Apollo / Thyrocare / SRL. Coach generates per-plan, then ships via:
 *   - Email (Gmail SMTP) — full HTML body
 *   - WhatsApp — text summary + share via wa.me deep link (no template
 *     approval needed; coach taps Send in their own WhatsApp)
 *   - Download — HTML for Cmd+P → PDF
 *
 * NOT a templated WhatsApp send — those need Meta-approved templates and
 * the lab list is too rich for a 3-param template. Email carries the
 * full HTML; WhatsApp carries a short prose nudge ("I've emailed your
 * fresh requisition") with a deep-link the coach approves and sends.
 */

import { runShim } from "@/lib/fmdb/shim";
import { sendClientEmailAction } from "@/app/api/email/actions";
import { loadClientById } from "@/lib/fmdb/loader-extras";

export interface LabRequisition {
  ok: true;
  markdown: string;
  html: string;
  summary: string; // plain-text short version for WhatsApp share
}
export interface LabRequisitionError {
  ok: false;
  error: string;
}

export async function generateLabRequisitionAction(
  planSlug: string,
  clientId: string,
): Promise<LabRequisition | LabRequisitionError> {
  try {
    const result = (await runShim("render-lab-requisition.py", {
      plan_slug: planSlug,
      client_id: clientId,
    })) as Record<string, unknown>;
    if (!result.ok) {
      return { ok: false, error: (result.error as string) ?? "Render failed" };
    }
    return {
      ok: true,
      markdown: (result.markdown as string) ?? "",
      html: (result.html as string) ?? "",
      summary: (result.summary as string) ?? "",
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Send the requisition as an HTML email via Gmail SMTP. Subject defaults
 * to "Your lab requisition — <date>". The plain-text body is the
 * markdown for clients on text-only mail clients.
 */
export async function emailLabRequisitionAction(input: {
  planSlug: string;
  clientId: string;
  to: string;
  subject?: string;
  intro?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = await generateLabRequisitionAction(input.planSlug, input.clientId);
  if (!req.ok) return req;

  const client = await loadClientById(input.clientId);
  const first =
    typeof client?.display_name === "string"
      ? client.display_name.split(" ")[0]
      : "there";
  const date = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const subject = input.subject ?? `🔬 Your lab requisition — ${date}`;
  const intro =
    input.intro ??
    `Hi ${first},\n\nIt's time for the next round of labs. The sheet below lists what to order — grouped by sample type so all the bloods can be done in one visit, with stool / urine / breath kits collected separately. Hand the printed sheet to Dr Lal / Apollo / Thyrocare / SRL and ask them to share results directly with you.\n\nLet me know once you've booked and we can review the results together.\n\nWarmly,\nShivani`;

  // Compose HTML: intro paragraph above the requisition body. The body
  // is already standalone HTML — we strip its <html><body> wrappers and
  // embed the inner content in the email shell.
  const innerMatch = req.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const innerHtml = innerMatch ? innerMatch[1] : req.html;
  const htmlBody = `
    <div style="font-family: Inter, system-ui, sans-serif; line-height:1.6; color:#2b2d42;">
      <p style="white-space: pre-wrap">${escapeHtml(intro)}</p>
      <hr style="border:0; border-top:1px solid #ddd; margin:24px 0" />
      ${innerHtml}
    </div>
  `.trim();

  return sendClientEmailAction({
    to: input.to,
    subject,
    htmlBody,
    textBody: `${intro}\n\n${req.markdown}`,
  });
}

/** Build the `wa.me/<phone>?text=` deep-link payload — encoded. */
export async function getLabRequisitionWaLinkAction(
  planSlug: string,
  clientId: string,
): Promise<{ ok: true; href: string; text: string } | { ok: false; error: string }> {
  const req = await generateLabRequisitionAction(planSlug, clientId);
  if (!req.ok) return req;

  const client = await loadClientById(clientId);
  const phoneRaw =
    (client as { mobile_number?: string } | null)?.mobile_number ??
    (client as { mobile?: string } | null)?.mobile ??
    "";
  const phone = phoneRaw.replace(/[^0-9]/g, "");
  if (!phone) return { ok: false, error: "Client has no mobile number on file" };
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(req.summary)}`;
  return { ok: true, href, text: req.summary };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

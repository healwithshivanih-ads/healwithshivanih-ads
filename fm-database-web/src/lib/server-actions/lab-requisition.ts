"use server";

/**
 * Lab requisition — single-page A4 sheet the client hands to whichever
 * diagnostic lab she prefers. (Brand-neutral by coach rule — the client
 * picks the lab; we don't push Dr Lal / Apollo / Thyrocare / SRL.)
 * Coach generates per-plan, then ships via:
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
import { loadClientOrders } from "@/lib/fmdb/lab-orders";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import { loadLabCoverage, checkCoverage } from "@/lib/fmdb/lab-coverage";
import { groupsForMarkers } from "@/lib/fmdb/lab-panels";

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
  return _generateLabRequisitionInternal({ planSlug, clientId });
}

/** Discovery-session variant: builds a requisition from the discovery
 *  session's `requested_labs` (a flat list of lab names) instead of a
 *  plan's `lab_orders` (rich {test, reason, kind} objects). Re-uses the
 *  same Python renderer + brand HTML wrapper — just feeds a different
 *  input shape into it. */
export async function generateDiscoveryLabRequisitionAction(
  sessionId: string,
  clientId: string,
): Promise<LabRequisition | LabRequisitionError> {
  return _generateLabRequisitionInternal({ sessionId, clientId });
}

async function _generateLabRequisitionInternal(
  args: { planSlug?: string; sessionId?: string; clientId: string },
): Promise<LabRequisition | LabRequisitionError> {
  try {
    const result = (await runShim("render-lab-requisition.py", {
      ...(args.planSlug ? { plan_slug: args.planSlug } : {}),
      ...(args.sessionId ? { session_id: args.sessionId } : {}),
      client_id: args.clientId,
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
/** Join ["thyroid","blood sugar","iron"] → "thyroid, blood sugar and iron". */
function _joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The two-path discovery email intro: a plain "why", then BOTH ways to get the
 *  labs done — book in-app via "our trusted labs partner" (never named), or use
 *  any lab they like. Path 1 only appears when an app link (token) exists. */
function _discoveryIntro(opts: { first: string; coachName: string; groups: string[]; appUrl: string | null }): string {
  const { first, coachName, groups, appUrl } = opts;
  const why = groups.length
    ? `A quick word on why: these check the systems we talked through — ${_joinAnd(groups)} — so when we meet we're working from real numbers, not guesses.`
    : `A quick word on why: these give us the real numbers behind what we talked through, so when we meet we're not guessing.`;
  const path1 = appUrl
    ? `1. Book through our trusted labs partner right inside your app — they collect the sample from home and the results come straight back to me:\n   ${appUrl}\n\n`
    : "";
  const otherNum = appUrl ? "2" : "1";
  return [
    `Hi ${first},`,
    "",
    "Here's the lab list from our call — grouped by sample type so the bloods can be done in one sitting.",
    "",
    why,
    "",
    appUrl ? "You've got two easy ways to get them done:" : "To get them done:",
    "",
    `${path1}${otherNum}. Or use any diagnostic lab you prefer — just hand them this sheet and ask them to share the results with you (PDF).`,
    "",
    "Once the reports are in, send them over and we'll go through them together.",
    "",
    "Warmly,",
    coachName,
  ].join("\n");
}

export async function emailLabRequisitionAction(input: {
  planSlug?: string;
  sessionId?: string;
  clientId: string;
  to: string;
  subject?: string;
  intro?: string;
  /** Discovery app token — when present, the email offers an in-app booking
   *  path (link to /app/<token>) alongside the DIY path. */
  appToken?: string | null;
  /** Friendly system groups for the "why" line (from the FM panels picked). */
  whyGroups?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = input.sessionId
    ? await generateDiscoveryLabRequisitionAction(input.sessionId, input.clientId)
    : await generateLabRequisitionAction(input.planSlug ?? "", input.clientId);
  if (!req.ok) return req;

  const client = await loadClientById(input.clientId);
  const first =
    typeof client?.display_name === "string"
      ? client.display_name.split(" ")[0]
      : "there";
  const coachName =
    (client?.assigned_coach as string | undefined) ||
    process.env.COACH_NAME ||
    "Shivani";
  const date = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const subject = input.subject ?? `🔬 Your lab requisition — ${date}`;
  // Discovery sends (sessionId) get the two-path intro (book in-app OR own lab) +
  // a plain "why"; plan sends keep the simple own-lab intro. An explicit
  // input.intro always wins.
  const appUrl = input.appToken
    ? `${(process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "")}/app/${input.appToken}`
    : null;
  const intro =
    input.intro ??
    (input.sessionId
      ? _discoveryIntro({ first, coachName, groups: input.whyGroups ?? [], appUrl })
      : `Hi ${first},\n\nHere's the list of labs we discussed. They're grouped by sample type so the bloods can be done in one visit, with stool / urine / breath kits collected separately at home or at the lab.\n\nYou can use whichever diagnostic lab you prefer — just hand them this sheet and ask them to share the results directly with you (PDF). Once the reports are in, send them over and we'll go through them together.\n\nWarmly,\n${coachName}`);

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

  const sent = await sendClientEmailAction({
    to: input.to,
    subject,
    htmlBody,
    textBody: `${intro}\n\n${req.markdown}`,
  });

  // Persist a thread record so the labs-send button can render
  // "✓ Sent X ago · Resend" on next page load (durable rule
  // feedback-send-buttons-persist-state). Logged under the same template
  // name as the WA path so a single scan picks up either channel as
  // "labs sent". Best-effort — never block on audit logging.
  if (sent.ok) {
    try {
      const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
      await recordOutboundMessageAction({
        clientId: input.clientId,
        templateName: "fm_lab_reminder",
        renderedBody: `📧 Emailed lab requisition to ${input.to}\nSubject: ${subject}`,
      });
    } catch { /* never block on audit */ }
  }
  return sent;
}

/**
 * The discovery BOOKING email — matches the app booking exactly. Built from the
 * client's latest recommended Acumen order: it leads with "book + pay in your
 * app" (the package the order covers) and lists ONLY the markers our partner
 * can't run ("for your own lab"). No giant requisition sheet, no second lab
 * list that diverges from what the app books. NEVER names the partner.
 * Two-step flow: the coach recommends a package first, then sends this.
 */
export async function emailLabBookingAction(input: {
  clientId: string;
  to: string;
  /** the discovery call's marker list (requested_labs) — to compute own-lab extras. */
  requestedLabs: string[];
}): Promise<{ ok: true } | { ok: false; error: string; needsRecommend?: boolean }> {
  const orders = await loadClientOrders(input.clientId);
  const order = orders.find((o) => o.status !== "cancelled"); // newest-first; the live one
  if (!order) {
    return { ok: false, error: "Recommend a package first — the email is built from it.", needsRecommend: true };
  }

  const client = await loadClientById(input.clientId);
  const first = typeof client?.display_name === "string" ? client.display_name.split(" ")[0] : "there";
  const coachName = (client?.assigned_coach as string | undefined) || process.env.COACH_NAME || "Shivani";
  const appToken = (client as { app_token?: string } | null)?.app_token;
  const appUrl = appToken
    ? `${(process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "")}/app/${appToken}`
    : null;

  // Own-lab extras = requested markers the chosen package can't cover and the
  // coach didn't add as an add-on (specialty / unmapped / un-added add-ons).
  let ownLab: string[] = [];
  const provider = await loadLabProvider();
  if (provider && Array.isArray(input.requestedLabs) && input.requestedLabs.length) {
    const profile = order.profile_id != null ? provider.profiles.find((p) => p.id === order.profile_id) ?? null : null;
    const cov = checkCoverage(input.requestedLabs, profile, await loadLabCoverage(), provider.addons);
    ownLab = [
      ...cov.notAtAcumen,
      ...cov.unknown,
      ...cov.availableAsAddon.filter((a) => !order.addon_slugs.includes(a.slug)).map((a) => a.marker),
    ];
  }

  const groups = groupsForMarkers(input.requestedLabs ?? []);
  const why = groups.length
    ? `These check the systems we talked through — ${groups.slice(0, -1).join(", ")}${groups.length > 1 ? ` and ${groups[groups.length - 1]}` : groups[0]} — so when we meet we're working from real numbers, not guesses.`
    : `These give us the real numbers behind what we talked through, so when we meet we're not guessing.`;
  const packageName = order.lines[0]?.label ?? "your lab panel";
  const includesLis = (order.includes ?? []).map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const ownLabLis = ownLab.map((m) => `<li>${escapeHtml(m)}</li>`).join("");

  const bookBlock = appUrl
    ? `<div style="background:#e9efe9;border-radius:10px;padding:14px 16px;margin:16px 0;">
         <div style="font-weight:700;color:#4a6152;">✅ Book + pay in your app</div>
         <div style="font-size:13.5px;margin:4px 0 10px;">Home sample collection — and your results come straight back to me.</div>
         <a href="${appUrl}" style="display:inline-block;background:#4a6152;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-weight:700;">Open your app →</a>
         <div style="font-size:13px;margin-top:12px;">This runs your <strong>${escapeHtml(packageName)}</strong>${order.addon_slugs.length ? ` (plus ${order.addon_slugs.length} add-on test${order.addon_slugs.length === 1 ? "" : "s"})` : ""}, covering:</div>
         <ul style="margin:6px 0 0;font-size:13px;">${includesLis}</ul>
       </div>`
    : `<div style="background:#f3e7d3;border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13.5px;">
         I'll send your booking link in a moment so you can book these at home through our trusted labs partner.
       </div>`;

  const ownLabBlock = ownLab.length
    ? `<div style="border:1px solid #e6dfd1;border-radius:10px;padding:14px 16px;">
         <div style="font-weight:700;">📋 A few to do at your own lab</div>
         <div style="font-size:13px;margin:4px 0 8px;color:#6f6a5d;">We don't run these through our partner — take this short note to any diagnostic lab you like and ask them to share the results with you.</div>
         <ul style="margin:0;font-size:13px;">${ownLabLis}</ul>
       </div>`
    : "";

  const htmlBody = `
    <div style="font-family:Inter,system-ui,sans-serif;line-height:1.6;color:#262219;max-width:560px;">
      <p>Hi ${escapeHtml(first)},</p>
      <p>Here are your labs from our call.</p>
      <p style="color:#6f6a5d;">${escapeHtml(why)}</p>
      ${bookBlock}
      ${ownLabBlock}
      <p style="margin-top:16px;">Once everything's in, send the reports over and we'll go through them together.</p>
      <p>Warmly,<br/>${escapeHtml(coachName)}</p>
    </div>`.trim();

  const textLines = [
    `Hi ${first},`,
    "",
    "Here are your labs from our call.",
    "",
    why,
    "",
    appUrl ? `Book + pay in your app (home collection, results to me): ${appUrl}` : "I'll send your booking link in a moment.",
    appUrl ? `This runs your ${packageName}, covering: ${(order.includes ?? []).join("; ")}` : "",
    ownLab.length ? `\nTo do at your own lab (we don't run these): ${ownLab.join(", ")}` : "",
    "",
    "Once everything's in, send the reports over and we'll go through them together.",
    "",
    "Warmly,",
    coachName,
  ].filter((l) => l !== "");

  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const sent = await sendClientEmailAction({
    to: input.to,
    subject: `🔬 Your labs — ${date}`,
    htmlBody,
    textBody: textLines.join("\n"),
  });
  if (sent.ok) {
    try {
      const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
      await recordOutboundMessageAction({
        clientId: input.clientId,
        templateName: "fm_lab_reminder",
        renderedBody: `📧 Emailed lab booking to ${input.to} (${packageName}${ownLab.length ? ` + ${ownLab.length} own-lab` : ""})`,
      });
    } catch { /* never block on audit */ }
  }
  return sent;
}

/** Build the `wa.me/<phone>?text=` deep-link payload — encoded. */
export async function getLabRequisitionWaLinkAction(
  planSlug: string,
  clientId: string,
): Promise<{ ok: true; href: string; text: string } | { ok: false; error: string }> {
  return _getWaLinkInternal({ planSlug, clientId });
}

/** Discovery-session variant of the WhatsApp deep-link. */
export async function getDiscoveryLabRequisitionWaLinkAction(
  sessionId: string,
  clientId: string,
): Promise<{ ok: true; href: string; text: string } | { ok: false; error: string }> {
  return _getWaLinkInternal({ sessionId, clientId });
}

/**
 * Send the discovery lab list via the in-app WhatsApp pipeline (Meta-
 * approved `fm_lab_reminder` template) instead of opening wa.me natively
 * on the coach's phone. Uses the same template approved 2026-05-18.
 *
 * The `{{labs}}` param is a compact summary — panel names + total marker
 * count — to stay well under Meta's per-param length limit. The full
 * sheet still ships via email; this WhatsApp message is the "heads up,
 * check your email" nudge.
 */
export async function sendDiscoveryLabsViaWhatsappAction(input: {
  sessionId?: string;
  planSlug?: string;
  clientId: string;
  /** Optional override for the {{labs}} text. Defaults to a panel summary
   *  built from the underlying lab list. */
  labsLabel?: string;
}): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const { sendWhatsAppAction } = await import("@/app/api/whatsapp/actions");
  const client = await loadClientById(input.clientId);
  if (!client) return { ok: false, error: `Client ${input.clientId} not found` };

  const phoneRaw =
    (client as { mobile_number?: string } | null)?.mobile_number ??
    (client as { mobile?: string } | null)?.mobile ??
    "";
  if (!phoneRaw) return { ok: false, error: "Client has no mobile number on file" };

  const firstName =
    typeof client.display_name === "string"
      ? client.display_name.split(" ")[0]
      : "there";
  const coachName =
    (client?.assigned_coach as string | undefined) ||
    process.env.COACH_NAME ||
    "Shivani";

  // Build a compact {{labs}} param. If caller passed labsLabel use it;
  // otherwise build from the underlying lab list (first ~10 markers
  // + "+N more" so we never exceed Meta's per-param limit).
  let labsLabel = input.labsLabel?.trim() ?? "";
  if (!labsLabel) {
    const req = input.sessionId
      ? await generateDiscoveryLabRequisitionAction(input.sessionId, input.clientId)
      : await generateLabRequisitionAction(input.planSlug ?? "", input.clientId);
    if (!req.ok) return req;
    // Extract bullet lines from markdown — robust to header changes.
    const labLines = req.markdown
      .split(/\n+/)
      .filter((l) => /^- \*\*/.test(l))
      .map((l) => l.replace(/^- \*\*([^*]+)\*\*.*$/, "$1").trim())
      .filter(Boolean);
    if (labLines.length === 0) {
      labsLabel = "lab list (full sheet emailed separately)";
    } else if (labLines.length <= 6) {
      labsLabel = labLines.join(", ");
    } else {
      labsLabel = `${labLines.slice(0, 6).join(", ")} + ${labLines.length - 6} more (full list in the email)`;
    }
  }
  // Hard guard — keep well under Meta's 1024-char param limit.
  if (labsLabel.length > 700) labsLabel = labsLabel.slice(0, 690) + "…";

  const res = await sendWhatsAppAction(phoneRaw, "fm_lab_reminder", [firstName, labsLabel]);
  if (!res.ok) return { ok: false, error: res.error ?? "WhatsApp send failed" };

  // Persist a thread record (durable rule feedback-send-buttons-persist-state).
  // Renders both in the WhatsApp chat panel AND lets the labs button
  // show "✓ Sent X ago · Resend" on next page load. Best-effort.
  try {
    const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
    const body =
      `Hi ${firstName}, a gentle reminder to get your labs done before our next session. ` +
      `Here are the tests we discussed: ${labsLabel}. ` +
      `Please share the report at least 2 days before our appointment. 🙏\n\n— ${coachName}\nYour Functional Health Coach`;
    await recordOutboundMessageAction({
      clientId: input.clientId,
      templateName: "fm_lab_reminder",
      renderedBody: body,
    });
  } catch { /* never block on audit */ }
  return { ok: true, sentTo: phoneRaw };
}

async function _getWaLinkInternal(
  args: { planSlug?: string; sessionId?: string; clientId: string },
): Promise<{ ok: true; href: string; text: string } | { ok: false; error: string }> {
  const req = args.sessionId
    ? await generateDiscoveryLabRequisitionAction(args.sessionId, args.clientId)
    : await generateLabRequisitionAction(args.planSlug ?? "", args.clientId);
  if (!req.ok) return req;

  const client = await loadClientById(args.clientId);
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

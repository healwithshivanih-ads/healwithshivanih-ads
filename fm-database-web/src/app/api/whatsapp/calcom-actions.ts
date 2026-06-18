"use server";

/**
 * Cal.com booking links surfaced in the Communicate page's "📅 Send
 * booking link" button. Two server actions:
 *
 *   loadCalcomLinksAction()
 *     Reads ~/fm-plans/_calcom_links.yaml. Returns the configured event
 *     types (slug / label / emoji / url / default_body). Hot-reloaded on
 *     every call — coach edits the file, refreshes the page, picker
 *     updates. No deploy needed.
 *
 *   sendCalcomLinkAction(clientId, slug, customBody?)
 *     Sends a free-text WhatsApp via the self-hosted Cloud API server,
 *     piggybacking on the existing sendWhatsAppTextAction. Requires the
 *     24-hour conversation window to be open (client has messaged in
 *     within last 24h) — Meta won't accept free-text outside that
 *     window. The send action returns the right error if it's closed
 *     so the UI can fall back to wa.me.
 *
 *     `customBody` (optional) lets coach edit the default body in the
 *     UI before sending. Falls back to default_body interpolated with
 *     {{name}} and {{url}} if omitted.
 *
 * Audit: every successful send is logged as a session via
 * recordOutboundMessageAction (template name = "calcom:<slug>" so the
 * WhatsApp thread shows which event type was sent) AND appended to
 * ~/fm-plans/_calcom_send_log.yaml for a cleaner trail.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { sendWhatsAppTextAction, recordOutboundMessageAction } from "./actions";
import { renderCalcomBody, type CalcomLink } from "./calcom-types";

const LINKS_FILE_NAME = "_calcom_links.yaml";
const SEND_LOG_FILE_NAME = "_calcom_send_log.yaml";

/**
 * Default list seeded into the file the first time coach hits the
 * picker on a fresh setup. Kept in sync with the canonical example in
 * the YAML's leading comment. Coach can edit the file freely; only
 * triggered when the file is missing.
 */
const DEFAULT_LINKS: CalcomLink[] = [
  {
    slug: "programme-intake",
    label: "Programme intake session",
    emoji: "🌿",
    url: "https://cal.com/shivani-hariharan-0xyy3l/programme-intake-session",
    default_body:
      "Hi {{name}}, ready to book your programme intake session? Pick a slot that works for you:\n\n{{url}}",
  },
];

export async function loadCalcomLinksAction(): Promise<CalcomLink[]> {
  const root = getPlansRoot();
  const filePath = path.join(root, LINKS_FILE_NAME);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) {
      // Defensive — drop entries missing required fields rather than
      // throw. Coach editing the file shouldn't crash the picker.
      return parsed
        .filter(
          (x): x is CalcomLink =>
            x != null &&
            typeof x === "object" &&
            typeof (x as CalcomLink).slug === "string" &&
            typeof (x as CalcomLink).url === "string",
        )
        .map((x) => ({
          slug: x.slug,
          label: x.label || x.slug,
          tagline: x.tagline,
          emoji: x.emoji || "📅",
          url: x.url,
          template_param_url: x.template_param_url || x.url,
          default_body: x.default_body || "",
        }));
    }
  } catch {
    /* missing or unparseable — seed defaults below */
  }
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, yaml.dump(DEFAULT_LINKS, { lineWidth: 120 }), "utf-8");
  } catch {
    /* read-only fs etc. */
  }
  return DEFAULT_LINKS;
}

export async function sendCalcomLinkAction(
  clientId: string,
  slug: string,
  /** Final body to send. If empty the action renders default_body. */
  customBody?: string,
): Promise<{ ok: true; rendered: string } | { ok: false; error: string }> {
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const c = clients.find((x) => x.client_id === clientId);
  if (!c) return { ok: false, error: `Client ${clientId} not found` };

  const phone = (c.mobile_number as string | undefined)?.trim() ?? "";
  if (!phone) return { ok: false, error: "No mobile number on file" };

  const displayName = (c.display_name as string | undefined) ?? "";
  const firstName = displayName.split(" ")[0] || "there";

  const links = await loadCalcomLinksAction();
  const link = links.find((l) => l.slug === slug);
  if (!link) return { ok: false, error: `Unknown booking link slug: ${slug}` };

  const body = (customBody ?? "").trim() || renderCalcomBody(link, firstName);

  // Free-text send via the 24h conversation window. If the window is
  // closed, Meta returns code 131047 and sendWhatsAppTextAction bubbles
  // up a recognisable error string — the UI surfaces a wa.me fallback.
  const res = await sendWhatsAppTextAction(phone, body);
  if (!res.ok) return { ok: false, error: res.error || "Send failed" };

  // Log to per-client session timeline so the WhatsApp thread renders
  // this outbound bubble. Best-effort — failure here doesn't roll back
  // the WhatsApp send (already delivered to Meta).
  try {
    await recordOutboundMessageAction({
      clientId,
      templateName: `calcom:${slug}`,
      renderedBody: body,
    });
  } catch {
    /* silent — thread view will just be missing this entry */
  }

  // Side audit log — easier to grep than the per-client session dirs.
  try {
    const root = getPlansRoot();
    const logFile = path.join(root, SEND_LOG_FILE_NAME);
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(logFile, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      /* fresh log */
    }
    existing.push({
      sent_at: new Date().toISOString(),
      client_id: clientId,
      display_name: displayName,
      slug,
      url: link.url,
      body_preview: body.slice(0, 200),
    });
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(logFile, yaml.dump(existing, { lineWidth: 140 }), "utf-8");
  } catch {
    /* non-fatal */
  }

  return { ok: true, rendered: body };
}

/**
 * Template-send variant — uses the approved Meta template `fm_book_session_v1`
 * (params: name, url). Works OUTSIDE the 24-hour conversation window
 * (template sends don't need a recent inbound). Default path for the
 * one-click booking buttons.
 *
 * Body Meta has approved:
 *   "Hi {{1}}, ready to book your next session? You can grab a time
 *    that works for you here: {{2}} — Shivani Hari / Your Functional
 *    Health Coach"
 *
 * Use sendCalcomLinkAction (free-text) only when coach wants to
 * customise the body — that's the "✏️ customise" disclosure in the UI.
 */
export async function sendCalcomLinkTemplateAction(
  clientId: string,
  slug: string,
): Promise<{ ok: true; rendered: string } | { ok: false; error: string }> {
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const { sendWhatsAppAction } = await import("./actions");

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const c = clients.find((x) => x.client_id === clientId);
  if (!c) return { ok: false, error: `Client ${clientId} not found` };

  const phone = (c.mobile_number as string | undefined)?.trim() ?? "";
  if (!phone) return { ok: false, error: "No mobile number on file" };

  const displayName = (c.display_name as string | undefined) ?? "";
  const firstName = displayName.split(" ")[0] || "there";

  const links = await loadCalcomLinksAction();
  const link = links.find((l) => l.slug === slug);
  if (!link) return { ok: false, error: `Unknown booking link slug: ${slug}` };

  const url = link.template_param_url || link.url;
  // Body MUST mirror the Meta-approved fm_book_session_v2 wording (neutral
  // service-notification phrasing), since that is what the client actually
  // receives. v1 ("ready to book your next session?" + warm CTA) was
  // re-categorised MARKETING by Meta → throttled to cold contacts (err
  // 131049). v2 is UTILITY (same params) and delivers regardless of the
  // 24h window or engagement state.
  const renderedBody =
    `Hi ${firstName}, here is the link to schedule your next session:\n\n${url}\n\n` +
    `Pick a time that works for you. Reply here if you cannot find a slot that suits, and I will add availability.\n\n` +
    `— ${process.env.COACH_NAME || "Shivani Hari"}\nYour Functional Health Coach`;

  const res = await sendWhatsAppAction(phone, "fm_book_session_v2", [firstName, url]);
  if (!res.ok) return { ok: false, error: res.error || "Send failed" };

  try {
    await recordOutboundMessageAction({
      clientId,
      templateName: `fm_book_session_v2:${slug}`,
      renderedBody,
    });
  } catch {
    /* silent */
  }

  try {
    const root = getPlansRoot();
    const logFile = path.join(root, SEND_LOG_FILE_NAME);
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(logFile, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      /* fresh log */
    }
    existing.push({
      sent_at: new Date().toISOString(),
      client_id: clientId,
      display_name: displayName,
      slug,
      send_via: "template:fm_book_session_v2",
      url,
      body_preview: renderedBody.slice(0, 200),
    });
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(logFile, yaml.dump(existing, { lineWidth: 140 }), "utf-8");
  } catch {
    /* non-fatal */
  }

  return { ok: true, rendered: renderedBody };
}

/**
 * Bulk-send booking links — used by the dashboard's "📅 Time to schedule"
 * panel. Coach reviews a list of overdue clients (each with a pre-picked
 * recommended event type, overridable per row) and fires sends in one
 * batch.
 *
 * Each row is sent INDEPENDENTLY via sendCalcomLinkTemplateAction —
 * one failure doesn't abort the rest. Returns per-row results so the UI
 * can show ✓ / ✗ chips.
 *
 * Safe-by-default rules baked in here:
 *   - Skips rows missing client_id or slug.
 *   - 250ms throttle between sends so the WA server isn't hammered
 *     (Fly app is small; coach broadcasts to ~5 clients today, but the
 *     throttle scales fine for 20-30 batches in future).
 */
export async function sendBookingLinkBulkAction(
  rows: Array<{ clientId: string; slug: string }>,
): Promise<{
  ok: boolean;
  results: Array<{
    clientId: string;
    slug: string;
    ok: boolean;
    error?: string;
  }>;
  summary: { sent: number; failed: number };
}> {
  const results: Array<{
    clientId: string;
    slug: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const row of rows) {
    if (!row.clientId || !row.slug) {
      results.push({
        clientId: row.clientId || "?",
        slug: row.slug || "?",
        ok: false,
        error: "Missing clientId or slug",
      });
      continue;
    }
    try {
      const r = await sendCalcomLinkTemplateAction(row.clientId, row.slug);
      results.push({
        clientId: row.clientId,
        slug: row.slug,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
      });
    } catch (e) {
      results.push({
        clientId: row.clientId,
        slug: row.slug,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Light throttle between sends
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return { ok: failed === 0, results, summary: { sent, failed } };
}

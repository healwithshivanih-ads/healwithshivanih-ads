"use server";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getActivePlanSlugForClient } from "@/lib/fmdb/active-plan-slug";

const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");

// ── Backend: self-hosted WhatsApp Cloud API server only ──────────────────────
// AiSensy backend removed 2026-05-15 — fully decommissioned in favour of the
// self-hosted WA server (Fly app: whatsapp-server-shivani). Single source of
// truth for outbound WhatsApp across fm-coach + ochre-followup. AISENSY_*
// env vars on Fly secrets are safe to delete after deploy.

const WA_SERVER_URL = (process.env.WHATSAPP_SERVER_URL ?? "").replace(/\/$/, "");
const WA_SERVER_API_KEY = process.env.WHATSAPP_SERVER_API_KEY ?? "";

function isWhatsappConfigured(): boolean {
  return !!(WA_SERVER_URL && WA_SERVER_API_KEY);
}

// normaliseToE164 removed 2026-05-15 — only used by the removed AiSensy
// backend. The WA server accepts the phone string as-is and handles
// normalisation server-side.

// ── Single send ───────────────────────────────────────────────────────────────

/**
 * Send a templated WhatsApp message via the self-hosted WhatsApp Cloud API
 * server. `campaignName` is the Meta-approved template name (parameter name
 * kept for back-compat with existing call sites).
 */
export async function sendWhatsAppAction(
  phone: string,
  campaignName: string,
  templateParams: string[],
  opts?: { name?: string; templateLanguage?: string }
): Promise<{ ok: boolean; error?: string; backend?: "wa_server" }> {
  if (!phone?.trim()) return { ok: false, error: "Phone number required" };

  if (!isWhatsappConfigured()) {
    return {
      ok: false,
      error:
        "WhatsApp not configured. Set WHATSAPP_SERVER_URL and WHATSAPP_SERVER_API_KEY in .env.local.",
    };
  }

  return sendViaWaServer(phone, campaignName, templateParams, opts);
}

async function sendViaWaServer(
  phone: string,
  templateName: string,
  templateParams: string[],
  opts?: { name?: string; templateLanguage?: string }
): Promise<{ ok: boolean; error?: string; backend: "wa_server" }> {
  const body = {
    phone,
    name: opts?.name,
    type: "template",
    templateName,
    templateLanguage: opts?.templateLanguage ?? "en",
    templateParams,
    origin: "api",
    originRef: "fm-coach",
  };

  try {
    const res = await fetch(`${WA_SERVER_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": WA_SERVER_API_KEY },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
    };

    if (!res.ok || json.ok === false) {
      const detail = json.error ?? `HTTP ${res.status}`;
      const code = json.code ? ` [${json.code}]` : "";
      return { ok: false, error: `WhatsApp server${code}: ${detail}`, backend: "wa_server" };
    }
    return { ok: true, backend: "wa_server" };
  } catch (err) {
    const e = err as { message?: string };
    return {
      ok: false,
      error: e.message ?? "Network error calling WhatsApp server",
      backend: "wa_server",
    };
  }
}

// sendViaAisensy removed 2026-05-15. AiSensy fully decommissioned.

// ── Free-text send (within Meta's 24-hour conversation window) ───────────────
//
// Meta WhatsApp Cloud API allows free-form text WITHOUT a template, BUT
// only within 24 hours of the client's last inbound message. Outside
// that window only approved templates work — the WA server returns an
// error code in that case which we surface as-is.
//
// Used by the WhatsAppThreadPanel reply box.

export async function sendWhatsAppTextAction(
  phone: string,
  text: string,
  opts?: { name?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!phone?.trim()) return { ok: false, error: "Phone number required" };
  if (!text?.trim()) return { ok: false, error: "Message text required" };
  if (!isWhatsappConfigured()) {
    return {
      ok: false,
      error: "WhatsApp not configured. Set WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY in .env.local.",
    };
  }
  const body = {
    phone,
    name: opts?.name,
    type: "text",
    text: text.trim(),
    origin: "api",
    originRef: "fm-coach",
  };
  try {
    const res = await fetch(`${WA_SERVER_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": WA_SERVER_API_KEY },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
    };
    if (!res.ok || json.ok === false) {
      const detail = json.error ?? `HTTP ${res.status}`;
      const code = json.code ? ` [${json.code}]` : "";
      // Meta returns error 131047 "re-engagement message" when outside
      // the 24-hour window — surface that clearly so coach knows to
      // use a template instead.
      const friendly =
        json.code === "131047" || /re-engagement|24.hour/i.test(detail)
          ? "24-hour reply window closed — use an approved template to start a fresh conversation."
          : `WhatsApp server${code}: ${detail}`;
      return { ok: false, error: friendly };
    }
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Network error calling WhatsApp server" };
  }
}

// ── Outbound logging (for chat-thread view) ──────────────────────────────────
//
// When a coach sends via the message-templates panel, log the rendered
// message body to the client's sessions/ as a quick_note tagged
// `[source: whatsapp_outbound]`. Mirrors the inbound write pattern in
// /api/whatsapp-webhook (which tags `[source: whatsapp_webhook]`).
// Combined later by loadWhatsAppThread() → chat-bubble UI.

import { execFile } from "node:child_process";

const FMDB_REPO = path.resolve(process.cwd(), "..", "fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

export async function recordOutboundMessageAction(input: {
  clientId: string;
  templateName: string;       // e.g. "fm_encouragement" — or "(free-text reply)" for raw sends within 24h window
  renderedBody: string;       // the message with {{vars}} filled in
}): Promise<{ ok: boolean; session_id?: string; error?: string }> {
  if (!input.clientId || !input.renderedBody) {
    return { ok: false, error: "clientId + renderedBody required" };
  }
  // Free-text replies use a sentinel templateName so the chat-thread
  // loader can render them WITHOUT a template chip (just the prose).
  const isFreeText = input.templateName === "(free-text reply)";
  // Per-segment send timestamp. WITHOUT this, an appended outbound
  // segment inherits the parent session's created_at — so a message
  // sent today, appended into a session created N days ago, renders in
  // the chat thread with the OLD date and looks like it never sent.
  // loadWhatsAppThreadAction parses this `[sent_at: ISO]` tag.
  const sentAtTag = `[sent_at: ${new Date().toISOString()}]`;
  const tags = isFreeText
    ? `[source: whatsapp_outbound] [type: text] ${sentAtTag}`
    : `[source: whatsapp_outbound] [template: ${input.templateName}] ${sentAtTag}`;
  // Per-plan rollup: every WhatsApp message (in OR out) during a
  // published plan's lifetime accumulates in ONE session tagged
  // `[plan: <slug>]`. Plan supersede → next message starts a new
  // session. Pre-programme clients accumulate under `[plan: prospect]`.
  // Static import — was a dynamic await import() which hit ChunkLoadError
  // intermittently after rebuilds (Next 16 turbopack chunk-hash mismatch
  // when PM2 holds a reference across the build). That threw, BOTH call
  // sites swallowed silently → message went out fine but never landed in
  // the rolling thread (durable bug surfaced 2026-05-24).
  const { marker } = await getActivePlanSlugForClient(input.clientId);
  const presenting = `${marker} ${tags}\n\n${input.renderedBody}`;
  const payload = JSON.stringify({
    client_id: input.clientId,
    session_type: "quick_note",
    presenting_complaints: presenting,
    // Marker = [plan: <slug>] [window: <ISO>] — window rotates every
    // 28 days so files cap at ~28 days of chat. See active-plan-slug.ts.
    append_if_today_match: marker,
    match_anywhere: true,
  });

  return new Promise((resolve) => {
    const child = execFile(
      PYTHON,
      [path.join(SCRIPTS_DIR, "save-session.py")],
      { cwd: FMDB_REPO, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    child.stdin?.end(payload);

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", () => {
      if (!stdout.trim()) {
        resolve({ ok: false, error: `save-session produced no output. stderr: ${stderr.slice(0, 400)}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as { ok: boolean; session_id?: string; error?: string });
      } catch (e) {
        resolve({ ok: false, error: `parse error: ${(e as Error).message}` });
      }
    });
  });
}

// ── Atomic send + record ─────────────────────────────────────────────────────
//
// THE durable bug: many callsites call sendWhatsAppAction() and forget to
// also call recordOutboundMessageAction() — the message goes out fine but
// never appears in the client's chat panel, looking like a failed send.
// Bit us on the booking link, intake invite (Nidhi), intake invite again
// (Deepti cl-011), and the 6 files this helper now covers: start-date
// reminders, cycle date collector, weekly poll, handover welcome, intake
// reminder cron, cal.com appointment confirmation.
//
// This helper does both in one call so a future site CAN'T skip the
// record half. The record-failure is logged to console.error (not silently
// swallowed) so when a Python shim crashes or save-session times out, the
// gap is visible in pm2 logs instead of accumulating invisibly on disk.
//
// Callers MUST provide `clientId` + `renderedBody` (the message body Meta
// actually sent, with template vars filled in). If a caller can't easily
// know clientId at the send site (e.g. cron job iterating a list), still
// call this — `clientId: ""` will skip the record half cleanly with a
// warn, NOT silently. That makes the audit gap visible.

export async function sendAndRecordOutboundAction(input: {
  phone: string;
  clientId: string;            // "" allowed but logged as a warning
  templateName: string;        // Meta template name
  templateParams: string[];    // params to fill {{1}}, {{2}}, ...
  renderedBody: string;        // the message text with vars substituted, exactly as Meta rendered
  opts?: { name?: string; templateLanguage?: string };
}): Promise<{ ok: boolean; error?: string; recorded?: boolean }> {
  const send = await sendWhatsAppAction(
    input.phone,
    input.templateName,
    input.templateParams,
    input.opts,
  );
  if (!send.ok) {
    return { ok: false, error: send.error, recorded: false };
  }
  if (!input.clientId) {
    console.warn(
      `[whatsapp] send succeeded but clientId empty — chat thread will not show this ${input.templateName} message (phone: ${input.phone.slice(0, 7)}…)`,
    );
    return { ok: true, recorded: false };
  }
  try {
    const rec = await recordOutboundMessageAction({
      clientId: input.clientId,
      templateName: input.templateName,
      renderedBody: input.renderedBody,
    });
    if (!rec.ok) {
      console.error(
        `[whatsapp] WA send OK but record failed for ${input.clientId} (${input.templateName}): ${rec.error}`,
      );
      return { ok: true, recorded: false, error: `recorded=false: ${rec.error}` };
    }
    return { ok: true, recorded: true };
  } catch (e) {
    console.error(
      `[whatsapp] WA send OK but record threw for ${input.clientId} (${input.templateName}): ${(e as Error).message}`,
    );
    return { ok: true, recorded: false, error: `recorded=false: ${(e as Error).message}` };
  }
}

// ── Chat thread loader (combines inbound + outbound for a client) ────────────

export interface ChatThreadMessage {
  direction: "outbound" | "inbound";
  date: string;                 // ISO timestamp (date or full)
  text: string;                 // the message body (tags stripped)
  template_name?: string;       // only for outbound — the Meta template used
  session_id?: string;
}

export async function loadWhatsAppThreadAction(
  clientId: string,
  daysBack = 90,
): Promise<ChatThreadMessage[]> {
  const dir = path.join(PLANS_ROOT, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const messages: ChatThreadMessage[] = [];
  for (const name of names) {
    if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) continue;
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const complaints = String(data?.presenting_complaints ?? "");
      if (!complaints.includes("[source: whatsapp_")) continue;

      // Sessions may now contain MULTIPLE messages (inbound + outbound
      // interleaved chronologically, separated by `---`). Split per
      // segment and emit one ChatThreadMessage per chunk, with direction
      // resolved from the segment's own [source: whatsapp_*] tag. Falls
      // back to the previous segment's direction if a chunk has no tag
      // (legacy single-message sessions still work).
      const segments = complaints.split(/\n\s*---\s*\n/);
      const sessionDate = String(data?.created_at ?? data?.date ?? "").trim();
      const sessionId = data?.session_id as string | undefined;

      // Sub-second offsets per segment within the same session, so
      // chronological sort orders segments by their position in the
      // file when they share the parent session's timestamp.
      segments.forEach((segment, idx) => {
        const seg = segment.trim();
        if (!seg) return;
        const segInbound = seg.includes("[source: whatsapp_webhook]");
        const segOutbound = seg.includes("[source: whatsapp_outbound]");
        // If no direction tag, fall back to whichever tag appears first
        // in the whole session (covers very-old sessions with the tag
        // only at the top).
        let direction: "inbound" | "outbound";
        if (segInbound) direction = "inbound";
        else if (segOutbound) direction = "outbound";
        else {
          const firstInbound = complaints.indexOf("[source: whatsapp_webhook]");
          const firstOutbound = complaints.indexOf("[source: whatsapp_outbound]");
          direction =
            firstInbound !== -1 &&
            (firstOutbound === -1 || firstInbound < firstOutbound)
              ? "inbound"
              : "outbound";
        }

        const tplMatch = seg.match(/\[template:\s*([^\]]+)\]/);
        const templateName = tplMatch ? tplMatch[1].trim() : undefined;

        // Strip all internal-metadata tags from the display text.
        let text = seg
          .replace(/\[session_type:[^\]]+\]/gi, "")
          .replace(/\[source:[^\]]+\]/gi, "")
          .replace(/\[template:[^\]]+\]/gi, "")
          .replace(/\[type:[^\]]+\]/gi, "")
          .replace(/\[plan:[^\]]+\]/gi, "")
          .replace(/\[window:[^\]]+\]/gi, "")
          .replace(/\[sent_at:[^\]]+\]/gi, "")
          .trim();

        // ── Inbound: strip the webhook's metadata header ──────────────
        // The /api/whatsapp-webhook route prepends two provenance lines
        // to every inbound message body:
        //   WhatsApp message from <name> (<phone>)
        //   Received: <D/M/YYYY, H:MM:SS am/pm>
        // Those belong in the session file as provenance, but in the
        // chat-bubble view they bury the actual message — a one-word
        // reply like "🙏 thx" renders as a wall of metadata and looks
        // like noise. The bubble is already left-aligned + grey (= the
        // client), so the sender line is redundant; the timestamp is
        // shown separately under the bubble. Keep only the real body.
        if (direction === "inbound") {
          text = text
            .replace(/^\s*WhatsApp message from[^\n]*\n?/i, "")
            .replace(/^\s*Received:[^\n]*\n?/i, "")
            .trim();
        }
        if (!text) return;

        // ── Per-segment timestamp ────────────────────────────────────
        // A session file accumulates many messages over its 28-day
        // window. Each appended `---` segment must carry its OWN
        // timestamp, otherwise everything inherits the session's
        // created_at and a message sent today shows the session's old
        // date. Resolution order:
        //   1. Outbound — `[sent_at: ISO]` tag (added at record time).
        //   2. Inbound  — the `Received: D/M/YYYY, H:MM:SS am/pm` line
        //                 the webhook embeds in the message body.
        //   3. Fallback — session created_at + 1ms×idx (legacy segments
        //                 written before this tag existed).
        let segDate: string;
        const sentAtMatch = seg.match(/\[sent_at:\s*([^\]]+)\]/i);
        const recvMatch = seg.match(
          /Received:\s*(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?/i,
        );
        if (sentAtMatch) {
          const ms = Date.parse(sentAtMatch[1].trim());
          segDate = !Number.isNaN(ms)
            ? new Date(ms).toISOString()
            : sessionDate;
        } else if (recvMatch) {
          // D/M/YYYY local time (IST) — webhook writes day-first.
          let hh = parseInt(recvMatch[4], 10);
          const ampm = (recvMatch[7] ?? "").toLowerCase();
          if (ampm === "pm" && hh < 12) hh += 12;
          if (ampm === "am" && hh === 12) hh = 0;
          const day = recvMatch[1].padStart(2, "0");
          const mon = recvMatch[2].padStart(2, "0");
          const yr = recvMatch[3];
          // Treat as IST (+05:30) — the webhook formats in IST.
          const iso = `${yr}-${mon}-${day}T${String(hh).padStart(2, "0")}:${recvMatch[5]}:${recvMatch[6]}+05:30`;
          const ms = Date.parse(iso);
          segDate = !Number.isNaN(ms)
            ? new Date(ms).toISOString()
            : sessionDate;
        } else {
          const baseMs = Date.parse(sessionDate);
          segDate = !Number.isNaN(baseMs)
            ? new Date(baseMs + idx).toISOString()
            : sessionDate;
        }

        messages.push({
          direction,
          date: segDate,
          text,
          template_name: templateName,
          session_id: sessionId,
        });
      });
    } catch {
      // ignore unparseable session
    }
  }

  // Chronological — oldest first, so the bubble view feels like a chat
  messages.sort((a, b) => a.date.localeCompare(b.date));
  return messages;
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

export async function broadcastAction(
  clientIds: string[],
  campaignName: string,
  templateParams: string[]
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  let failed = 0;

  const allClients = await loadAllClients();
  const clientMap = new Map(
    (allClients as Array<Record<string, unknown>>).map((c) => [
      c.client_id as string,
      {
        phone: c.mobile_number as string | undefined,
        name: c.display_name as string | undefined,
      },
    ])
  );

  for (const clientId of clientIds) {
    const entry = clientMap.get(clientId);
    if (!entry?.phone?.trim()) {
      errors.push(`${clientId}: no mobile number on file`);
      failed++;
      continue;
    }

    const result = await sendWhatsAppAction(entry.phone, campaignName, templateParams, {
      name: entry.name,
    });
    if (result.ok) {
      sent++;
      // Persist a thread record per success so each client's WhatsApp
      // panel + per-client "✓ Sent X ago" badges reflect the broadcast.
      // Without this, bulk broadcasts are invisible in client threads
      // and there's no per-client "did the broadcast actually reach
      // them" signal — coach rule feedback-send-buttons-persist-state.
      try {
        const renderedBody = `[broadcast: ${campaignName}] params=[${templateParams.join(" | ")}]`;
        await recordOutboundMessageAction({
          clientId,
          templateName: campaignName,
          renderedBody,
        });
      } catch { /* never block on audit */ }
    } else {
      errors.push(`${clientId}: ${result.error}`);
      failed++;
    }
  }

  return { sent, failed, errors };
}

// ── Check-in nudge ────────────────────────────────────────────────────────────

/**
 * sendCheckinNudgeAction — sends the fm_checkin_nudge WhatsApp template to a
 * client from the dashboard "Check-in needed" triage card. Loads the client's
 * name + phone from their YAML and records the outbound message.
 */
export async function sendCheckinNudgeAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { loadClientById } = await import("@/lib/fmdb/loader-extras");
  const client = await loadClientById(clientId).catch(() => null);
  if (!client) return { ok: false, error: "Client not found" };

  const phone = (client as Record<string, unknown>).mobile_number as string | undefined;
  if (!phone?.trim()) return { ok: false, error: "No mobile number on file for this client" };

  const firstName =
    ((client as Record<string, unknown>).display_name as string | undefined)
      ?.split(" ")[0] ?? "there";

  // fm_checkin_nudge template params: {{1}} = name, {{2}} = symptom (optional — use "your symptoms")
  const result = await sendWhatsAppAction(phone, "fm_checkin_nudge", [firstName, "your symptoms"], {
    name: firstName,
  });
  if (!result.ok) return result;

  const nudgeBody = `Hi ${firstName}, just checking in! How are you feeling on the protocol? Any changes in your symptoms? Would love to hear how things are going. 🌿\n\n— Shivani`;
  await recordOutboundMessageAction({
    clientId,
    templateName: "fm_checkin_nudge",
    renderedBody: nudgeBody,
  });

  return { ok: true };
}

// ── Config check ──────────────────────────────────────────────────────────────

export async function checkWhatsAppConfigAction(): Promise<{
  configured: boolean;
  backend: "wa_server" | null;
}> {
  return {
    configured: isWhatsappConfigured(),
    backend: isWhatsappConfigured() ? "wa_server" : null,
  };
}

// ── Message templates ─────────────────────────────────────────────────────────

export interface MessageTemplate {
  slug: string;
  name: string;
  category: string;
  body: string;
  variables: string[];
  /**
   * Meta-approved template name on the WhatsApp Business Account. Without
   * this, the panel previously sent the slug (e.g. "lab-reminder") which
   * doesn't exist on Meta — the actual approved name is e.g.
   * "fm_lab_reminder". When set, the panel uses this to (a) check approval
   * status against APPROVED_WHATSAPP_TEMPLATES, (b) pass the correct name
   * to sendWhatsAppAction. When absent, panel falls back to slug (legacy
   * coach-added templates that never had a Meta side).
   */
  whatsapp_template_name?: string;
}

const TEMPLATES_FILE = path.join(PLANS_ROOT, "message_templates.yaml");

// Bodies mirror the Meta-APPROVED WhatsApp template bodies on the WABA
// (synced 2026-05-16 from whatsapp-server/scripts/submit-templates.js).
// All 5 carry the canonical sign-off so the preview shown to the coach
// matches what the client actually receives on WhatsApp.
// If you edit a body here, also edit the matching TEMPLATES entry in
// submit-templates.js and re-run the script — Meta will re-approve.
const SIGNOFF = "\n\n— Shivani Hari\nYour Functional Health Coach";

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    slug: "lab-reminder",
    name: "Lab Reminder",
    category: "labs",
    body: `Hi {{name}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{labs}}. Please share the report at least 2 days before our appointment. 🙏${SIGNOFF}`,
    variables: ["name", "labs"],
    whatsapp_template_name: "fm_lab_reminder",
  },
  {
    slug: "supplement-instructions",
    name: "Supplement Instructions",
    category: "protocol",
    body: `Hi {{name}}, here are your supplement instructions for this week: {{instructions}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊${SIGNOFF}`,
    variables: ["name", "instructions"],
    whatsapp_template_name: "fm_supplement_instructions",
  },
  {
    slug: "check-in-nudge",
    name: "Check-in Nudge",
    category: "follow-up",
    body: `Hi {{name}}, just checking in! How are you feeling on the protocol? Any changes in {{symptom}}? Would love to hear how things are going. 🌿${SIGNOFF}`,
    variables: ["name", "symptom"],
    whatsapp_template_name: "fm_checkin_nudge",
  },
  {
    slug: "session-confirmation",
    name: "Session Confirmation",
    category: "appointment",
    body: `Hi {{name}}, confirming our session on {{date}} at {{time}}. Please come prepared with your food journal and any new lab reports. See you then! 📋${SIGNOFF}`,
    variables: ["name", "date", "time"],
    whatsapp_template_name: "fm_session_confirm",
  },
  {
    slug: "encouragement",
    name: "Encouragement",
    category: "support",
    body: `Hi {{name}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{protocol_highlight}}. Rooting for you! 💚${SIGNOFF}`,
    variables: ["name", "protocol_highlight"],
    whatsapp_template_name: "fm_encouragement",
  },
];

export async function loadMessageTemplatesAction(): Promise<MessageTemplate[]> {
  // Backfill — covers two legacy YAML cases:
  //   1. `whatsapp_template_name` missing (pre-2026-05-15 templates)
  //   2. Body without the canonical sign-off (pre-2026-05-16 templates,
  //      before the Meta body edits were rolled out). When the on-disk
  //      body matches a default slug AND is missing the sign-off, we
  //      adopt the new default body so the panel preview matches what
  //      the client actually receives on WhatsApp.
  // Coach-added templates without a matching default slug pass through
  // untouched.
  const defaultBySlug = new Map(DEFAULT_TEMPLATES.map((t) => [t.slug, t]));
  const backfill = (t: MessageTemplate): MessageTemplate => {
    const def = defaultBySlug.get(t.slug);
    let next = t;
    if (!next.whatsapp_template_name && def?.whatsapp_template_name) {
      next = { ...next, whatsapp_template_name: def.whatsapp_template_name };
    }
    // Body sign-off self-heal: if it's a default-slug template and the
    // current body doesn't already include the canonical sign-off, swap
    // in the new default body. Coach edits to bodies of NON-default
    // slugs are preserved.
    if (def && !next.body.includes("Your Functional Health Coach")) {
      next = { ...next, body: def.body };
    }
    return next;
  };

  try {
    const raw = await fs.readFile(TEMPLATES_FILE, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const healed = (parsed as MessageTemplate[]).map(backfill);
      // If we changed anything, persist the healed YAML so the next load
      // doesn't have to re-heal (and the file on disk matches what we
      // serve, easier to inspect during debugging).
      const changed = healed.some((h, i) => {
        const before = (parsed as MessageTemplate[])[i];
        return (
          h.body !== before.body ||
          h.whatsapp_template_name !== before.whatsapp_template_name
        );
      });
      if (changed) {
        try {
          await fs.writeFile(
            TEMPLATES_FILE,
            yaml.dump(healed, { lineWidth: 120 }),
            "utf-8",
          );
        } catch {
          /* read-only filesystem etc. — heal in memory only */
        }
      }
      return healed;
    }
  } catch {
    // File doesn't exist — write defaults and return them
  }
  try {
    await fs.mkdir(PLANS_ROOT, { recursive: true });
    await fs.writeFile(TEMPLATES_FILE, yaml.dump(DEFAULT_TEMPLATES, { lineWidth: 120 }), "utf-8");
  } catch { /* ignore write errors */ }
  return DEFAULT_TEMPLATES;
}

export async function saveMessageTemplateAction(
  template: MessageTemplate
): Promise<{ ok: boolean; error?: string }> {
  try {
    const templates = await loadMessageTemplatesAction();
    const idx = templates.findIndex((t) => t.slug === template.slug);
    if (idx >= 0) {
      templates[idx] = template;
    } else {
      templates.push(template);
    }
    await fs.writeFile(TEMPLATES_FILE, yaml.dump(templates, { lineWidth: 120 }), "utf-8");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to save template" };
  }
}

export async function deleteMessageTemplateAction(
  slug: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const templates = await loadMessageTemplatesAction();
    const filtered = templates.filter((t) => t.slug !== slug);
    await fs.writeFile(TEMPLATES_FILE, yaml.dump(filtered, { lineWidth: 120 }), "utf-8");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to delete template" };
  }
}

// ── Send-state persistence ────────────────────────────────────────────────────

/**
 * Return the most recent `sent_at` ISO string for any outbound session segment
 * matching the given template name (or prefix, when `prefix=true`).
 *
 * Implements the durable coach rule: "every send button must read its sent_at
 * from disk on page load and render '✓ Sent X ago · Resend'" (memory note:
 * feedback_send_buttons_persist_state 2026-05-23, triggered by cl-010).
 *
 * Usage:
 *   // exact template name
 *   getLastSentAtAction(clientId, "fm_lab_reminder")
 *   // prefix match (e.g. fm_book_session_v1:discovery, fm_book_session_v1:followup)
 *   getLastSentAtAction(clientId, "fm_book_session_v1:", { prefix: true })
 *
 * Scans all session files in the past `daysBack` days (default 180).
 */
export async function getLastSentAtAction(
  clientId: string,
  templateName: string,
  opts?: { prefix?: boolean; daysBack?: number },
): Promise<{ sentAt: string | null }> {
  if (!clientId || !templateName) return { sentAt: null };

  const daysBack = opts?.daysBack ?? 180;
  const isPrefix = opts?.prefix ?? false;

  const dir = path.join(PLANS_ROOT, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { sentAt: null };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let best: string | null = null;

  for (const name of names) {
    if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) continue;
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const complaints = String(data?.presenting_complaints ?? "");
      if (!complaints.includes("[source: whatsapp_outbound]")) continue;
      if (!complaints.includes("[template:")) continue;

      const segments = complaints.split(/\n\s*---\s*\n/);
      for (const seg of segments) {
        if (!seg.includes("[source: whatsapp_outbound]")) continue;
        const tplMatch = seg.match(/\[template:\s*([^\]]+)\]/);
        if (!tplMatch) continue;
        const tpl = tplMatch[1].trim();
        const matches = isPrefix ? tpl.startsWith(templateName) : tpl === templateName;
        if (!matches) continue;
        const atMatch = seg.match(/\[sent_at:\s*([^\]]+)\]/);
        if (!atMatch) continue;
        const at = atMatch[1].trim();
        if (!best || at > best) best = at;
      }
    } catch {
      /* skip unreadable */
    }
  }

  return { sentAt: best };
}

/**
 * Batch version — returns a map of templateName → most recent sent_at.
 * Use when a single component needs to check multiple templates at once
 * (e.g. SendBookingLinkPanel checks one per booking-link slug).
 */
export async function getLastSentAtBatchAction(
  clientId: string,
  templateNames: string[],
  opts?: { prefix?: boolean; daysBack?: number },
): Promise<Record<string, string | null>> {
  if (!clientId || templateNames.length === 0) {
    return Object.fromEntries(templateNames.map((t) => [t, null]));
  }

  const daysBack = opts?.daysBack ?? 180;
  const isPrefix = opts?.prefix ?? false;

  const dir = path.join(PLANS_ROOT, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return Object.fromEntries(templateNames.map((t) => [t, null]));
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const best: Record<string, string | null> = Object.fromEntries(
    templateNames.map((t) => [t, null]),
  );

  for (const name of names) {
    if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) continue;
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const complaints = String(data?.presenting_complaints ?? "");
      if (!complaints.includes("[source: whatsapp_outbound]")) continue;
      if (!complaints.includes("[template:")) continue;

      const segments = complaints.split(/\n\s*---\s*\n/);
      for (const seg of segments) {
        if (!seg.includes("[source: whatsapp_outbound]")) continue;
        const tplMatch = seg.match(/\[template:\s*([^\]]+)\]/);
        if (!tplMatch) continue;
        const tpl = tplMatch[1].trim();
        const atMatch = seg.match(/\[sent_at:\s*([^\]]+)\]/);
        if (!atMatch) continue;
        const at = atMatch[1].trim();

        for (const candidate of templateNames) {
          const matches = isPrefix
            ? tpl.startsWith(candidate)
            : tpl === candidate;
          if (matches && (!best[candidate] || at > (best[candidate] as string))) {
            best[candidate] = at;
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  return best;
}

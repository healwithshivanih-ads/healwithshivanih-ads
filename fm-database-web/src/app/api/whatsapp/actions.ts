"use server";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";

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
    } else {
      errors.push(`${clientId}: ${result.error}`);
      failed++;
    }
  }

  return { sent, failed, errors };
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

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    slug: "lab-reminder",
    name: "Lab Reminder",
    category: "labs",
    body: "Hi {{name}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{labs}}. Please share the report at least 2 days before our appointment. 🙏",
    variables: ["name", "labs"],
    whatsapp_template_name: "fm_lab_reminder",
  },
  {
    slug: "supplement-instructions",
    name: "Supplement Instructions",
    category: "protocol",
    body: "Hi {{name}}, here are your supplement instructions for this week: {{instructions}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊",
    variables: ["name", "instructions"],
    whatsapp_template_name: "fm_supplement_instructions",
  },
  {
    slug: "check-in-nudge",
    name: "Check-in Nudge",
    category: "follow-up",
    body: "Hi {{name}}, just checking in! How are you feeling on the protocol? Any changes in {{symptom}}? Would love to hear how things are going. 🌿",
    variables: ["name", "symptom"],
    whatsapp_template_name: "fm_checkin_nudge",
  },
  {
    slug: "session-confirmation",
    name: "Session Confirmation",
    category: "appointment",
    body: "Hi {{name}}, confirming our session on {{date}} at {{time}}. Please come prepared with your food journal and any new lab reports. See you then! 📋",
    variables: ["name", "date", "time"],
    whatsapp_template_name: "fm_session_confirm",
  },
  {
    slug: "encouragement",
    name: "Encouragement",
    category: "support",
    body: "Hi {{name}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{protocol_highlight}}. Rooting for you! 💚",
    variables: ["name", "protocol_highlight"],
    whatsapp_template_name: "fm_encouragement",
  },
];

export async function loadMessageTemplatesAction(): Promise<MessageTemplate[]> {
  // Backfill map — for legacy YAML written before `whatsapp_template_name`
  // existed (pre-2026-05-15). Looks up the default by slug and copies its
  // Meta template name onto the loaded entry. Coach-added templates without
  // a matching default just stay unmapped → panel shows "⚠ Not approved"
  // until coach edits the YAML to add the field.
  const defaultByName = new Map(DEFAULT_TEMPLATES.map((t) => [t.slug, t]));
  const backfill = (t: MessageTemplate): MessageTemplate => {
    if (t.whatsapp_template_name) return t;
    const def = defaultByName.get(t.slug);
    return def?.whatsapp_template_name
      ? { ...t, whatsapp_template_name: def.whatsapp_template_name }
      : t;
  };

  try {
    const raw = await fs.readFile(TEMPLATES_FILE, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return (parsed as MessageTemplate[]).map(backfill);
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

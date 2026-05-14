"use server";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";

const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");

// ── Backend selection (dual-mode during transition) ───────────────────────────
// Outbound WhatsApp sends pick a backend at runtime:
//   1. If WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY are set, route through
//      the self-hosted server (Fly app: whatsapp-server-shivani).
//   2. Else if AISENSY_API_KEY is set, fall back to the AiSensy direct API.
//   3. Else return an error.
//
// To force AiSensy even when the WA server is also configured (useful during
// testing while the WA server is still on Meta's test number), set
// WHATSAPP_PREFER=aisensy.

const WA_SERVER_URL = (process.env.WHATSAPP_SERVER_URL ?? "").replace(/\/$/, "");
const WA_SERVER_API_KEY = process.env.WHATSAPP_SERVER_API_KEY ?? "";
const AISENSY_API_KEY = process.env.AISENSY_API_KEY ?? "";
const AISENSY_API_URL = "https://backend.aisensy.com/direct-apis/t1/create-message";

function pickBackend(): "wa_server" | "aisensy" | null {
  const haveServer = !!(WA_SERVER_URL && WA_SERVER_API_KEY);
  const haveAisensy = !!AISENSY_API_KEY;
  const prefer = (process.env.WHATSAPP_PREFER ?? "").toLowerCase();
  if (prefer === "aisensy" && haveAisensy) return "aisensy";
  if (prefer === "wa_server" && haveServer) return "wa_server";
  if (haveServer) return "wa_server";
  if (haveAisensy) return "aisensy";
  return null;
}

/** Normalise to E.164-without-plus (matches AiSensy + WA-server expectation). */
function normaliseToE164(phone: string): string {
  let n = phone.replace(/[\s\-().+]/g, "");
  if (n.length === 10 && /^[6-9]/.test(n)) n = "91" + n;
  return n;
}

// ── Single send ───────────────────────────────────────────────────────────────

/**
 * Send a templated WhatsApp message. Auto-selects backend:
 *   - WhatsApp server (preferred when configured)
 *   - AiSensy direct API (fallback during transition)
 *
 * `campaignName` is the Meta template name (kept the parameter name for
 * backward compatibility with AiSensy-shaped callers).
 */
export async function sendWhatsAppAction(
  phone: string,
  campaignName: string,
  templateParams: string[],
  opts?: { name?: string; templateLanguage?: string }
): Promise<{ ok: boolean; error?: string; backend?: "wa_server" | "aisensy" }> {
  if (!phone?.trim()) return { ok: false, error: "Phone number required" };

  const backend = pickBackend();
  if (!backend) {
    return {
      ok: false,
      error:
        "No WhatsApp backend configured. Set either WHATSAPP_SERVER_URL+WHATSAPP_SERVER_API_KEY or AISENSY_API_KEY.",
    };
  }

  if (backend === "wa_server") {
    return sendViaWaServer(phone, campaignName, templateParams, opts);
  }
  return sendViaAisensy(phone, campaignName, templateParams);
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

async function sendViaAisensy(
  phone: string,
  campaignName: string,
  templateParams: string[]
): Promise<{ ok: boolean; error?: string; backend: "aisensy" }> {
  const destination = normaliseToE164(phone);
  if (!destination || destination.length < 10) {
    return { ok: false, error: `Invalid phone number: ${phone}`, backend: "aisensy" };
  }

  const body = {
    apiKey: AISENSY_API_KEY,
    campaignName,
    destination,
    userName: "Shivani Hari",
    source: "fm-coach",
    media: {},
    templateParams,
    tags: [],
    attributes: {},
  };

  try {
    const res = await fetch(AISENSY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `AiSensy API error ${res.status}: ${text.slice(0, 200)}`,
        backend: "aisensy",
      };
    }
    return { ok: true, backend: "aisensy" };
  } catch (err) {
    const e = err as { message?: string };
    return {
      ok: false,
      error: e.message ?? "Network error calling AiSensy API",
      backend: "aisensy",
    };
  }
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
  backend: "wa_server" | "aisensy" | null;
}> {
  const backend = pickBackend();
  return { configured: !!backend, backend };
}

// ── Message templates ─────────────────────────────────────────────────────────

export interface MessageTemplate {
  slug: string;
  name: string;
  category: string;
  body: string;
  variables: string[];
}

const TEMPLATES_FILE = path.join(PLANS_ROOT, "message_templates.yaml");

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    slug: "lab-reminder",
    name: "Lab Reminder",
    category: "labs",
    body: "Hi {{name}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{labs}}. Please share the report at least 2 days before our appointment. 🙏",
    variables: ["name", "labs"],
  },
  {
    slug: "supplement-instructions",
    name: "Supplement Instructions",
    category: "protocol",
    body: "Hi {{name}}, here are your supplement instructions for this week: {{instructions}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊",
    variables: ["name", "instructions"],
  },
  {
    slug: "check-in-nudge",
    name: "Check-in Nudge",
    category: "follow-up",
    body: "Hi {{name}}, just checking in! How are you feeling on the protocol? Any changes in {{symptom}}? Would love to hear how things are going. 🌿",
    variables: ["name", "symptom"],
  },
  {
    slug: "session-confirmation",
    name: "Session Confirmation",
    category: "appointment",
    body: "Hi {{name}}, confirming our session on {{date}} at {{time}}. Please come prepared with your food journal and any new lab reports. See you then! 📋",
    variables: ["name", "date", "time"],
  },
  {
    slug: "encouragement",
    name: "Encouragement",
    category: "support",
    body: "Hi {{name}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{protocol_highlight}}. Rooting for you! 💚",
    variables: ["name", "protocol_highlight"],
  },
];

export async function loadMessageTemplatesAction(): Promise<MessageTemplate[]> {
  try {
    const raw = await fs.readFile(TEMPLATES_FILE, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as MessageTemplate[];
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

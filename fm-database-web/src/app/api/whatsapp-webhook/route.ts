/**
 * POST /api/whatsapp-webhook
 *
 * Receives forwarded inbound WhatsApp messages from the self-hosted WhatsApp
 * server (Fly app: whatsapp-server-shivani). Matches sender phone to a client,
 * saves as a quick_note session.
 *
 * Expected payload (sent by services/forwarder on the WA server):
 * {
 *   type: 'inbound_message',
 *   wa_id: '919876543210',
 *   profile_name: 'Priya Sharma' | null,
 *   message_type: 'text' | 'image' | 'audio' | ...,
 *   body: 'Hi Shivani, feeling better...',
 *   external_message_id: 'wamid....',
 *   timestamp: '2026-05-14T12:34:56.000Z',
 *   contact_id: uuid | null,
 *   contact_display_name: string | null,
 *   conversation_id: uuid | null,
 *   message_id: uuid | null,
 *   raw_payload: <Meta event object>,
 * }
 *
 * Security: signed with HMAC-SHA256 over the raw body. The signature is sent
 * in the `X-Whatsapp-Signature-256` header as `sha256=<hex>`. The shared
 * secret is `WHATSAPP_WEBHOOK_SECRET` (matches the WA server's
 * FM_COACH_WEBHOOK_SECRET).
 *
 * Always returns 2xx — if processing fails, we log and continue so the WA
 * server doesn't retry (it would just duplicate work; the raw event already
 * lives in the WA server's webhook_events table for replay if needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFile } from "child_process";
import yaml from "js-yaml";
import { findClientByPhoneAction } from "@/app/clients/actions";

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");
const UNMATCHED_FILE = path.join(PLANS_ROOT, "_whatsapp_unmatched.yaml");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

// ── Signature verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

// ── Save session via Python shim ──────────────────────────────────────────────

async function saveQuickNote(
  clientId: string,
  text: string
): Promise<{ ok: boolean; session_id?: string; error?: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, "save-session.py");
  const payload = {
    client_id: clientId,
    session_type: "quick_note",
    presenting_complaints: `[source: whatsapp_webhook]\n\n${text}`,
  };

  const child = execFile(PYTHON, [scriptPath], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    cwd: FMDB_REPO,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    return { ok: false, error: `No output from save-session.py. stderr: ${stderr.slice(0, 300)}` };
  }
  try {
    return JSON.parse(stdout) as { ok: boolean; session_id?: string; error?: string };
  } catch {
    return { ok: false, error: `Invalid JSON from save-session.py: ${stdout.slice(0, 200)}` };
  }
}

// ── Save unmatched message ────────────────────────────────────────────────────

async function saveUnmatchedMessage(
  rawPhone: string,
  senderName: string,
  messageText: string,
  ts: string
): Promise<void> {
  try {
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(UNMATCHED_FILE, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch { /* file doesn't exist yet */ }

    existing.push({
      phone: rawPhone,
      name: senderName || null,
      date: new Date().toISOString().slice(0, 10),
      received_at: ts,
      text: messageText.slice(0, 500),
    });

    await fs.writeFile(UNMATCHED_FILE, yaml.dump(existing, { lineWidth: 120 }), "utf-8");
  } catch (err) {
    console.error("[whatsapp-webhook] Failed to write unmatched message:", err);
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Read raw body once so we can verify the signature, then parse.
  const rawBody = await req.text();

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-whatsapp-signature-256");
    if (!verifySignature(rawBody, sig, secret)) {
      console.warn("[whatsapp-webhook] invalid signature");
      // Return 401 so the sender knows — the WA server logs and moves on.
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const rawPhone = (body.wa_id ?? "") as string;
  const messageText = (body.body ?? "") as string;
  const senderName = (body.profile_name ?? body.contact_display_name ?? "") as string;
  const msgType = (body.message_type ?? "text") as string;

  if (!rawPhone) {
    return NextResponse.json({ ok: false, error: "Missing wa_id" }, { status: 400 });
  }

  if (msgType !== "text") {
    return NextResponse.json({ ok: true, skipped: true, reason: `non-text: ${msgType}` });
  }

  if (!messageText.trim()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "empty message" });
  }

  const ts = body.timestamp
    ? new Date(body.timestamp as string).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  const match = await findClientByPhoneAction(rawPhone);
  if (!match.ok || !match.client_id) {
    console.warn(`[whatsapp-webhook] No client found for phone ${rawPhone}: ${match.error}`);
    await saveUnmatchedMessage(rawPhone, senderName, messageText, ts);
    return NextResponse.json({
      ok: true,
      matched: false,
      note: "saved to _whatsapp_unmatched.yaml for coach review",
    });
  }

  const noteText = [
    `WhatsApp message from ${senderName || match.display_name || match.client_id} (${rawPhone})`,
    `Received: ${ts}`,
    "",
    messageText.trim(),
  ].join("\n");

  const saveResult = await saveQuickNote(match.client_id, noteText);
  if (!saveResult.ok) {
    console.error(`[whatsapp-webhook] Failed to save note for ${match.client_id}: ${saveResult.error}`);
    return NextResponse.json({ ok: false, error: saveResult.error }, { status: 500 });
  }

  console.log(
    `[whatsapp-webhook] ✓ ${rawPhone} → ${match.client_id} (session: ${saveResult.session_id})`
  );

  return NextResponse.json({
    ok: true,
    client_id: match.client_id,
    session_id: saveResult.session_id,
  });
}

// ── GET — setup info ──────────────────────────────────────────────────────────

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  return NextResponse.json({
    status: "ok",
    endpoint: `${base}/api/whatsapp-webhook`,
    method: "POST",
    auth: process.env.WHATSAPP_WEBHOOK_SECRET
      ? "HMAC-SHA256 signature required in X-Whatsapp-Signature-256 header"
      : "No secret set — open (dev mode)",
    setup: [
      "1. Generate a shared secret: openssl rand -hex 32",
      "2. Add WHATSAPP_WEBHOOK_SECRET=<secret> to fm-coach .env.local",
      "3. On the WhatsApp server (Fly), set:",
      "   flyctl secrets set FM_COACH_WEBHOOK_URL=<public-tunnel-url>/api/whatsapp-webhook \\",
      "                      FM_COACH_WEBHOOK_SECRET=<same-secret> \\",
      "                      -a whatsapp-server-shivani",
      "4. Expose this server with cloudflared tunnel --url http://localhost:3002 if running locally",
    ],
  });
}

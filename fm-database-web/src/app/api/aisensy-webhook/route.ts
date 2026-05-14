/**
 * POST /api/aisensy-webhook
 *
 * Receives incoming messages from AiSensy / WhatsApp.
 * Matches the sender phone to a client, saves as a pending quick_note session.
 *
 * AiSensy webhook payload shape (varies by plan):
 * {
 *   "waId":       "919876543210",  // sender phone (no +)
 *   "name":       "Priya Sharma",
 *   "message":    "Hi Shivani! Feeling better today...",
 *   "type":       "text",          // text | image | audio | document
 *   "timestamp":  1712345678,
 *   "campaign":   "...",
 * }
 *
 * We also accept a generic shape with `phone` + `message` keys so the endpoint
 * can be tested with curl / Postman without a real AiSensy account.
 *
 * Security: Set AISENSY_WEBHOOK_SECRET in .env.local.
 * AiSensy will include it as the X-AiSensy-Secret header (configurable).
 * If the env var is not set, all requests are accepted (dev mode).
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFile } from "child_process";
import { promisify } from "util";
import yaml from "js-yaml";
import { findClientByPhoneAction } from "@/lib/server-actions/clients";

const _execFileP = promisify(execFile);
const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");
const UNMATCHED_FILE = path.join(PLANS_ROOT, "_aisensy_unmatched.yaml");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

// ── Save session via Python shim ───────────────────────────────────────────────

async function saveQuickNote(clientId: string, text: string): Promise<{ ok: boolean; session_id?: string; error?: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, "save-session.py");
  const payload = {
    client_id: clientId,
    session_type: "quick_note",
    presenting_complaints: `[source: aisensy_webhook]\n\n${text}`,
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

  if (!stdout.trim()) return { ok: false, error: `No output from save-session.py. stderr: ${stderr.slice(0, 300)}` };
  try {
    const r = JSON.parse(stdout) as { ok: boolean; session_id?: string; error?: string };
    return r;
  } catch (e) {
    return { ok: false, error: `Invalid JSON from save-session.py: ${stdout.slice(0, 200)}` };
  }
}

// ── Save unmatched message ─────────────────────────────────────────────────────

async function saveUnmatchedMessage(rawPhone: string, senderName: string, messageText: string, ts: string): Promise<void> {
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
    console.error("[aisensy-webhook] Failed to write unmatched message:", err);
  }
}

// ── Webhook handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth check ───────────────────────────────────────────────────────────────
  const secret = process.env.AISENSY_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers.get("x-aisensy-secret") ??
      req.headers.get("x-webhook-secret") ??
      req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Support both AiSensy native shape (waId / message) and generic (phone / message)
  const rawPhone = (body.waId ?? body.phone ?? body.wa_id ?? "") as string;
  const messageText = (body.message ?? body.text ?? body.body ?? "") as string;
  const senderName = (body.name ?? body.sender_name ?? "") as string;
  const msgType = (body.type ?? "text") as string;

  if (!rawPhone) {
    return NextResponse.json({ ok: false, error: "Missing phone / waId field" }, { status: 400 });
  }

  // Only process text messages for now; skip image / audio etc.
  if (msgType !== "text") {
    return NextResponse.json({ ok: true, skipped: true, reason: `Non-text message type: ${msgType}` });
  }

  if (!messageText.trim()) {
    return NextResponse.json({ ok: false, error: "Empty message" }, { status: 400 });
  }

  // ── Build timestamp ───────────────────────────────────────────────────────────
  const ts = body.timestamp
    ? new Date((body.timestamp as number) * 1000).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  // ── Match phone to client ────────────────────────────────────────────────────
  const match = await findClientByPhoneAction(rawPhone);
  if (!match.ok || !match.client_id) {
    // Save to unmatched log and return 200 so AiSensy doesn't retry
    console.warn(`[aisensy-webhook] No client found for phone ${rawPhone}: ${match.error}`);
    await saveUnmatchedMessage(rawPhone, senderName, messageText, ts);
    return NextResponse.json({
      ok: true,
      matched: false,
      note: "Message received but no matching client — saved to _aisensy_unmatched.yaml for coach review",
    });
  }

  const noteLines = [
    `WhatsApp message from ${senderName || match.display_name || match.client_id} (${rawPhone})`,
    `Received: ${ts}`,
    "",
    messageText.trim(),
  ];
  const noteText = noteLines.join("\n");

  // ── Save session ─────────────────────────────────────────────────────────────
  const saveResult = await saveQuickNote(match.client_id, noteText);
  if (!saveResult.ok) {
    console.error(`[aisensy-webhook] Failed to save note for ${match.client_id}: ${saveResult.error}`);
    return NextResponse.json({ ok: false, error: saveResult.error }, { status: 500 });
  }

  console.log(`[aisensy-webhook] ✓ Saved message from ${rawPhone} → ${match.client_id} (session: ${saveResult.session_id})`);

  return NextResponse.json({
    ok: true,
    client_id: match.client_id,
    session_id: saveResult.session_id,
    message: `Note saved for ${match.display_name ?? match.client_id}`,
  });
}

// ── GET — health check + setup instructions ───────────────────────────────────

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  return NextResponse.json({
    status: "ok",
    endpoint: `${base}/api/aisensy-webhook`,
    method: "POST",
    auth: process.env.AISENSY_WEBHOOK_SECRET ? "X-AiSensy-Secret header required" : "No secret set — open (dev mode)",
    expected_fields: {
      waId: "sender phone number (AiSensy native)",
      message: "message text",
      name: "sender display name (optional)",
      type: "message type — only 'text' is processed",
      timestamp: "Unix timestamp (optional)",
    },
    setup: [
      "1. Add AISENSY_WEBHOOK_SECRET=<yourSecret> to .env.local",
      "2. Expose this server with: cloudflared tunnel --url http://localhost:3002",
      "3. In AiSensy dashboard → Settings → Webhook URL: <tunnel-url>/api/aisensy-webhook",
      "4. Add header X-AiSensy-Secret: <yourSecret> in the AiSensy webhook config",
    ],
  });
}

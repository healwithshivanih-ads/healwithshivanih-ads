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
import { findClientByPhoneAction } from "@/lib/server-actions/clients";
import { parseInboundStartDateIntent } from "@/lib/start-date-parser";

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
  // Per-plan rollup: every WhatsApp message (in OR out) for the
  // duration of a published plan rolls into ONE session tagged
  // `[plan: <slug>]`. When the plan supersedes, the next message
  // naturally starts a fresh session with the new plan slug.
  // Pre-programme clients use the sentinel `[plan: prospect]` so they
  // also get one rolling thread.
  //
  // Each segment keeps its own [source: whatsapp_webhook] /
  // [source: whatsapp_outbound] tag so the thread panel renders
  // direction correctly after splitting on `---`.
  const { getActivePlanSlugForClient } = await import("@/lib/fmdb/active-plan-slug");
  const planSlug = await getActivePlanSlugForClient(clientId);
  const planMarker = `[plan: ${planSlug}]`;
  const payload = {
    client_id: clientId,
    session_type: "quick_note",
    presenting_complaints: `${planMarker} [source: whatsapp_webhook]\n\n${text}`,
    append_if_today_match: planMarker,
    match_anywhere: true,
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

// ── Apply structured start-date intent ────────────────────────────────────────
//
// When the letter's WhatsApp buttons get tapped, the client's reply lands
// here as e.g. "✅ START: 2026-05-17 [plan: nidhi-plan-1-…]". The
// parseInboundStartDateIntent() helper recognises it; we call into the
// start-date-action.py shim's `apply_inbound` to actually update
// plan.meal_plan_started_on / plan.supplements_started_on. The PLAN
// SLUG (when included via [plan: <slug>]) gets pulled out separately so
// the right plan gets stamped even if the client has multiple drafts.

const PLAN_TAG_RE = /\[plan:\s*([a-z0-9][a-z0-9-]*)\s*\]/i;

interface ApplyInboundResult {
  ok: boolean;
  plan_slug?: string;
  field_updated?: "meal_plan_started_on" | "supplements_started_on";
  previous_value?: string | null;
  new_value?: string;
  error?: string;
}

async function applyStartDateIntent(
  clientId: string,
  rawText: string,
): Promise<ApplyInboundResult | null> {
  const intent = parseInboundStartDateIntent(rawText);
  if (!intent) return null;
  const slugMatch = PLAN_TAG_RE.exec(rawText);
  const planSlug = slugMatch ? slugMatch[1] : "";

  const payload = {
    action: "apply_inbound",
    client_id: clientId,
    kind: intent.kind,
    date: intent.date,
    plan_slug: planSlug,
  };

  const scriptPath = path.join(SCRIPTS_DIR, "start-date-action.py");
  const child = execFile(PYTHON, [scriptPath], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
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
    return { ok: false, error: `start-date-action.py: ${stderr.slice(0, 200)}` };
  }
  try {
    return JSON.parse(stdout) as ApplyInboundResult;
  } catch {
    return { ok: false, error: `start-date-action.py invalid JSON: ${stdout.slice(0, 200)}` };
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

  // Detect structured start-date / supplements-arrived intent BEFORE
  // saving the note — so the note can carry an "auto-applied" footer.
  const applied = await applyStartDateIntent(match.client_id, messageText);

  const noteLines = [
    `WhatsApp message from ${senderName || match.display_name || match.client_id} (${rawPhone})`,
    `Received: ${ts}`,
    "",
    messageText.trim(),
  ];
  if (applied?.ok && applied.field_updated && applied.plan_slug) {
    noteLines.push(
      "",
      `🤖 Auto-applied: ${applied.field_updated} = ${applied.new_value} on plan ${applied.plan_slug}` +
        (applied.previous_value ? ` (was ${applied.previous_value})` : "") + ".",
    );
  } else if (applied && !applied.ok) {
    noteLines.push(
      "",
      `⚠ Recognised as a start-date signal but couldn't auto-apply: ${applied.error}. Manual review needed.`,
    );
  }
  const noteText = noteLines.join("\n");

  const saveResult = await saveQuickNote(match.client_id, noteText);
  if (!saveResult.ok) {
    console.error(`[whatsapp-webhook] Failed to save note for ${match.client_id}: ${saveResult.error}`);
    return NextResponse.json({ ok: false, error: saveResult.error }, { status: 500 });
  }

  if (applied?.ok) {
    console.log(
      `[whatsapp-webhook] ✓ ${rawPhone} → ${match.client_id} (session: ${saveResult.session_id}) · ` +
        `auto-applied ${applied.field_updated}=${applied.new_value} on ${applied.plan_slug}`,
    );
  } else {
    console.log(
      `[whatsapp-webhook] ✓ ${rawPhone} → ${match.client_id} (session: ${saveResult.session_id})`,
    );
  }

  return NextResponse.json({
    ok: true,
    client_id: match.client_id,
    session_id: saveResult.session_id,
    applied: applied?.ok
      ? {
          field: applied.field_updated,
          new_value: applied.new_value,
          plan_slug: applied.plan_slug,
        }
      : null,
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

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
 *   message_type: 'text' | 'button' | 'interactive' | 'button_reply'
 *               | 'image' | 'audio' | ...,
 *   body: 'Hi Shivani, feeling better...' | 'All good' (button title),
 *   external_message_id: 'wamid....',
 *   timestamp: '2026-05-14T12:34:56.000Z',
 *   contact_id: uuid | null,
 *   contact_display_name: string | null,
 *   conversation_id: uuid | null,
 *   message_id: uuid | null,
 *   raw_payload: <Meta event object>,
 * }
 *
 * Architecture (cleaned up 2026-05-24 after coach reported Hariharan's
 * reply not showing in chat panel — turned out interactive button taps
 * were being silently dropped because the filter was `msgType !== "text"`):
 *
 *   1. Verify HMAC signature → reject 401 if invalid.
 *   2. Parse + extract wa_id / body / message_type / sender.
 *   3. Allowlist message types we KNOW carry a text-shaped body:
 *      - "text"           — free-text reply
 *      - "button"         — quick-reply button on a template (Meta sends
 *                            messages.button.text as the label)
 *      - "interactive"    — interactive list/button replies
 *      - "button_reply"   — alt name from forwarder for the same thing
 *      - "list_reply"     — interactive list selection
 *      Any other type (image/audio/video/document/location/etc) is logged
 *      LOUDLY (not silent) and acknowledged as `skipped: true`.
 *   4. Match phone → client. Unmatched → _whatsapp_unmatched.yaml.
 *   5. Detect structured intents from the body in order:
 *      a. start-date intent ("✅ START: 2026-05-19 [plan: …]")
 *      b. cycle date ("LMP 2026-05-19")
 *      c. weekly poll button-label ("All good" / "Struggling" / …)
 *         → also write a dedicated <date>-NNN-poll.yaml session via
 *           save-poll-response.py so detectAdherenceDropsAction can
 *           iterate the structured `poll_response: {dim, score}` field.
 *   6. ALWAYS write to the rolling per-plan WhatsApp thread session via
 *      save-session.py (append_if_today_match + match_anywhere). Even
 *      poll-button replies go here — so the chat panel shows the
 *      reply in context. Dual-write is intentional.
 *
 * Security: HMAC-SHA256 over the raw body. Signature in the
 * `X-Whatsapp-Signature-256` header as `sha256=<hex>`. Shared secret
 * `WHATSAPP_WEBHOOK_SECRET` matches the WA server's
 * FM_COACH_WEBHOOK_SECRET.
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
import { recordInboundCycleDate } from "@/lib/server-actions/cycle-date-collector";
import {
  classifyPollReply,
  pillarFromDimension,
  scoreToPillarRating,
} from "@/lib/poll-labels";

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
  const { marker } = await getActivePlanSlugForClient(clientId);
  const payload = {
    client_id: clientId,
    session_type: "quick_note",
    presenting_complaints: `${marker} [source: whatsapp_webhook]\n\n${text}`,
    // Marker carries BOTH the plan slug AND the 28-day window anchor,
    // so when the window rolls over (every 28 days into a plan) the
    // marker string changes → save-session.py won't find a match →
    // new session created. Caps each file at ~28 days of chat history.
    append_if_today_match: marker,
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
// ── Poll-reply structured save (Fix 2026-05-24) ──────────────────────────────
//
// When classifyPollReply matches a known weekly-poll button label, we
// write a dedicated <date>-NNN-poll.yaml session via save-poll-response.py
// with the structured `poll_response: {dim, score, raw_text}` field. That
// dedicated file is what detectAdherenceDropsAction iterates over. The
// inbound reply ALSO lands in the rolling WhatsApp thread via the
// regular saveQuickNote call below — so the chat panel shows the reply.
async function savePollResponse(
  clientId: string,
  dim: string,
  score: string,
  rawText: string,
  phone: string,
  receivedAt: string,
): Promise<string | null> {
  const scriptPath = path.join(SCRIPTS_DIR, "save-poll-response.py");
  const payload = {
    client_id: clientId,
    raw_text: rawText,
    dim,
    score,
    phone,
    received_at: receivedAt,
  };

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
    throw new Error(`save-poll-response.py: empty stdout. stderr: ${stderr.slice(0, 300)}`);
  }
  try {
    const parsed = JSON.parse(stdout) as { ok: boolean; session_id?: string; error?: string };
    if (!parsed.ok) {
      throw new Error(`save-poll-response.py: ${parsed.error}`);
    }
    return parsed.session_id ?? null;
  } catch (e) {
    throw new Error(`save-poll-response.py invalid output: ${(e as Error).message}`);
  }
}

// ── Five Pillars derived-snapshot rollup (Tier 1, 2026-05-24) ───────────────
//
// When the inbound reply maps to a pillar dimension (sleep / stress /
// movement / nutrition / connection — NOT overall or supplements which
// are adherence signals), merge a single-pillar score into
// client.yaml#derived_five_pillars.{pillar}. The OutcomeProgressCard +
// Overview Five Pillars tile read this alongside session-based manual
// captures. Returns true on success, false on any failure (best-effort —
// never block the inbound webhook on the rollup).
async function writeDerivedPillar(
  clientId: string,
  pillar: string,
  rating: number,
  rawText: string,
  receivedAt: string,
): Promise<boolean> {
  const scriptPath = path.join(SCRIPTS_DIR, "update-derived-pillar.py");
  const payload = {
    client_id: clientId,
    pillar,
    rating,
    raw_text: rawText,
    received_at: receivedAt,
    source: "weekly_poll",
  };
  try {
    const child = execFile(PYTHON, [scriptPath], {
      timeout: 10_000,
      maxBuffer: 256 * 1024,
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
      console.warn(
        `[whatsapp-webhook] update-derived-pillar.py empty stdout. stderr: ${stderr.slice(0, 200)}`,
      );
      return false;
    }
    const parsed = JSON.parse(stdout) as { ok: boolean; error?: string };
    if (!parsed.ok) {
      console.warn(`[whatsapp-webhook] update-derived-pillar.py: ${parsed.error}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[whatsapp-webhook] update-derived-pillar.py threw: ${(e as Error).message}`);
    return false;
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

  // Fix 2026-05-24: previously this branch was `msgType !== "text"` which
  // SILENTLY DROPPED button taps on interactive templates. Quick-reply
  // button replies on Meta WhatsApp templates come through as
  // message_type "button" / "interactive" / "button_reply" with the
  // button label in `body`. The drop was returning 200 OK so nothing
  // surfaced in logs — Hariharan's check-in reply was lost this way.
  //
  // Allowlist message types that carry a text-shaped body. Anything else
  // (image/audio/video/document/location/sticker/reaction etc.) is
  // logged LOUDLY and acknowledged as skipped — but never silently.
  const TEXT_LIKE_TYPES = new Set([
    "text",
    "button",
    "interactive",
    "button_reply",
    "list_reply",
    "button_text",  // some forwarders use this variant
  ]);
  if (!TEXT_LIKE_TYPES.has(msgType)) {
    console.log(
      `[whatsapp-webhook] SKIP non-text msgType="${msgType}" from ${rawPhone}` +
        ` (body bytes=${messageText.length}). Forwarder should still log the raw event.`,
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `non-text-like: ${msgType}`,
    });
  }

  if (!messageText.trim()) {
    console.log(
      `[whatsapp-webhook] SKIP empty body from ${rawPhone} (msgType="${msgType}")`,
    );
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

  // Cycle-date reply — a client answering the fm_cycle_date_check_v1 ask.
  // Only attempted when the start-date handler didn't already claim the
  // message; recordInboundCycleDate returns null for non-cycle messages.
  const cycleApplied = applied?.ok
    ? null
    : await recordInboundCycleDate(match.client_id, messageText);
  if (cycleApplied?.ok && cycleApplied.applied) {
    noteLines.push(
      "",
      `🩸 Auto-applied: period start date set to ${cycleApplied.date}` +
        (cycleApplied.previous ? ` (was ${cycleApplied.previous})` : "") +
        ".",
    );
  }

  // Weekly-poll button-label classifier (Fix 2026-05-24: was dead code —
  // defined in lib/poll-labels.ts but never wired into the webhook,
  // which meant detectAdherenceDropsAction had nothing to iterate over).
  //
  // When the body matches a known poll-button label ("All good" /
  // "Struggling" / "Missed 1-2 days" / etc), we DUAL-WRITE:
  //   1. A dedicated <date>-NNN-poll.yaml via save-poll-response.py
  //      — carries the structured `poll_response: {dim, score}` field
  //      that detectAdherenceDropsAction reads.
  //   2. ALSO falls through to saveQuickNote below so the reply lands
  //      in the rolling WhatsApp thread for the chat panel.
  //
  // Only attempted when start-date + cycle handlers didn't already
  // claim the message (those are more specific patterns).
  let pollMatched: { dim: string; score: string } | null = null;
  let pollSessionId: string | null = null;
  if (!applied?.ok && !cycleApplied?.applied) {
    pollMatched = classifyPollReply(messageText);
    if (pollMatched) {
      try {
        pollSessionId = await savePollResponse(
          match.client_id,
          pollMatched.dim,
          pollMatched.score,
          messageText.trim(),
          rawPhone,
          ts,
        );
        noteLines.push(
          "",
          `📊 Weekly poll reply detected — ${pollMatched.dim}: ${pollMatched.score}` +
            (pollSessionId ? ` (audit session: ${pollSessionId})` : ""),
        );
        // Tier 1 — if this dim is one of the 5 pillars, also write a
        // single-pillar entry to client.derived_five_pillars so the
        // OutcomeProgressCard + Overview tile reflect it. Best-effort;
        // no throw if the shim fails (already classified + saved).
        const pillar = pillarFromDimension(pollMatched.dim as never);
        if (pillar) {
          const rating = scoreToPillarRating(pollMatched.score as never);
          const wrote = await writeDerivedPillar(
            match.client_id,
            pillar,
            rating,
            messageText.trim(),
            ts,
          );
          if (wrote) {
            noteLines.push(
              `   ↳ Five Pillars updated: ${pillar} = ${rating}/5`,
            );
          }
        }
      } catch (err) {
        console.error(
          `[whatsapp-webhook] Poll-classifier matched but save-poll-response failed:`,
          err,
        );
        // Fall through to the rolling-thread write below — the reply
        // is still captured in the chat panel even if the structured
        // audit didn't land.
      }
    }
  }

  const noteText = noteLines.join("\n");

  const saveResult = await saveQuickNote(match.client_id, noteText);
  if (!saveResult.ok) {
    console.error(`[whatsapp-webhook] Failed to save note for ${match.client_id}: ${saveResult.error}`);
    return NextResponse.json({ ok: false, error: saveResult.error }, { status: 500 });
  }

  const extras: string[] = [];
  if (applied?.ok) {
    extras.push(`auto-applied ${applied.field_updated}=${applied.new_value} on ${applied.plan_slug}`);
  }
  if (cycleApplied?.applied) {
    extras.push(`cycle ${cycleApplied.date}`);
  }
  if (pollMatched) {
    extras.push(`poll ${pollMatched.dim}=${pollMatched.score}${pollSessionId ? ` (${pollSessionId})` : ""}`);
  }
  console.log(
    `[whatsapp-webhook] ✓ ${rawPhone} → ${match.client_id} (msgType=${msgType}, session: ${saveResult.session_id})` +
      (extras.length ? ` · ${extras.join(" · ")}` : ""),
  );

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

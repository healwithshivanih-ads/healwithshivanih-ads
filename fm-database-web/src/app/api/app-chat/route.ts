/**
 * POST /api/app-chat — the client's side of the conversation.
 *
 * Two actions on one route, because the client app only ever needs both
 * together: `list` to render the thread, `send` to add to it.
 *
 * Auth: body.token must resolve to the token that opened the app. The client
 * is derived server-side from it and NEVER trusted from the request — the
 * same posture as every other /api/app-* route.
 *
 * WHY THIS EXISTS: WhatsApp becomes paid per message from October. This
 * carries the same conversation at no per-message cost. WhatsApp history is
 * merged in, so the client sees one continuous thread rather than a wall that
 * starts the day we switched.
 *
 * TRIAGE FIRES ON SEND. A message typed here may not be read until morning,
 * so an acute cue gets an immediate on-screen answer instead of being queued
 * behind a reply that has not been written yet. The message is still stored —
 * suppressing it would hide the very thing the coach needs to see.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { isEmergency } from "@/lib/fmdb/triage";
import {
  appendMessage,
  markRead,
  mergeForDisplay,
  readThread,
  unreadCount,
} from "@/lib/fmdb/client-thread";
import { loadWhatsAppThreadAction } from "@/app/api/whatsapp/actions";
import { notifyCoachOfClientMessage } from "@/lib/fmdb/chat-notify";
import { pushStatus } from "@/lib/fmdb/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LEN = 4000;
const DAILY_SEND_LIMIT = 40;

export async function POST(req: NextRequest) {
  let body: { token?: string; action?: string; text?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }
  const clientId = lookup.client_id;

  // ── list ────────────────────────────────────────────────────────────────
  // Asking how many are waiting is not the same as looking at them, so this
  // sits ABOVE the list branch: no WhatsApp history, no read side effect.
  // It is polled for the badge and must stay cheap.
  if (body.action === "unread") {
    const thread = readThread(clientId);
    // Receipts only started being recorded at this deploy; without a floor
    // every message that predates them looks undelivered and we would tell
    // a client their phone is broken when it never had the chance to say
    // otherwise. The floor retires itself as old messages age out.
    const RECEIPTS_LIVE_FROM = Date.parse("2026-08-03T05:00:00Z");
    const settled = Date.now() - 10 * 60 * 1000; // give a phone time to answer
    const pushOn = (await pushStatus(clientId)).enabled;
    const pushSilent =
      pushOn &&
      thread.some(
        (m) =>
          m.dir === "outbound" &&
          !m.delivered_at &&
          Date.parse(m.at) > RECEIPTS_LIVE_FROM &&
          Date.parse(m.at) < settled,
      );
    return NextResponse.json({
      ok: true,
      unread: unreadCount(clientId, "outbound"),
      // Nothing to announce to someone already doing it.
      hasChatted: thread.some((m) => m.dir === "inbound"),
      // Notifications are on, we sent, and their phone never confirmed
      // drawing it — which is the one thing a 201 could never tell us.
      pushSilent,
    });
  }

  if (body.action !== "send") {
    let wa: Awaited<ReturnType<typeof loadWhatsAppThreadAction>> = [];
    try {
      wa = await loadWhatsAppThreadAction(clientId, 90);
    } catch {
      // History is a nicety; never let it stop the client seeing new messages.
    }
    // Opening the thread is reading it — clears the client's unread badge.
    markRead(clientId, "outbound");
    return NextResponse.json({
      ok: true,
      messages: mergeForDisplay(readThread(clientId), wa).map((m) => ({
        id: m.id,
        at: m.at,
        // Renamed for the client's frame of reference: "them" is the coach.
        from: m.dir === "inbound" ? "me" : "coach",
        text: m.text,
        via: m.via,
        // Only on their own messages, and only as far as "delivered".
        // Whether the coach has READ it is deliberately withheld: a client
        // watching "read 7am" with no reply until evening is the exact
        // pressure that makes WhatsApp stressful, and she genuinely does
        // reply within a day. "Has she got it?" is the real question, and
        // delivered answers it.
        ...(m.dir === "inbound" && m.via === "app"
          ? { delivered: !!m.delivered_at }
          : {}),
      })),
    });
  }

  // ── send ────────────────────────────────────────────────────────────────
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "Type a message first." }, { status: 400 });
  }
  if (!(await allowDaily("app-chat", token, DAILY_SEND_LIMIT)).ok) {
    return NextResponse.json(
      { ok: false, error: "That's a lot of messages today — try again tomorrow." },
      { status: 429 },
    );
  }

  const stored = appendMessage(clientId, {
    dir: "inbound",
    kind: "text",
    text: text.slice(0, MAX_LEN),
  });
  if (!stored) {
    return NextResponse.json({ ok: false, error: "Couldn't send. Try again." }, { status: 500 });
  }

  // Best-effort: a failed nudge must not fail the message the client sent.
  void notifyCoachOfClientMessage(clientId, {
    preview: text,
    messageId: stored.id,
  }).catch((e) =>
    console.error("[app-chat] coach notify failed:", e),
  );

  return NextResponse.json({
    ok: true,
    message: { id: stored.id, at: stored.at, from: "me", text: stored.text, via: "app" },
    // The UI shows the emergency card on this flag. Checked server-side so a
    // direct POST cannot skip it.
    emergency: isEmergency(text),
  });
}

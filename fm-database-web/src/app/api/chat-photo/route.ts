/**
 * POST /api/chat-photo — a client sending a photo in the chat.
 *
 * NOT /api/app-photo: that route already exists and serves the client's
 * avatar. Two different pictures of a client with one endpoint name is how
 * someone later "fixes" one and breaks the other.
 *
 * Multipart rather than base64-in-JSON: base64 inflates by a third, and the
 * point of compressing on the phone is to keep uploads small on Indian
 * mobile data.
 *
 * The photo is stored FIRST and the message written only if that succeeds.
 * A message pointing at a file that was never written shows the client a
 * broken image of something they know they sent, which reads as the app
 * losing their message.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { appendMessage } from "@/lib/fmdb/client-thread";
import { notifyCoachOfClientMessage } from "@/lib/fmdb/chat-notify";
import { saveChatPhoto, MAX_UPLOAD_BYTES } from "@/lib/fmdb/chat-media";
import { checkMealPhoto } from "@/lib/fmdb/meal-check";
import { appendMessage as appendReply, setMealOutcome } from "@/lib/fmdb/client-thread";
import { notifyClientOfCoachReply } from "@/lib/fmdb/chat-notify";
import { clientAppUrl } from "@/lib/fmdb/coach-mobile";
import { loadClientById } from "@/lib/fmdb/loader-extras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAILY_PHOTO_LIMIT = 20;
const MAX_CAPTION = 1000;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read the upload." }, { status: 400 });
  }

  const token = String(form.get("token") ?? "");
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }
  const clientId = lookup.client_id;

  if (!(await allowDaily("chat-photo", token, DAILY_PHOTO_LIMIT)).ok) {
    return NextResponse.json(
      { ok: false, error: "That's a lot of photos today — try again tomorrow." },
      { status: 429 },
    );
  }

  const photo = form.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return NextResponse.json({ ok: false, error: "No photo attached." }, { status: 400 });
  }
  if (photo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "That photo is too large." }, { status: 413 });
  }

  const saved = await saveChatPhoto(clientId, Buffer.from(await photo.arrayBuffer()));
  if (!saved) {
    return NextResponse.json(
      { ok: false, error: "That file didn't look like a photo." },
      { status: 400 },
    );
  }

  const caption = String(form.get("text") ?? "").trim().slice(0, MAX_CAPTION);
  const stored = appendMessage(clientId, {
    dir: "inbound",
    kind: "photo",
    text: caption,
    file: saved.file,
  });
  if (!stored) {
    return NextResponse.json({ ok: false, error: "Couldn't save that." }, { status: 500 });
  }

  void notifyCoachOfClientMessage(clientId, {
    preview: caption || "sent a photo",
    messageId: stored.id,
  }).catch((e) => console.error("[chat-photo] coach notify failed:", e));

  // Score the photo AFTER responding — a client's picture must appear the
  // instant they send it, whatever the checker is doing. Everything below is
  // best-effort: a failure leaves the photo delivered and the coach notified,
  // which is exactly where we were before the checker existed.
  void (async () => {
    try {
      const verdict = await checkMealPhoto(clientId, token, saved.file, stored.at);
      setMealOutcome(clientId, stored.id, verdict.outcome);

      if (verdict.clientLine) {
        const reply = appendReply(clientId, {
          dir: "outbound",
          kind: "text",
          text: verdict.clientLine,
          automated: true,
        });
        if (reply) {
          const c = (await loadClientById(clientId)) as
            | { mobile_number?: string; app_token?: string }
            | null;
          await notifyClientOfCoachReply(clientId, {
            appUrl: clientAppUrl(c?.app_token) ?? undefined,
            // No WhatsApp fallback for an automated line: a paid message is
            // for something the coach actually said.
            phone: null,
            messageId: reply.id,
          });
        }
      }

      if (verdict.outcome === "safety") {
        await notifyCoachOfClientMessage(clientId, {
          preview: `⚠ ${verdict.coachNote}`,
          messageId: stored.id,
        });
      }
    } catch (e) {
      console.error("[chat-photo] meal check failed:", e);
    }
  })();

  return NextResponse.json({
    ok: true,
    message: {
      id: stored.id,
      at: stored.at,
      from: "me",
      text: caption,
      via: "app",
      kind: "photo",
      file: saved.file,
    },
  });
}

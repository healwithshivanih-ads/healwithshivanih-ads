/**
 * POST /api/zoom-webhook — Zoom Cloud Recording event receiver.
 *
 * Triggered by Zoom when:
 *   - `endpoint.url_validation`        — first-time setup challenge
 *   - `recording.completed`            — audio + video ready
 *   - `recording.transcript_completed` — auto-transcript ready (preferred)
 *
 * Auth: HMAC-SHA256 signature over `v0:<timestamp>:<raw body>` keyed by
 * `ZOOM_WEBHOOK_SECRET_TOKEN`. Zoom puts the timestamp in
 * `x-zm-request-timestamp` and the signature in `x-zm-signature`.
 *
 * Setup: see docs/ZOOM_INTEGRATION_SETUP.md.
 *
 * Pipeline:
 *   1. Verify signature
 *   2. Persist raw event to ~/fm-plans/_zoom_events.yaml (audit)
 *   3. Match meeting → fm-coach client_id (by host_email / attendee email /
 *      meeting.topic against scheduled cal.com bookings)
 *   4. On transcript_completed: download .vtt via Zoom OAuth + save to
 *      ~/fm-plans/clients/<id>/recordings/<meeting_uuid>/
 *   5. Create a quick_note session YAML with the transcript text
 *   6. Trigger AI extraction (symptoms / supplements / labs / measurements)
 *
 * Steps 3-6 happen async — the webhook response is fire-and-forget so
 * Zoom doesn't time out. fm-coach uses pm2's stdout for visibility.
 */
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

interface ZoomUrlValidationPayload {
  event: "endpoint.url_validation";
  payload: { plainToken: string };
}

interface ZoomRecordingFile {
  id?: string;
  file_type?: string; // "MP4" | "M4A" | "TRANSCRIPT" | "CC" | "CHAT" | etc.
  file_extension?: string;
  download_url?: string;
  recording_type?: string;
  recording_start?: string;
  recording_end?: string;
  status?: string;
}

interface ZoomRecordingPayload {
  event: "recording.completed" | "recording.transcript_completed";
  payload: {
    account_id?: string;
    object?: {
      uuid?: string;
      id?: number | string;
      host_id?: string;
      host_email?: string;
      topic?: string;
      type?: number;
      start_time?: string;
      duration?: number;
      timezone?: string;
      recording_files?: ZoomRecordingFile[];
      participant_audio_files?: ZoomRecordingFile[];
    };
  };
  download_token?: string;
}

type ZoomPayload = ZoomUrlValidationPayload | ZoomRecordingPayload;

function isUrlValidation(p: unknown): p is ZoomUrlValidationPayload {
  return (
    !!p &&
    typeof p === "object" &&
    (p as { event?: string }).event === "endpoint.url_validation"
  );
}

function verifyZoomSignature(
  rawBody: string,
  timestamp: string | null,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!timestamp || !signatureHeader) return false;
  const message = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(message).digest("hex")}`;
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

async function appendAudit(event: string, body: unknown): Promise<void> {
  const root = getPlansRoot();
  const file = path.join(root, "_zoom_events.yaml");
  let arr: unknown[] = [];
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    /* missing — start fresh */
  }
  arr.unshift({ received_at: new Date().toISOString(), event, body });
  // Cap audit log at 200 rows (newest first).
  arr = arr.slice(0, 200);
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file, yaml.dump(arr, { sortKeys: false }), "utf-8");
  } catch {
    /* best-effort */
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "";
  const tsHeader = req.headers.get("x-zm-request-timestamp");
  const sigHeader = req.headers.get("x-zm-signature");

  // Parse body upfront (Zoom always sends JSON for both validation + events).
  let body: ZoomPayload;
  try {
    body = JSON.parse(rawBody) as ZoomPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // ── URL validation challenge ──────────────────────────────────────────────
  // Zoom sends this when the coach clicks "Validate URL" in the dashboard.
  // It expects plainToken back AND an encryptedToken (HMAC-SHA256 of
  // plainToken with the secret token). No signature header on the validation
  // request itself — Zoom is establishing that we hold the secret.
  if (isUrlValidation(body)) {
    const plainToken = body.payload.plainToken;
    if (!secret) {
      return NextResponse.json(
        {
          ok: false,
          error: "ZOOM_WEBHOOK_SECRET_TOKEN not set on the server",
        },
        { status: 500 },
      );
    }
    const encryptedToken = createHmac("sha256", secret).update(plainToken).digest("hex");
    return NextResponse.json({ plainToken, encryptedToken });
  }

  // ── Signature verification for real events ────────────────────────────────
  // Fail CLOSED (audit Phase-1b): an unset secret must REJECT events, not
  // process them unverified. (The URL-validation request above handles the
  // legitimate no-secret case separately and returns before here.)
  if (!secret || !verifyZoomSignature(rawBody, tsHeader, sigHeader, secret)) {
    console.warn("[zoom-webhook] missing secret or invalid signature");
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  const event = body.event;
  console.log("[zoom-webhook] event received", {
    event,
    topic: (body as ZoomRecordingPayload).payload?.object?.topic,
    uuid: (body as ZoomRecordingPayload).payload?.object?.uuid,
  });

  // Always 200 after auth so Zoom doesn't retry — processing is async best-effort.
  // Real handler runs after we respond, with `void` so we don't block.
  void appendAudit(event, body).catch(() => { /* best-effort */ });

  if (event === "recording.completed" || event === "recording.transcript_completed") {
    void processRecordingEvent(body as ZoomRecordingPayload).catch((err) => {
      console.error("[zoom-webhook] processRecordingEvent failed", err);
    });
  }

  return NextResponse.json({ ok: true, event });
}

/**
 * Async processor — runs AFTER the webhook response. Steps:
 *   1. Match the meeting to a client_id
 *   2. If matched + transcript event: download transcript + create session
 *   3. If matched + recording event but transcript not yet here: log + wait
 *      for the transcript event
 *   4. If unmatched: log to _zoom_unmatched.yaml for coach to review
 *
 * Steps 1-3 are implemented in subsequent commits — this stub is the
 * shell so the receiver can be deployed + validated before the rest of
 * the pipeline lands.
 */
async function processRecordingEvent(body: ZoomRecordingPayload): Promise<void> {
  const obj = body.payload?.object;
  if (!obj) return;
  // Defer actual processing to a separate worker module so this route
  // file stays small + the route handler returns quickly.
  const { processZoomRecording } = await import(
    "@/lib/server-actions/zoom-recording"
  );
  await processZoomRecording({
    event: body.event,
    meeting: obj,
    download_token: body.download_token,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fm-coach Zoom Cloud Recording webhook receiver",
    setup: "docs/ZOOM_INTEGRATION_SETUP.md",
    events_handled: [
      "endpoint.url_validation",
      "recording.completed",
      "recording.transcript_completed",
    ],
    auth: "x-zm-signature: v0=<hmac-sha256(v0:<ts>:<body>, ZOOM_WEBHOOK_SECRET_TOKEN)>",
    storage:
      "~/fm-plans/_zoom_events.yaml (audit) + ~/fm-plans/clients/<id>/recordings/<meeting_uuid>/ (recording + transcript)",
  });
}

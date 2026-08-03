/**
 * POST /api/guided-enroll — provision a guided-tier subscriber after payment.
 *
 * Called server-to-server by ochre-funnel's Razorpay webhook job (and later
 * the Play billing verifier). NOT a handover: a guided subscriber stays in
 * ochre-funnel's nurture — this endpoint only provisions app access.
 *
 * Auth: `x-guided-secret` must equal env GUIDED_ENROLL_SECRET. Fails CLOSED —
 * with the secret unset the route refuses (503) rather than running open.
 *
 * Idempotent on payment_id: a redelivered webhook returns the existing
 * subscriber (created: false) with the same token. Safe to retry blindly.
 *
 * On Fly this writes to the Mutagen-synced volume, so the record appears on
 * the coach's Macs with no manual step (same mechanism as intake).
 */
import { NextRequest, NextResponse } from "next/server";
import { createGuidedSubscriber } from "@/lib/fmdb/guided-tier";
import { getGuidedProtocol } from "@/lib/fmdb/guided-protocols";

export const dynamic = "force-dynamic";

const MAX_BODY_FIELD = 300;

function str(v: unknown, max = MAX_BODY_FIELD): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  const secret = process.env.GUIDED_ENROLL_SECRET || "";
  if (!secret) {
    return NextResponse.json({ ok: false, error: "enrolment not configured" }, { status: 503 });
  }
  if (req.headers.get("x-guided-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const payment_id = str(body.payment_id, 80);
  const protocol_slug = str(body.protocol_slug, 60);
  const email = str(body.email, 200);
  const display_name = str(body.display_name, 120) || "there";
  if (!payment_id) {
    return NextResponse.json({ ok: false, error: "payment_id required" }, { status: 400 });
  }
  if (!getGuidedProtocol(protocol_slug)) {
    return NextResponse.json({ ok: false, error: "unknown protocol" }, { status: 400 });
  }
  if (!email && !str(body.phone, 20)) {
    return NextResponse.json({ ok: false, error: "email or phone required" }, { status: 400 });
  }

  const dietRaw = str(body.dietary_preference, 30);
  const dietary_preference =
    dietRaw === "vegetarian" || dietRaw === "vegetarian_egg" || dietRaw === "jain" || dietRaw === "non_vegetarian"
      ? dietRaw
      : ("" as const);

  try {
    const { subscriber, created } = await createGuidedSubscriber({
      display_name,
      email,
      phone: str(body.phone, 20),
      protocol_slug,
      dietary_preference,
      payment_id,
      amount_paisa: typeof body.amount_paisa === "number" ? body.amount_paisa : 0,
      source: body.source === "play" ? "play" : "web",
      timezone: str(body.timezone, 60) || undefined,
    });
    const base = (process.env.GUIDED_APP_BASE_URL || "").replace(/\/$/, "");
    return NextResponse.json({
      ok: true,
      created,
      subscriber_id: subscriber.subscriber_id,
      app_token: subscriber.app_token,
      app_url: base ? `${base}/app/${subscriber.app_token}` : `/app/${subscriber.app_token}`,
      start_date: subscriber.start_date,
      protocol_slug: subscriber.protocol_slug,
    });
  } catch (err) {
    console.error("[guided-enroll] create failed:", err);
    return NextResponse.json({ ok: false, error: "provisioning failed" }, { status: 500 });
  }
}

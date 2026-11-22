/**
 * POST /api/guided-enroll/deactivate — switch off a course buyer's access
 * after a refund (Calm Gut: 7-day no-questions refund, Shivani 22 Nov 2026).
 *
 * Called server-to-server by ochre-funnel's admin page ("Refunded: turn off
 * access"). Same auth as enrolment: `x-guided-secret` must equal
 * GUIDED_ENROLL_SECRET; fails CLOSED (503) when the secret is unset.
 *
 * Body: one of { payment_id } (Razorpay id or "gift-…" key) or { email }
 * (every active course record on that address), plus an optional reason.
 * Effect: status → refunded. The link then shows "This course has ended",
 * the course API refuses it and the reminder cron skips it; this phone's
 * push subscription is removed so nothing more arrives.
 * Idempotent: a repeat call reports already_off.
 */
import { NextRequest, NextResponse } from "next/server";
import { findCourseSubscribersForRefund, markGuidedRefunded } from "@/lib/fmdb/guided-tier";
import { removeCourseSubscription } from "@/lib/fmdb/course-push";

export const dynamic = "force-dynamic";

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  const secret = process.env.GUIDED_ENROLL_SECRET || "";
  if (!secret) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  if (req.headers.get("x-guided-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const payment_id = str(body.payment_id, 80) || str(body.gift_key, 80);
  const email = str(body.email, 200);
  if (!payment_id && !email) {
    return NextResponse.json({ ok: false, error: "payment_id, gift_key or email required" }, { status: 400 });
  }
  try {
    const subs = await findCourseSubscribersForRefund({ payment_id, email });
    if (!subs.length) return NextResponse.json({ ok: false, error: "no course access found" }, { status: 404 });
    const results = [];
    for (const s of subs) {
      const changed = await markGuidedRefunded(s.subscriber_id);
      await removeCourseSubscription(s.subscriber_id).catch(() => {});
      results.push({ subscriber_id: s.subscriber_id, payment_id: s.payment_id, already_off: !changed });
    }
    return NextResponse.json({ ok: true, turned_off: results.filter((r) => !r.already_off).length, results });
  } catch (err) {
    console.error("[guided-deactivate] failed:", err);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}

/**
 * POST /api/m/push — the coach's own push subscription.
 *
 * Behind the /m session gate (any /api/m/* that isn't login/logout), so only
 * her signed-in device can register itself. That is the whole auth story: the
 * subscription is hers, not a client's, so there is no token to scope it by.
 *
 * Actions: subscribe | unsubscribe | status (default).
 */
import { NextRequest, NextResponse } from "next/server";
import { loadAuth } from "@/lib/fmdb/coach-auth";
import {
  coachPushEnabled,
  listCoachSubscriptions,
  removeCoachSubscription,
  saveCoachSubscription,
} from "@/lib/fmdb/coach-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  let body: { action?: string; subscription?: unknown; endpoint?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (body.action === "subscribe") {
    const sub = body.subscription as { endpoint?: string } | undefined;
    if (!sub?.endpoint) {
      return NextResponse.json({ ok: false, error: "no subscription" }, { status: 400 });
    }
    const ok = saveCoachSubscription(
      sub as Parameters<typeof saveCoachSubscription>[0],
      body.label,
    );
    return NextResponse.json({ ok, devices: listCoachSubscriptions().length });
  }

  if (body.action === "unsubscribe") {
    const ok = removeCoachSubscription(body.endpoint);
    return NextResponse.json({ ok, devices: listCoachSubscriptions().length });
  }

  return NextResponse.json({
    ok: true,
    enabled: coachPushEnabled(),
    devices: listCoachSubscriptions().length,
  });
}

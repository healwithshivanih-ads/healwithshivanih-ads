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
  sendPushToCoach,
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

  // Prove the whole chain — subscription, VAPID keys, Apple's push service,
  // the service worker — without needing a client to message first. Before
  // this the only way to know it worked was to ask someone to write to you.
  if (body.action === "test") {
    const { sent, pruned } = await sendPushToCoach({
      title: "Ochre Coach",
      body: "Notifications are working. This is the only test you'll get.",
      url: "/m/settings",
      tag: "coach-test",
    });
    return NextResponse.json({
      ok: sent > 0,
      sent,
      pruned,
      // Say WHICH failure it is. "Didn't work" sends someone hunting in the
      // wrong place; these three have completely different fixes.
      error:
        sent > 0
          ? undefined
          : listCoachSubscriptions().length === 0
            ? "No device registered — turn notifications on first."
            : pruned > 0
              ? "This device's registration had expired. Turn it off and on again."
              : "Registered, but the push service refused it. Check VAPID keys on the server.",
    });
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

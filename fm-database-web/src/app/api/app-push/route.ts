/**
 * POST /api/app-push — client push subscription management for the app's
 * notification toggle (client settings screen).
 *
 * Auth: body.token must resolve to a published plan (same posture as the
 * other /api/app-* routes). client_id is derived server-side from the token.
 *
 * Actions:
 *   subscribe   { token, subscription }  — store + enable
 *   unsubscribe { token, endpoint? }     — drop one device, or all of them
 *   status      { token }                — { enabled }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import {
  saveSubscription,
  removeSubscription,
  pushStatus,
  sendPushToClient,
  type WebPushSubscription,
} from "@/lib/fmdb/push-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
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
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "subscribe") {
      const sub = body.subscription as WebPushSubscription | undefined;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return NextResponse.json({ ok: false, error: "invalid subscription" }, { status: 400 });
      }
      await saveSubscription(clientId, {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      });
      // Prove it immediately, on the device that just asked. "Saved your
      // subscription" and "your phone will actually show this" are different
      // claims, and only the second one is what they wanted. A client who
      // sees nothing now knows in five seconds instead of finding out days
      // later by missing a reply — and the coach is out of the loop.
      const verified = await sendPushToClient(clientId, {
        title: "The Ochre Tree",
        body: "Notifications are on — this is how a message from Shivani will look.",
        url: "/",
        tag: "push-check",
      });
      return NextResponse.json({ ok: true, verified, ...(await pushStatus(clientId)) });
    }
    if (action === "unsubscribe") {
      // With an endpoint only THIS device stops. A client turning
      // notifications off on their laptop must not silence their phone.
      const ep = typeof body.endpoint === "string" ? body.endpoint : undefined;
      await removeSubscription(clientId, ep);
      return NextResponse.json({ ok: true, ...(await pushStatus(clientId)) });
    }
    if (action === "status") {
      return NextResponse.json({ ok: true, ...(await pushStatus(clientId)) });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "push action failed" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/app-push — client push subscription management for the app's
 * notification toggle (client settings screen).
 *
 * Auth: body.token must resolve to a published plan (same posture as the
 * other /api/app-* routes). client_id is derived server-side from the token.
 *
 * Actions:
 *   subscribe   { token, subscription }  — store + enable
 *   unsubscribe { token }                — drop the stored subscription
 *   status      { token }                — { enabled }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import {
  saveSubscription,
  removeSubscription,
  pushStatus,
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
      return NextResponse.json({ ok: true, enabled: true });
    }
    if (action === "unsubscribe") {
      await removeSubscription(clientId);
      return NextResponse.json({ ok: true, enabled: false });
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

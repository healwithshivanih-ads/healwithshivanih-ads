/**
 * POST /api/app-reminders — client reminder-preference management for the
 * app's Account screen (time-of-day nudges, delivered via web push).
 *
 * Auth: body.token must resolve to a published plan (same posture as the
 * other /api/app-* routes). client_id is derived server-side from the token.
 *
 * Actions:
 *   save   { token, items: ReminderItem[] }  — overwrite the stored set
 *   status { token }                         — { items } (server is source of truth)
 *
 * Delivery is the /api/cron/app-reminders job, which reads the stored set and
 * fires a push at each enabled reminder's time. A reminder only arrives if the
 * client has ALSO turned push notifications on (see /api/app-push).
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { saveReminders, readReminders } from "@/lib/fmdb/reminders-server";

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
    if (action === "save") {
      const items = Array.isArray(body.items) ? body.items : [];
      const saved = await saveReminders(clientId, token, items);
      return NextResponse.json({ ok: true, items: saved });
    }
    if (action === "status") {
      const doc = await readReminders(clientId);
      return NextResponse.json({ ok: true, items: doc?.items ?? [] });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "reminder action failed" },
      { status: 500 },
    );
  }
}

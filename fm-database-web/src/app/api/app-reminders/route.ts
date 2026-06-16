/**
 * POST /api/app-reminders — store the client's reminder OVERRIDES (which of the
 * plan-derived reminders they've silenced, plus any time they pinned).
 *
 * Auth: body.token must resolve to a published plan (same posture as the other
 * /api/app-* routes). client_id is derived server-side from the token.
 *
 * Actions:
 *   save   { token, items: [{id,on,time,time_custom}] }  — overwrite overrides
 *   status { token }                                      — { overrides }
 *
 * The reminders themselves are derived from the live plan and applied at
 * display + fire time; this route only persists the client's choices. A
 * reminder only arrives if the client has ALSO enabled push (see /api/app-push).
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { saveOverrides, readOverrides, itemsToOverrides } from "@/lib/fmdb/reminders-server";

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
      const overrides = itemsToOverrides(items);
      await saveOverrides(clientId, token, overrides);
      return NextResponse.json({ ok: true, overrides });
    }
    if (action === "status") {
      const { overrides } = await readOverrides(clientId);
      return NextResponse.json({ ok: true, overrides });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "reminder action failed" },
      { status: 500 },
    );
  }
}

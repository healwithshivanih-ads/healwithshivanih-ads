/**
 * POST /api/app-travel — travel flag write-back from the client app.
 *
 * The client marks "I'm travelling" (date range + optional context) or
 * cancels an active travel window. Lands as a quick_note session with a
 * structured travel_response; the app shows a rules-based travel card
 * during the window and the weekly menu generator reads it as feedback.
 *
 * Auth: body.token must resolve to a published plan's letter_token (the
 * same token that opened the app). The client is derived server-side
 * from the token — never trusted from the request.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";

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
  if (!(await allowDaily("app-travel", token, 6)).ok) {
    return NextResponse.json({ ok: false, error: "too many updates today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  try {
    const out = (await runShim("save-app-travel.py", {
      client_id: lookup.client_id,
      from: typeof body.from === "string" ? body.from.slice(0, 10) : "",
      to: typeof body.to === "string" ? body.to.slice(0, 10) : "",
      kind: typeof body.kind === "string" ? body.kind.slice(0, 20) : "travel",
      location: typeof body.location === "string" ? body.location.slice(0, 120) : "",
      context: typeof body.context === "string" ? body.context.slice(0, 600) : "",
      cancelled: body.cancelled === true,
    })) as { ok?: boolean; session_id?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, session_id: out.session_id });
  } catch (err) {
    console.error("[app-travel] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

/**
 * POST /api/app-checkin — weekly check-in write-back from the client app.
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
  if (!(await allowDaily("app-checkin", token, 8)).ok) {
    return NextResponse.json({ ok: false, error: "too many check-ins today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  try {
    const out = (await runShim("save-app-checkin.py", {
      client_id: lookup.client_id,
      week: Number(body.week) || 0,
      rating: Number(body.rating) || 0,
      feel: typeof body.feel === "string" ? body.feel.slice(0, 2000) : "",
      concerns: typeof body.concerns === "string" ? body.concerns.slice(0, 2000) : "",
      supplements: Array.isArray(body.supplements) ? body.supplements.slice(0, 30) : [],
      practices: Array.isArray(body.practices) ? body.practices.slice(0, 30) : [],
    })) as { ok?: boolean; session_id?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, session_id: out.session_id });
  } catch (err) {
    console.error("[app-checkin] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

/**
 * POST /api/app-msq — MSQ symptom-questionnaire write-back from the client app.
 *
 * Auth: body.token must resolve to a published plan's letter_token (the
 * same token that opened the app) — identical posture to /api/app-checkin.
 * The client is derived server-side from the token; totals are recomputed
 * in the save shim, never trusted from the request.
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
  if (!(await allowDaily("app-msq", token, 4)).ok) {
    return NextResponse.json({ ok: false, error: "too many submissions today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const answersIn = body.answers;
  if (!answersIn || typeof answersIn !== "object" || Array.isArray(answersIn)) {
    return NextResponse.json({ ok: false, error: "answers required" }, { status: 400 });
  }
  // size cap: the instrument has ~72 items; anything bigger is garbage
  const entries = Object.entries(answersIn as Record<string, unknown>).slice(0, 100);

  try {
    const out = (await runShim("save-app-msq.py", {
      client_id: lookup.client_id,
      week: Number(body.week) || 0,
      answers: Object.fromEntries(entries),
    })) as { ok?: boolean; session_id?: string; total?: number; band?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, session_id: out.session_id, total: out.total, band: out.band });
  } catch (err) {
    console.error("[app-msq] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

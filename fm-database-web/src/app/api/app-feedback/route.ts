/**
 * POST /api/app-feedback — programme feedback write-back from the client app.
 *
 * Auth: body.token must resolve to the client's app token (the same token that
 * opened the app). The client is derived server-side from the token — never
 * trusted from the request. The body is sanitised against the one shared
 * definition (lib/fmdb/programme-feedback.ts) before it reaches the writer.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { sanitiseFeedback } from "@/lib/fmdb/programme-feedback";
import { notifyCoachOfFeedback } from "@/lib/fmdb/feedback-notify";

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
  if (!(await allowDaily("app-feedback", token, 4)).ok) {
    return NextResponse.json({ ok: false, error: "too many submissions today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const response = sanitiseFeedback(body);
  if (typeof response === "string") {
    return NextResponse.json({ ok: false, error: response }, { status: 400 });
  }

  try {
    const out = (await runShim("save-app-feedback.py", {
      client_id: lookup.client_id,
      response,
    })) as { ok?: boolean; session_id?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    // Tell the coach. Fire-and-forget: the client's submit must not wait on
    // Gmail, and a failed email must never turn a saved answer into an error.
    void notifyCoachOfFeedback(lookup.client_id, response)
      .then((r) => console.log(`[app-feedback] coach notified: email=${r.email} push=${r.push}`))
      .catch((e) => console.error("[app-feedback] coach notify failed:", e));
    return NextResponse.json({ ok: true, session_id: out.session_id });
  } catch (err) {
    console.error("[app-feedback] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

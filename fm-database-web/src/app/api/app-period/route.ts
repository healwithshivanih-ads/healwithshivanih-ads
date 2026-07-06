/**
 * POST /api/app-period — period-start write-back from the client app.
 *
 * The client taps "My period started today" in the seed-cycling section so the
 * app can work out which seeds to eat each day. The date lands in
 * client.last_menstrual_period (+ cycle_status → menstruating when blank), the
 * same field the coach dashboard and plan generator read.
 *
 * Auth: body.token must resolve to the client's app/letter token. The client
 * is derived server-side from the token — never trusted from the request.
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
  if (!(await allowDaily("app-period", token, 6)).ok) {
    return NextResponse.json({ ok: false, error: "too many updates today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  // Optional ISO date; the shim defaults to today and re-validates the window.
  const date = typeof body.date === "string" ? body.date : null;

  try {
    const out = (await runShim("save-app-period.py", {
      client_id: lookup.client_id,
      date,
    })) as { ok?: boolean; last_menstrual_period?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, last_menstrual_period: out.last_menstrual_period });
  } catch (err) {
    console.error("[app-period] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

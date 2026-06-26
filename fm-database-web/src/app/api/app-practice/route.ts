/**
 * POST /api/app-practice — log a completed in-app practice round.
 *
 * Fires when a client finishes an EFT tapping round or a guided-breathing
 * session in the companion app. The record (SUDS before/after for EFT,
 * rounds/seconds for breathing) lands in the client's _practice_log.jsonl —
 * the compliance + effectiveness dataset.
 *
 * Auth: body.token must resolve to a published plan's letter_token (the same
 * token that opened the app). The client is derived server-side — never
 * trusted from the request.
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
  if (!(await allowDaily("app-practice", token, 40)).ok) {
    return NextResponse.json({ ok: false, error: "too many logs today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const kind = body.kind === "eft" || body.kind === "breath" || body.kind === "sleep" ? body.kind : "";
  if (!kind) {
    return NextResponse.json({ ok: false, error: "bad kind" }, { status: 400 });
  }

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  try {
    const out = (await runShim("save-app-practice.py", {
      client_id: lookup.client_id,
      kind,
      practice_id: typeof body.practice_id === "string" ? body.practice_id.slice(0, 120) : "",
      name: typeof body.name === "string" ? body.name.slice(0, 160) : "",
      theme: typeof body.theme === "string" ? body.theme.slice(0, 60) : null,
      suds_before: num(body.suds_before),
      suds_after: num(body.suds_after),
      rounds: num(body.rounds),
      seconds: num(body.seconds),
    })) as { ok?: boolean; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "log failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[app-practice] log failed:", err);
    return NextResponse.json({ ok: false, error: "log failed" }, { status: 500 });
  }
}

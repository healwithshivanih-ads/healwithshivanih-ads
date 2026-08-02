/**
 * POST /api/m-bridge/ask — answer an AI question on behalf of the Fly app.
 *
 * Runs on the MAC. The coach app on Fly can't answer AI questions itself: the
 * answer needs the full client record, which Tier A+B deliberately keeps off
 * the public box. So Fly asks here.
 *
 * AUTH: shared secret in `x-coach-bridge`, compared in constant time. This is
 * the same posture as /api/cron/* — a public path PREFIX (so it is reachable
 * at all) with a mandatory secret enforced by the handler.
 *
 * INERT BY DEFAULT: with COACH_BRIDGE_SECRET unset this route 404s, exactly as
 * if it did not exist. Turning the bridge on is an explicit act on both hosts.
 *
 * It answers questions only — it cannot read or write anything the caller
 * names beyond a client id, and it never returns the raw record.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { clientQuickChatAction } from "@/lib/server-actions/client-quick-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function secretOk(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // keep the mismatch path from being obviously faster
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.COACH_BRIDGE_SECRET ?? "";
  if (!expected) return new NextResponse("Not Found", { status: 404 });

  const supplied = req.headers.get("x-coach-bridge") ?? "";
  if (!supplied || !secretOk(supplied, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { client_id?: string; question?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const clientId = String(body.client_id ?? "");
  const question = String(body.question ?? "").trim();
  if (!SAFE_ID.test(clientId) || !question) {
    return NextResponse.json({ ok: false, error: "client_id and question required" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const res = await clientQuickChatAction(clientId, question, history as never);
  return NextResponse.json(res);
}

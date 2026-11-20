/**
 * POST /api/app-supply — the client's own supply taps from the order sheet:
 * "I've ordered it", "It's arrived", "I already have it", "Undo". See src/lib/fmdb/supply.ts.
 *
 * Auth: body.token resolves to the client; the client id is never taken from
 * the request. Writes one line to _supply.<host>.jsonl and nothing else — no
 * message, no notification.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { appendSupplyLine } from "@/lib/fmdb/supply-store";

export const dynamic = "force-dynamic";

const ITEM_RE = /^(s|rx)-[a-z0-9-]{1,80}$/;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (token.length < 16) return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  const op = body.op;
  const item = typeof body.item === "string" ? body.item : "";
  if ((op !== "ordered" && op !== "arrived" && op !== "have" && op !== "undo") || !ITEM_RE.test(item)) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
  if (op === "arrived") {
    // The client's local day; allow a day either side of UTC for time zones.
    const diff = Math.abs(Date.parse(`${date}T12:00:00Z`) - Date.now());
    if (!date || !(diff < 2 * 86400000)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  }
  if (!(await allowDaily("app-supply", token, 60)).ok) {
    return NextResponse.json({ ok: false, error: "too many updates today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });

  const ok = appendSupplyLine(lookup.client_id, {
    op,
    item,
    ts: new Date().toISOString(),
    ...(op === "arrived" ? { date } : {}),
  });
  if (!ok) return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

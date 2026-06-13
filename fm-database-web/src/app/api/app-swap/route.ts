/**
 * POST /api/app-swap — meal-swap write-back from the client app.
 *
 * The client swaps a meal for a coach-approved alternative from their own
 * plan. Lands as a quick_note session (source: client_app_swap) so the coach
 * sees what the client actually ate. Does not rewrite the plan.
 *
 * Auth: body.token resolves to the client server-side (never trusted from
 * the request). No AI, no cost — a plain file write.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

const seen = new Map<string, { day: string; count: number }>();

function throttled(token: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const cur = seen.get(token);
  if (!cur || cur.day !== day) {
    seen.set(token, { day, count: 1 });
    return false;
  }
  cur.count += 1;
  return cur.count > 40; // generous — clients may swap several meals a day
}

function intOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

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
  if (throttled(token)) {
    return NextResponse.json({ ok: false, error: "too many swaps today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }
  const toDish = typeof body.to_dish === "string" ? body.to_dish.slice(0, 200) : "";
  if (!toDish) {
    return NextResponse.json({ ok: false, error: "to_dish required" }, { status: 400 });
  }

  try {
    const out = (await runShim("save-app-swap.py", {
      client_id: lookup.client_id,
      slot: typeof body.slot === "string" ? body.slot.slice(0, 40) : "",
      from_dish: typeof body.from_dish === "string" ? body.from_dish.slice(0, 200) : "",
      to_dish: toDish,
      from_kcal: intOrNull(body.from_kcal),
      to_kcal: intOrNull(body.to_kcal),
      date: typeof body.date === "string" ? body.date.slice(0, 10) : "",
    })) as { ok?: boolean; session_id?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, session_id: out.session_id });
  } catch (err) {
    console.error("[app-swap] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

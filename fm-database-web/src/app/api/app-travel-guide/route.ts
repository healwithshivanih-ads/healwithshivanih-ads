/**
 * POST /api/app-travel-guide — tier B (client copilot) of the travel cascade.
 *
 * Called by the travel card's "Get foods for {location}" button when there is
 * no pre-authored (A) guide and no curated (C) match. Generates a destination-
 * local, plan-gated guide via Sonnet and caches it onto the client's active
 * travel flag (travel_response.local_foods) so it renders next load too.
 *
 * Auth: body.token must resolve to a published plan's letter_token (same token
 * that opened the app). The client is derived server-side from the token.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { coerceGuide } from "@/lib/fmdb/travel-foods";

export const dynamic = "force-dynamic";

// modest in-memory throttle — generation is the expensive call
const seen = new Map<string, { day: string; count: number }>();

function throttled(token: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const cur = seen.get(token);
  if (!cur || cur.day !== day) {
    seen.set(token, { day, count: 1 });
    return false;
  }
  cur.count += 1;
  return cur.count > 8;
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
    return NextResponse.json({ ok: false, error: "too many requests today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  try {
    const out = (await runShim("generate-travel-guide.py", {
      client_id: lookup.client_id,
      source: "copilot",
    })) as { ok?: boolean; guide?: unknown; error?: string };
    if (!out.ok) {
      // Graceful: no credits / no window → card stays on its current tier.
      return NextResponse.json({ ok: false, error: out.error ?? "unavailable" });
    }
    return NextResponse.json({ ok: true, guide: coerceGuide(out.guide) });
  } catch (err) {
    console.error("[app-travel-guide] failed:", err);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }
}

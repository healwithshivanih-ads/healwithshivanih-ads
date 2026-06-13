/**
 * POST /api/app-installed — the client app reports it's running INSTALLED
 * (home-screen / standalone), a truer adoption signal than "opened".
 *
 * Auth: body.token resolves to a client server-side (same posture as the
 * other /api/app-* routes). client_id is never trusted from the request.
 * The client only calls this when it detects standalone display-mode or the
 * `appinstalled` event fires — so a coach previewing in a normal tab never
 * trips it.
 *
 * Body: { token, source?: "standalone"|"appinstalled", platform?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { recordAppInstalled } from "@/lib/fmdb/app-installed";

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
  const lookup = await resolveAppToken(token);
  if (!lookup.ok || !lookup.client_id) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const source = body.source === "appinstalled" ? "appinstalled" : "standalone";
  const platform = typeof body.platform === "string" ? body.platform.slice(0, 32) : "";

  await recordAppInstalled(lookup.client_id, { source, platform });
  return NextResponse.json({ ok: true });
}

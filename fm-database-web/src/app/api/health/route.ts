/**
 * GET /api/health — Fly.io health-check endpoint.
 *
 * Returns 200 with a tiny JSON body. Used by the Fly load balancer to
 * confirm the app is up before routing traffic to a new machine after a
 * deploy. Public (the middleware allowlist explicitly includes this
 * path) so the health check doesn't have to deal with Basic Auth.
 *
 * Kept deliberately cheap — no DB / file-system reads. If you ever want
 * a deeper "is everything wired" probe, add a separate `/api/ready`
 * route that reads a sentinel from disk and trusts the catalogue file
 * count, but DON'T put it on the health check path or a slow Anthropic
 * dep could fail the LB into restart loops.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fm-coach",
    ts: new Date().toISOString(),
  });
}

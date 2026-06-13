/**
 * GET /api/app-photo/<token> — serve the client's avatar for the companion app.
 *
 * Auth: the token resolves to a client server-side (same posture as the other
 * /api/app-* routes). We never trust a client_id from the request.
 *
 * Resolution order:
 *   1. _app_photo.{ext}  — a photo the CLIENT set inside the app (app-only).
 *   2. photo.{ext}       — the coach-account photo (set at intake or by the
 *                          coach on the dashboard).
 * So a coach/intake photo flows THROUGH to the app, and the client can override
 * it with their own in-app photo — which lives in a separate file the coach UI
 * never reads, so there is no backward flow to the coach record.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveAppToken } from "@/lib/server-actions/letter-token";

export const dynamic = "force-dynamic";

const EXTS: Array<[string, string]> = [
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
];

function plansRoot(): string {
  return process.env.FMDB_PLANS_DIR
    ? path.resolve(process.env.FMDB_PLANS_DIR)
    : path.join(os.homedir(), "fm-plans");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const lookup = await resolveAppToken(token);
  if (!lookup.ok || !lookup.client_id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const dir = path.join(plansRoot(), "clients", lookup.client_id);
  // App-set photo wins; coach/intake photo is the fallback.
  const stems = ["_app_photo", "photo"];

  for (const stem of stems) {
    for (const [ext, mime] of EXTS) {
      try {
        const bytes = await fs.readFile(path.join(dir, `${stem}.${ext}`));
        return new NextResponse(new Uint8Array(bytes), {
          status: 200,
          headers: { "Content-Type": mime, "Cache-Control": "no-store" },
        });
      } catch {
        /* try next */
      }
    }
  }

  return new NextResponse("Not found", { status: 404 });
}

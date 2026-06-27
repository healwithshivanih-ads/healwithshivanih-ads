/**
 * POST /api/app-photo — the client sets their OWN avatar from inside the app.
 *
 * Auth: body.token resolves to a client server-side (same posture as the other
 * /api/app-* routes). The image is a base64 JPEG (the app downscales it before
 * sending). It's written to clients/<id>/_app_photo.jpg — a SEPARATE file from
 * the coach-account photo (photo.jpg). The coach dashboard only ever reads
 * photo.*, so an in-app photo never flows back to the coach record. The app's
 * own GET /api/app-photo/<token> prefers _app_photo.* so the client sees theirs.
 *
 * action "clear" removes the override (the app falls back to the coach photo).
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB decoded — the app downscales to ~480px

function clientDir(clientId: string): string {
  const root = process.env.FMDB_PLANS_DIR
    ? path.resolve(process.env.FMDB_PLANS_DIR)
    : path.join(os.homedir(), "fm-plans");
  return path.join(root, "clients", clientId);
}

function decodeImage(b64: unknown): Buffer | null {
  if (typeof b64 !== "string" || !b64.trim()) return null;
  let raw = b64.trim();
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma !== -1) raw = raw.slice(comma + 1);
  }
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
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
  if (!(await allowDaily("app-photo", token, 20)).ok) {
    return NextResponse.json({ ok: false, error: "too many updates today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok || !lookup.client_id) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const dir = clientDir(lookup.client_id);
  const action = typeof body.action === "string" ? body.action : "set";

  try {
    // The app only ever writes _app_photo.jpg; remove other-ext strays so the
    // GET route resolves deterministically.
    const others = ["_app_photo.jpeg", "_app_photo.png", "_app_photo.webp"];

    if (action === "clear") {
      for (const f of ["_app_photo.jpg", ...others]) {
        try {
          await fs.unlink(path.join(dir, f));
        } catch {
          /* not there — fine */
        }
      }
      return NextResponse.json({ ok: true, cleared: true });
    }

    const buf = decodeImage(body.image_b64);
    if (!buf) {
      return NextResponse.json({ ok: false, error: "invalid image" }, { status: 400 });
    }
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, "_app_photo.jpg");
    const tmp = path.join(dir, `_app_photo.${process.pid}.tmp`);
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, dest);
    for (const f of others) {
      try {
        await fs.unlink(path.join(dir, f));
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[app-photo] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

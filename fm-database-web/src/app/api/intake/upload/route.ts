/**
 * POST /api/intake/upload — token-scoped public file upload for the client
 * intake form (e.g. "photo your medicine strips").
 *
 * SECURITY MODEL: this route is PUBLIC (the intake form has no login) — the
 * intake TOKEN is the auth. We never trust a client_id from the request; we
 * resolve token → client_id server-side via the same `lookup` action the form
 * uses, and refuse if the token is invalid/expired. The token is a 192-bit
 * secret the coach sent privately, so a valid token == the client themselves
 * uploading to their own file.
 *
 * WHY A ROUTE HANDLER (not a Server Action): a File through a Server Action is
 * array-counted by React Flight and a ~1 MB file throws "Maximum array nesting
 * exceeded" before the body runs. Route handlers parse FormData natively.
 *
 * Works in Fly intake-only mode (the public allowlist includes /api/intake/);
 * saves under plansRoot() which Fly points at the Mutagen-synced volume.
 * Returns only {ok, filename} — never the absolute path (info leak).
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runShim } from "@/lib/fmdb/shim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const OK_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf"]);
const OK_MIME_PREFIX = ["image/"];
const OK_MIME_EXACT = new Set(["application/pdf"]);

function plansRoot(): string {
  const env = process.env.FMDB_PLANS_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-plans");
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const token = form.get("token");
    const file = form.get("file");

    if (typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "file_required" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: "empty_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    // Type gate — be lenient (phones send octet-stream) but require an
    // image/pdf extension OR mime.
    const ext = path.extname(file.name || "").toLowerCase();
    const mime = (file.type || "").toLowerCase();
    const mimeOk =
      OK_MIME_PREFIX.some((p) => mime.startsWith(p)) || OK_MIME_EXACT.has(mime);
    if (!OK_EXT.has(ext) && !mimeOk) {
      return NextResponse.json(
        { ok: false, error: "unsupported_type" },
        { status: 415 },
      );
    }

    // Resolve token → client_id server-side. NEVER trust a client_id from the
    // request. Reuses the exact validation the form's lookup uses.
    let look: { ok?: boolean; client_id?: string } | null = null;
    try {
      look = (await runShim("intake-token-action.py", {
        action: "lookup",
        token: token.trim(),
      })) as { ok?: boolean; client_id?: string };
    } catch {
      return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 502 });
    }
    if (!look?.ok || !look.client_id) {
      return NextResponse.json({ ok: false, error: "invalid_or_expired" }, { status: 403 });
    }
    const clientId = look.client_id;

    // Save to the client's files dir, date-prefixed + dedup. Sanitise filename.
    const safeBase = (file.name || "upload")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/^_+/, "")
      .slice(0, 80) || "upload";
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(plansRoot(), "clients", clientId, "files");
    await fs.mkdir(dir, { recursive: true });

    const fileExt = path.extname(safeBase);
    const stem = path.basename(safeBase, fileExt);
    let stored = `${today}-intake-${safeBase}`;
    let target = path.join(dir, stored);
    let n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fs.access(target);
        stored = `${today}-intake-${stem}-${n}${fileExt}`;
        target = path.join(dir, stored);
        n += 1;
      } catch {
        break;
      }
    }

    const buf = await file.arrayBuffer();
    await fs.writeFile(target, Buffer.from(buf));

    return NextResponse.json({ ok: true, filename: stored });
  } catch (err) {
    console.error("[intake/upload] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}

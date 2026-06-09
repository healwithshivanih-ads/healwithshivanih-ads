import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Serve a client attachment from ~/fm-plans/clients/{id}/files/{name}.
 *
 * Used by the WhatsApp chat panel to render images/documents a client sent
 * (downloaded + saved by /api/whatsapp-webhook). Read-only, no auth beyond
 * the localhost/Tailscale boundary the coach UI already lives behind — the
 * same posture as /api/client-photo.
 */

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;

  // Sanitise: safe client id, and a filename with no path traversal.
  if (!/^[\w-]+$/.test(id)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!/^[\w.\-]+$/.test(name) || name.includes("..")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const plansRoot = process.env.FMDB_PLANS_DIR
    ? path.resolve(process.env.FMDB_PLANS_DIR)
    : path.join(os.homedir(), "fm-plans");

  const filePath = path.join(plansRoot, "clients", id, "files", name);
  // Defence-in-depth: ensure the resolved path is still inside files/.
  const filesDir = path.join(plansRoot, "clients", id, "files");
  if (!path.resolve(filePath).startsWith(path.resolve(filesDir) + path.sep)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  try {
    const bytes = await fs.readFile(filePath);
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    const mime = EXT_MIME[ext] || "application/octet-stream";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

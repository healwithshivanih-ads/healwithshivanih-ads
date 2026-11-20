import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { resolvePersonDir } from "@/lib/fmdb/person-dir";

/**
 * Serve one file of one body age report from <person>/files/body-age/<report no>/<name>: the PDF, the email
 * preview and its two images. Written there by scripts/body-age-report.py as DRAFTS for the coach.
 *
 * Coach-only: it sits behind the same gate as every other coach route (proxy.ts; 404 on Fly, where
 * FLY_INTAKE_ONLY=1). Read-only. Every path part is a plain name, checked before it touches the disk.
 */

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  png: "image/png",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; report: string; name: string }> },
) {
  const { id, report, name } = await params;
  if (!/^[\w-]+$/.test(id) || !/^[\w-]+$/.test(report) || !/^\w[\w .,'()-]*$/.test(name) || name.includes("..")) {
    return new NextResponse("Bad request", { status: 400 });
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const mime = EXT_MIME[ext];
  if (!mime) return new NextResponse("Bad request", { status: 400 });

  const dir = path.join(resolvePersonDir(id), "files", "body-age", report);
  const filePath = path.join(dir, name);
  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  try {
    const bytes = await fs.readFile(filePath);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        // Drafts are rebuilt in place under the same name: never serve a stale one.
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

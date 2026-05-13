/**
 * GET /resources/[slug]/file
 * Streams the registered file for a resource directly to the browser.
 */

import { type NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { loadResourceBySlug } from "@/lib/fmdb/loader-extras";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".mp4":  "video/mp4",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8",
  ".csv":  "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const resource = await loadResourceBySlug(slug);
  if (!resource) {
    return new NextResponse("resource not found", { status: 404 });
  }

  const filePath = resource.file_path;
  if (!filePath) {
    return new NextResponse("resource has no file_path", { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return new NextResponse(`file not readable at: ${filePath}`, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const filename = path.basename(filePath);

  const disposition =
    contentType === "application/pdf" || contentType.startsWith("image/")
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(buf.byteLength),
    },
  });
}

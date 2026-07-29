import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { resolvePersonDir } from "@/lib/fmdb/person-dir";

/** Serve a client photo from ~/fm-plans/clients/{id}/photo.{ext}
 *  (or prospects/{id}/ if they've been parked — see resolvePersonDir). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sanitise: only allow safe client IDs (alphanum, dash, underscore)
  if (!/^[\w-]+$/.test(id)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  // id is already sanitised to [\w-]+ above, so this cannot escape the root.
  const dir = resolvePersonDir(id);

  const extensions: Array<[string, string]> = [
    ["jpg",  "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png",  "image/png"],
    ["webp", "image/webp"],
  ];

  for (const [ext, mime] of extensions) {
    const photoPath = path.join(dir, `photo.${ext}`);
    try {
      const bytes = await fs.readFile(photoPath);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // try next extension
    }
  }

  return new NextResponse("Not found", { status: 404 });
}

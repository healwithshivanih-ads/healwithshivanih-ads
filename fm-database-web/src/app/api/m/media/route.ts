/**
 * GET /api/m/media?client=…&file=… — the same photo, for the coach.
 *
 * Behind the /m session gate (see middleware-policy), which is why this is a
 * separate route rather than a mode of the client one: the two have entirely
 * different auth, and a single handler that accepts either is a handler that
 * will one day accept neither properly.
 */
import { NextRequest, NextResponse } from "next/server";
import { readChatPhoto } from "@/lib/fmdb/chat-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const buf = await readChatPhoto(client, file);
  if (!buf) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

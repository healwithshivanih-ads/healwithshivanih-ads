/**
 * GET /api/chat-media?token=…&file=… — serve a chat photo to the client.
 *
 * Scoped by the token, so a client can only ever fetch photos from their own
 * thread; the filename is matched against the exact shape we generate, and
 * the resolved path is checked against the client's own directory.
 *
 * Served as an attachment-free inline JPEG with nosniff: a stored file is
 * only ever something sharp re-encoded, but declaring the type and refusing
 * sniffing costs nothing and closes the door on it being interpreted as
 * anything else.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { readChatPhoto } from "@/lib/fmdb/chat-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  if (token.length < 16) return new NextResponse(null, { status: 401 });
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) return new NextResponse(null, { status: 401 });

  const buf = await readChatPhoto(lookup.client_id, file);
  if (!buf) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      // Private: it is a photo of a client, and it must not sit in a shared
      // cache. Immutable because the filename is a UUID that never changes.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

/**
 * GET /api/app-course/stream/<ticket> — serve one course track from local
 * disk (COURSE_AUDIO_DIR), for the "local" storage mode (course-audio.ts).
 *
 * The ticket is the credential: HMAC-signed, names exactly one file, expires
 * in hours, carries no app token. Range requests are honoured (Safari / iOS
 * will not play media without them, and seeking needs them everywhere).
 */
import { NextRequest } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { readTicket, localAudioPath, parseRange, courseAudioMode } from "@/lib/fmdb/course-audio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticket: string }> }) {
  if (courseAudioMode() !== "local") return new Response("Not found", { status: 404 });
  const { ticket } = await params;
  const grant = readTicket(decodeURIComponent(ticket));
  if (!grant) return new Response("Link expired", { status: 403 });
  const file = localAudioPath(grant.key);
  if (!file) return new Response("Not found", { status: 404 });
  let size: number;
  try {
    size = (await fs.promises.stat(file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "audio/mp4",
    "Accept-Ranges": "bytes",
    // Private: the phone may keep it for the life of the link, no shared cache.
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  if (req.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers: { ...headers, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

export const HEAD = GET;

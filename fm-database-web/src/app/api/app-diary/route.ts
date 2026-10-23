/**
 * /api/app-diary — the client's side of the food diary (docs/FOOD_DIARY_PLAN.md).
 *
 * POST (multipart — the photo rides along on "add"):
 *   action=add     photo, date, time, band, note?   → a new photo entry
 *   action=edit    entry_id, note? / band? / time? / date?
 *   action=delete  entry_id
 *   action=done    date                            → "done for today"
 * GET  ?token=…&file=…                             → one of the client's own
 *                                                    diary photos
 *
 * Auth is the app token, resolved server-side; the client id never comes
 * from the request. Every write is refused unless the coach's diary on
 * client.yaml is active and the date is one of its days — the card is only a
 * view of that switch, it cannot open a diary itself.
 *
 * Nothing here notifies anyone. Not the coach (she reads the diary when it is
 * done — a push per meal photo would be exactly the noise the diary exists to
 * avoid) and not the client. There is no per-photo reply either: unlike the
 * chat, the diary gives no verdicts.
 *
 * Must be listed in PUBLIC_PATH_PREFIXES or it 404s on Fly.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { saveChatPhoto, readChatPhoto, MAX_UPLOAD_BYTES } from "@/lib/fmdb/chat-media";
import {
  DIARY_NOTE_MAX,
  acceptClientDiaryDate,
  foldDiary,
  isDiaryBand,
  isHhmm,
  type DiaryLine,
} from "@/lib/fmdb/food-diary";
import { appendDiaryLine, readDiaryConfig, readDiaryLines } from "@/lib/fmdb/food-diary-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Photos a day. A thorough diary is ~8; 40 leaves room for retakes. */
const DAILY_PHOTO_LIMIT = 40;
/** Edits/deletes/done a day — generous, only there to bound a runaway loop. */
const DAILY_EDIT_LIMIT = 200;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Couldn't read that.", 400);
  }
  const token = String(form.get("token") ?? "");
  if (token.length < 16) return fail("invalid token", 401);
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) return fail("invalid or expired link", 401);
  const clientId = lookup.client_id;

  const cfg = readDiaryConfig(clientId);
  if (!cfg || cfg.status !== "active") return fail("Your food diary isn't open right now.", 409);

  const nowUtc = new Date().toISOString().slice(0, 10);
  const action = String(form.get("action") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, DIARY_NOTE_MAX);
  const ts = new Date().toISOString();

  if (action === "add") {
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const band = String(form.get("band") ?? "");
    if (!acceptClientDiaryDate(cfg, date, nowUtc)) return fail("That day isn't part of your diary.", 400);
    if (!isHhmm(time) || !isDiaryBand(band)) return fail("Pick a time for that one.", 400);
    if (!(await allowDaily("app-diary-photo", token, DAILY_PHOTO_LIMIT)).ok) {
      return fail("That's a lot of photos today — try again tomorrow.", 429);
    }
    const photo = form.get("photo");
    if (!(photo instanceof Blob) || photo.size === 0) return fail("No photo attached.", 400);
    if (photo.size > MAX_UPLOAD_BYTES) return fail("That photo is too large.", 413);

    // Photo first, line second: an entry pointing at a file never written
    // would show the client a broken picture of something they know they sent.
    const saved = await saveChatPhoto(clientId, Buffer.from(await photo.arrayBuffer()), "diary");
    if (!saved) return fail("That file didn't look like a photo.", 400);

    const line: DiaryLine = {
      op: "add",
      diary_id: cfg.id,
      ts,
      entry_id: randomUUID(),
      date,
      time,
      band,
      photo: saved.file,
      note,
    };
    if (!appendDiaryLine(clientId, line)) return fail("Couldn't save that.", 500);
    return NextResponse.json({
      ok: true,
      entry: { entry_id: line.entry_id, date, time, band, note, file: saved.file },
    });
  }

  if (!(await allowDaily("app-diary-edit", token, DAILY_EDIT_LIMIT)).ok) return fail("Try again tomorrow.", 429);

  if (action === "done") {
    const date = String(form.get("date") ?? "");
    if (!acceptClientDiaryDate(cfg, date, nowUtc)) return fail("That day isn't part of your diary.", 400);
    appendDiaryLine(clientId, { op: "day_done", diary_id: cfg.id, ts, date });
    return NextResponse.json({ ok: true });
  }

  if (action === "edit" || action === "delete") {
    const entryId = String(form.get("entry_id") ?? "");
    const live = foldDiary(readDiaryLines(clientId), cfg.id).entries.find((e) => e.entry_id === entryId);
    if (!live) return fail("That photo isn't in your diary.", 404);
    if (action === "delete") {
      appendDiaryLine(clientId, { op: "delete", diary_id: cfg.id, ts, entry_id: entryId });
      return NextResponse.json({ ok: true });
    }
    const line: DiaryLine = { op: "edit", diary_id: cfg.id, ts, entry_id: entryId };
    if (form.has("note")) line.note = note;
    const band = form.get("band");
    if (band !== null) {
      if (!isDiaryBand(band)) return fail("Unknown part of the day.", 400);
      line.band = band;
    }
    const time = form.get("time");
    if (time !== null) {
      if (!isHhmm(time)) return fail("Pick a time for that one.", 400);
      line.time = time;
    }
    const date = form.get("date");
    if (date !== null) {
      if (!acceptClientDiaryDate(cfg, String(date), nowUtc)) return fail("That day isn't part of your diary.", 400);
      line.date = String(date);
    }
    appendDiaryLine(clientId, line);
    return NextResponse.json({ ok: true });
  }

  return fail("unknown action", 400);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  if (token.length < 16) return new NextResponse(null, { status: 401 });
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) return new NextResponse(null, { status: 401 });
  const buf = await readChatPhoto(lookup.client_id, file, "diary");
  if (!buf) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

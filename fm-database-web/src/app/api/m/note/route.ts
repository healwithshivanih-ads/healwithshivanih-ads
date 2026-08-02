/**
 * POST /api/m/note — capture a quick note from the coach mobile app.
 *
 * Behind the session gate (any /api/m/* path that isn't login/logout requires
 * a valid cookie — see MOBILE_AUTH_PATHS).
 *
 * WHY AN OUTBOX AND NOT A DIRECT WRITE: on Fly the authoritative ~/fm-plans
 * tree does not exist — that is the whole point of the projection. So the note
 * is dropped into <FMDB_COACH_DIR>/_outbox/ and the Mac drains it into a real
 * session YAML on its next refresh (coach-staging-action.py::_drain_outbox).
 *
 * That means a note written while the Mac is asleep is QUEUED, not lost, and
 * appears in the client's session history once the Mac wakes. The outbox file
 * is only deleted after the session YAML exists on disk.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { coachDir } from "@/lib/fmdb/coach-mobile";
import { loadAuth } from "@/lib/fmdb/coach-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MAX_LEN = 8000;

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  const dir = coachDir();
  if (!dir) {
    return NextResponse.json(
      { ok: false, error: "FMDB_COACH_DIR unset on this host" },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();

  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad client_id" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty note" }, { status: 400 });
  }

  const box = path.join(dir, "_outbox");
  fs.mkdirSync(box, { recursive: true });
  const file = path.join(box, `${randomUUID()}.json`);
  // Write-then-rename: a half-written note must never be drained.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      client_id: clientId,
      text: text.slice(0, MAX_LEN),
      created_at: new Date().toISOString(),
    }),
  );
  fs.renameSync(tmp, file);

  const back = form.get("next");
  if (typeof back === "string" && back.startsWith("/m/") && !back.startsWith("//")) {
    return NextResponse.redirect(new URL(`${back}?noted=1`, req.url), 303);
  }
  return NextResponse.json({ ok: true, queued: true });
}

/**
 * POST /api/app-checkin — weekly check-in write-back from the client app.
 *
 * Auth: body.token must resolve to a published plan's letter_token (the
 * same token that opened the app). The client is derived server-side
 * from the token — never trusted from the request.
 *
 * SAFETY SCREEN. The form invites "new symptoms", so the typed note passes the
 * same list the ask box and the Coach tab use (ask-safety.ts::coachTabNote).
 * It never stops the save: the check-in is written, and then
 *   - the coach gets a push, the way a Coach-tab message does — sent before
 *     the save, so it goes even when the save fails;
 *   - the session says what the screen caught, at the top, for the coach;
 *   - the response carries the note, so the phone shows the same urgent card
 *     or "see a doctor today" line beside the thank-you.
 * Run here as well as on the phone because a direct POST skips the phone.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { checkinSafetyFlag, coachTabNote } from "@/lib/fmdb/ask-safety";
import { notifyCoachOfClientMessage } from "@/lib/fmdb/chat-notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  if (!(await allowDaily("app-checkin", token, 8)).ok) {
    return NextResponse.json({ ok: false, error: "too many check-ins today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const feel = typeof body.feel === "string" ? body.feel.slice(0, 2000) : "";
  const concerns = typeof body.concerns === "string" ? body.concerns.slice(0, 2000) : "";
  const typed = [feel, concerns].map((x) => x.trim()).filter(Boolean).join("\n");
  const note = typed ? coachTabNote(typed) : null;
  const safetyFlag = checkinSafetyFlag(note);
  if (safetyFlag) {
    // Best-effort, like the Coach tab: a failed push must not fail the
    // check-in. The push is tagged per client, so a retry replaces it.
    void notifyCoachOfClientMessage(lookup.client_id, {
      preview: `${note && "urgent" in note ? "⚠ " : ""}Check-in: ${typed}`,
    }).catch((e) => console.error("[app-checkin] coach notify failed:", e));
  }

  try {
    const out = (await runShim("save-app-checkin.py", {
      client_id: lookup.client_id,
      week: Number(body.week) || 0,
      rating: Number(body.rating) || 0,
      feel,
      concerns,
      supplements: Array.isArray(body.supplements) ? body.supplements.slice(0, 30) : [],
      practices: Array.isArray(body.practices) ? body.practices.slice(0, 30) : [],
      ...(safetyFlag ? { safety_flag: safetyFlag } : {}),
    })) as { ok?: boolean; session_id?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, session_id: out.session_id, note });
  } catch (err) {
    console.error("[app-checkin] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}

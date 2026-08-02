/**
 * POST /api/m/password — change the /m password from inside the app.
 *
 * A CHANGE flow, not a reset flow: it requires the current password. There is
 * deliberately no "forgot password" link. A reset needs a recovery channel
 * (email/SMS), and that channel becomes a second — usually weaker — door into
 * every client record; email compromise would be enough. Locked out is
 * recovered on the host instead:
 *
 *     flyctl secrets set COACH_MOBILE_PASSWORD="…" -a theochretree-coach
 *     # then delete <plans_root>/_coach_mobile_auth.json so it re-bootstraps
 *
 * NOT in MOBILE_AUTH_PATHS — this route sits BEHIND the session gate, so only
 * an already-signed-in device can reach it. That is what stops a stranger who
 * finds /m from cycling the password.
 *
 * On success the signing secret rotates (every other device is logged out) and
 * this device is re-issued a fresh cookie so the coach isn't kicked out of the
 * session she just used.
 */
import { NextRequest, NextResponse } from "next/server";
import { relativeRedirect } from "@/lib/fmdb/http-redirect";
import {
  COACH_MOBILE_COOKIE,
  COACH_MOBILE_TTL_MS,
  createSessionToken,
} from "@/lib/fmdb/coach-session";
import { changePassword, loadAuth } from "@/lib/fmdb/coach-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MESSAGES: Record<string, string> = {
  wrong_password: "current",
  too_short: "short",
  unchanged: "same",
  write_failed: "write",
  not_configured: "config",
  mismatch: "mismatch",
};

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  const form = await req.formData();
  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("new_password") ?? "");
  const confirm = String(form.get("confirm_password") ?? "");

  if (next !== confirm) {
    return relativeRedirect(`/m/settings?error=${MESSAGES.mismatch}`, 303);
  }

  const result = changePassword(current, next);
  if (!result.ok) {
    const code = MESSAGES[result.error] ?? "unknown";
    return relativeRedirect(`/m/settings?error=${code}`, 303);
  }

  const res = relativeRedirect("/m/settings?changed=1", 303);
  // Re-issue against the ROTATED secret — the cookie this request arrived with
  // is now invalid, and without this the coach would be logged out by her own
  // password change.
  res.cookies.set({
    name: COACH_MOBILE_COOKIE,
    value: createSessionToken(result.signingSecret),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(COACH_MOBILE_TTL_MS / 1000),
  });
  return res;
}

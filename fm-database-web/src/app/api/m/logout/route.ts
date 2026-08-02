/**
 * POST /api/m/logout — sign out of the /m coach mobile app.
 *
 * Allowed through the gate without a session (see MOBILE_AUTH_PATHS): clearing
 * a cookie you don't have is harmless, and refusing would strand anyone whose
 * session expired mid-use on a page with a dead Log out button.
 *
 * POST-only on purpose — a GET logout can be triggered by any <img> tag.
 */
import { NextRequest, NextResponse } from "next/server";
import { COACH_MOBILE_COOKIE } from "@/lib/fmdb/coach-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/m/login", req.url), 303);
  res.cookies.set({
    name: COACH_MOBILE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

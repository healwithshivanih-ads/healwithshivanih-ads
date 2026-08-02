/**
 * POST /api/m/login — sign in to the /m coach mobile app.
 *
 * This is the ONLY door into /m, and on Fly that means it is the only door
 * between the public internet and every client record. Three things matter:
 *
 *   1. CONSTANT-TIME password compare — a naive `===` leaks length/prefix
 *      information under timing analysis.
 *   2. RATE LIMITING — a single high-entropy password with no throttle is
 *      brute-forceable. In-memory is fine here: Fly runs ONE machine for this
 *      app (auto_stop_machines = "off", min_machines_running = 1), so there is
 *      no second process with its own counter. A restart clears it, which
 *      costs an attacker a deploy they cannot trigger.
 *   3. FAILS CLOSED — with COACH_MOBILE_PASSWORD unset this route 404s, and
 *      the proxy would never have routed here anyway.
 *
 * Accepts a normal form POST (the login page is a plain <form>, so it works
 * with no JavaScript and lets iOS offer to save the password to Keychain).
 */
import { NextRequest, NextResponse } from "next/server";
import { relativeRedirect } from "@/lib/fmdb/http-redirect";
import {
  COACH_MOBILE_COOKIE,
  COACH_MOBILE_TTL_MS,
  createSessionToken,
} from "@/lib/fmdb/coach-session";
import { loadAuth, verifyPassword } from "@/lib/fmdb/coach-auth";
import { safeMobileNext } from "@/lib/fmdb/middleware-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

// key → { count, resetAt }. Bounded by _sweep() so a spray of forged
// X-Forwarded-For values can't grow this map without limit.
const attempts = new Map<string, { count: number; resetAt: number }>();

function _sweep(now: number) {
  if (attempts.size < 1000) return;
  for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
}

function rateLimited(key: string, now: number): boolean {
  _sweep(now);
  const hit = attempts.get(key);
  if (!hit || hit.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_ATTEMPTS;
}

// Destination clamping lives in middleware-policy.ts (safeMobileNext) so the
// proxy, this route and the login page all share ONE implementation — and so
// the traversal cases are covered by the boundary test suite.

export async function POST(req: NextRequest) {
  // Surface absent-config as "not here", matching how the proxy treats /m.
  const auth = loadAuth();
  if (!auth) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const now = Date.now();
  const ip =
    req.headers.get("fly-client-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (rateLimited(ip, now)) {
    return relativeRedirect("/m/login?error=throttled", 303);
  }

  const form = await req.formData();
  const supplied = String(form.get("password") ?? "");
  const next = safeMobileNext(String(form.get("next") ?? "") || null);

  if (!verifyPassword(supplied)) {
    return relativeRedirect("/m/login?error=1", 303);
  }

  // 303 so the browser re-issues as GET — a plain 302 after a form POST can
  // re-POST on refresh.
  const res = relativeRedirect(next, 303);
  res.cookies.set({
    name: COACH_MOBILE_COOKIE,
    value: createSessionToken(auth.signingSecret, now),
    httpOnly: true,
    // Not Secure in local dev, or the cookie is dropped over plain http.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(COACH_MOBILE_TTL_MS / 1000),
  });
  return res;
}

/**
 * Coach-UI auth gate (Fly.io deploy, intake-only mode).
 *
 * Next 16 renamed the `middleware` file convention to `proxy` (same job,
 * clearer name; runs on the Node.js runtime — the Edge runtime is not
 * supported in `proxy`).
 *
 * This file is a THIN ADAPTER. The actual public/coach boundary lives in
 * a pure, Next-free module — src/lib/fmdb/middleware-policy.ts — so it can
 * be unit-tested without a Next runtime. See that file for the full
 * mode/allowlist documentation and the boundary tests
 * (middleware-policy.test.ts) that guard it.
 *
 * FOUR OPERATING MODES (decided in decideGate):
 *   1. INTAKE-ONLY (Fly): FLY_INTAKE_ONLY=1 → every coach route 404s.
 *   2. COACH AUTH:        COACH_AUTH_PASSWORD set → HTTP Basic Auth wall.
 *   3. LOCAL DEV:         neither set → no-op.
 *   4. COACH MOBILE:      COACH_MOBILE_PASSWORD set → /m sits behind a signed
 *                         session cookie instead of Basic auth (Basic re-prompts
 *                         badly inside an installed iOS PWA). Unset → /m is just
 *                         another coach route, so it 404s on Fly. Fails closed.
 *
 * The policy decodes Basic-auth via Web-standard atob() (a Node.js global
 * since 16) — no Buffer needed, so the policy module stays runtime-agnostic.
 * Cookie verification needs node:crypto, so it lives in coach-session.ts and
 * is done HERE (proxy runs on the Node.js runtime), not in the policy module.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  decideGate,
  isMobilePath,
  safeMobileNext,
} from "@/lib/fmdb/middleware-policy";
import { loadAuth } from "@/lib/fmdb/coach-auth";
import {
  COACH_MOBILE_COOKIE,
  verifySessionToken,
} from "@/lib/fmdb/coach-session";

function unauthorised(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="FM Coach", charset="UTF-8"',
    },
  });
}

function notFound(): NextResponse {
  return new NextResponse("Not Found", { status: 404 });
}

/**
 * Send an unauthenticated /m request to the login page, remembering where it
 * was headed.
 *
 * The `next` param is an OPEN-REDIRECT surface, so the destination goes
 * through the same safeMobileNext() clamp the login POST uses — one shared
 * implementation, normalise-then-validate. Bare "/m" is not worth echoing
 * (it's the default), which also keeps the login URL clean.
 */
function loginRedirect(req: NextRequest): NextResponse {
  const url = new URL("/m/login", req.url);
  const dest = safeMobileNext(req.nextUrl.pathname + req.nextUrl.search);
  if (dest !== "/m") url.searchParams.set("next", dest);
  return NextResponse.redirect(url);
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // The auth store is only consulted for /m requests. loadAuth() touches the
  // filesystem (and bootstraps the record on first use); doing that on every
  // asset request would be pure waste. For any other path the two mobile
  // inputs are false, which decideGate ignores anyway — its mobile branch is
  // guarded by isMobilePath first.
  const auth = isMobilePath(pathname) ? loadAuth() : null;

  // Verified here, not in the policy module: HMAC needs node:crypto and the
  // policy is deliberately runtime-agnostic. Absent cookie → false → "login".
  const mobileSessionValid = auth
    ? verifySessionToken(
        req.cookies.get(COACH_MOBILE_COOKIE)?.value,
        auth.signingSecret,
      )
    : false;

  const decision = decideGate(
    pathname,
    {
      flyIntakeOnly: process.env.FLY_INTAKE_ONLY,
      coachAuthPassword: process.env.COACH_AUTH_PASSWORD,
      coachAuthUsername: process.env.COACH_AUTH_USERNAME,
      coachMobileEnabled: auth !== null,
    },
    req.headers.get("authorization"),
    mobileSessionValid,
  );

  switch (decision) {
    case "notfound":
      return notFound();
    case "unauthorised":
      return unauthorised();
    case "login":
      return loginRedirect(req);
    default:
      return NextResponse.next();
  }
}

export const config = {
  // Match everything EXCEPT static asset prefixes that Next.js serves
  // directly. Avoids running the proxy on every image / font request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};

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
 * THREE OPERATING MODES (decided in decideGate):
 *   1. INTAKE-ONLY (Fly): FLY_INTAKE_ONLY=1 → every coach route 404s.
 *   2. COACH AUTH:        COACH_AUTH_PASSWORD set → HTTP Basic Auth wall.
 *   3. LOCAL DEV:         neither set → no-op.
 *
 * The policy decodes Basic-auth via Web-standard atob() (a Node.js global
 * since 16) — no Buffer needed, so the policy module stays runtime-agnostic.
 */

import { NextRequest, NextResponse } from "next/server";
import { decideGate } from "@/lib/fmdb/middleware-policy";

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

export function proxy(req: NextRequest) {
  const decision = decideGate(
    req.nextUrl.pathname,
    {
      flyIntakeOnly: process.env.FLY_INTAKE_ONLY,
      coachAuthPassword: process.env.COACH_AUTH_PASSWORD,
      coachAuthUsername: process.env.COACH_AUTH_USERNAME,
    },
    req.headers.get("authorization"),
  );

  switch (decision) {
    case "notfound":
      return notFound();
    case "unauthorised":
      return unauthorised();
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

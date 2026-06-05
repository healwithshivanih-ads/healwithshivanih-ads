/**
 * Coach-UI auth gate (v0.73, Fly.io deploy, intake-only mode).
 *
 * THREE OPERATING MODES — selected by env vars:
 *
 *   1. INTAKE-ONLY (Fly production)
 *      Set `FLY_INTAKE_ONLY=1`. Only public routes are reachable; ALL
 *      coach UI routes return 404, regardless of auth or hostname. This
 *      is the cleanest deployment posture: the public Fly machine has
 *      ZERO surface for the coach UI. Even with the right password,
 *      `intake.theochretree.com/clients-v2` returns 404 — the route
 *      doesn't exist as far as Fly is concerned.
 *
 *   2. COACH UI WITH AUTH (any host that's reachable from the internet)
 *      Set `COACH_AUTH_PASSWORD=...`. Coach UI is behind HTTP Basic Auth.
 *      Public routes still skip auth. Reserved for future use if coach
 *      ever wants to expose her UI; not used by current Fly deploy.
 *
 *   3. LOCAL DEV (Mac mini / laptop, no envs set)
 *      Neither env var set. Everything reachable, no auth. Coach uses
 *      this every day via `npm run dev` or PM2 on localhost.
 *
 * PUBLIC PATHS (always reachable, in all modes):
 *     /intake/[token]         — client-facing intake form (token = auth)
 *     /start/[token]          — client-facing plan-start confirmation
 *     /api/whatsapp-webhook   — inbound WhatsApp (X-WhatsApp-Signature)
 *     /api/whatsapp-poll-webhook
 *     /api/health             — Fly health check
 *     /_next/static/*, /favicon.ico — Next.js statics (handled by matcher)
 *
 * EDGE RUNTIME
 *   Next middleware runs in the Edge runtime, so no Buffer / Node APIs.
 *   We use Web-standard `atob()` for base64 decode.
 */

import { NextRequest, NextResponse } from "next/server";

// Routes that must remain public regardless of mode.
const PUBLIC_PATH_PREFIXES = [
  "/intake/",
  "/start/",
  // Public letter page: clients open the consolidated plan letter via a
  // token-based URL (plan.letter_token). Generated at publish; cleared
  // on revoke. Behaviour mirrors /intake/.
  "/letter/",
  // Short-link redirects:
  //   /s/<code> → /intake/<intake_token>  (7-char base62 short code)
  //   /l/<code> → /letter/<letter_token>  (7-char base62 short code)
  // These must be public so the redirect works on Fly (FLY_INTAKE_ONLY mode)
  // without requiring auth.
  "/s/",
  "/l/",
  // Public supplement order page: lists supplements from the plan with
  // buy links. No auth needed — the URL contains the plan slug only,
  // which is non-guessable in practice (UUID-ish).
  "/supplements/",
  // Public recipe pack: full ingredients + method for every ✦ dish in
  // the meal plan. Split out of the consolidated letter (post-reformat)
  // so the letter stays under 7 pages.
  "/recipes/",
  // Public client handouts — short branded 1-page guides (iron, thyroid,
  // blood sugar, …) dripped to clients on a schedule. Static HTML served
  // from public/handouts/<slug>.html. Generic educational content, safe to
  // serve unauthenticated (no client data). Built by scripts/build-handouts.py.
  "/handouts/",
  // v0.73 WhatsApp cutover — inbound from the self-hosted Fly app
  // (whatsapp-server-shivani) lands here. HMAC-verified by route handler
  // using WHATSAPP_WEBHOOK_SECRET. /api/aisensy-webhook removed
  // (AiSensy no longer used; its plan never delivered webhooks anyway).
  "/api/whatsapp-webhook",
  "/api/whatsapp-poll-webhook",
  "/api/health",
  // Cron endpoints — hit by the fm-coach-cron PM2 sidecar. Auth is
  // enforced at the route level via x-cron-secret header (CRON_SECRET
  // env). Public middleware bypass needed because there's no Basic Auth
  // session in the cron process.
  "/api/cron/",
  // Handover endpoints — fired by ochre-followup via HMAC-signed POST.
  // Auth at route level via x-handover-signature + HANDOVER_SECRET env.
  // The /api/handover/test route uses x-cron-secret for the same reason
  // (coach-only smoke test, no Basic Auth session available).
  "/api/handover/",
  // Cal.com booking webhook — parallel subscriber alongside the
  // existing whatsapp-server-shivani receiver. HMAC-verified at route
  // level via CAL_COM_SIGNING_SECRET.
  "/api/cal-com-webhook",
  // Zoom Cloud Recording webhook — fires after Cloud Recordings finish
  // + transcript is ready. HMAC-verified at route level via
  // ZOOM_WEBHOOK_SECRET_TOKEN. See docs/ZOOM_INTEGRATION_SETUP.md.
  "/api/zoom-webhook",
];

function isPublicPath(path: string): boolean {
  if (path === "/favicon.ico" || path === "/robots.txt") return true;
  if (path.startsWith("/_next/")) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

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

function validateBasicAuth(
  authHeader: string | null,
  expectedUser: string,
  expectedPass: string,
): boolean {
  if (!authHeader) return false;
  const [scheme, encoded] = authHeader.split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return user === expectedUser && pass === expectedPass;
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Mode 1: INTAKE-ONLY (Fly production). Only public paths exist.
  // Anything else is a 404 — coach UI doesn't even appear to be there.
  if (process.env.FLY_INTAKE_ONLY === "1") {
    if (isPublicPath(path)) return NextResponse.next();
    return notFound();
  }

  // Public paths always skip auth.
  if (isPublicPath(path)) {
    return NextResponse.next();
  }

  // Mode 3: LOCAL DEV — no password set, no-op.
  const password = process.env.COACH_AUTH_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  // Mode 2: COACH UI WITH AUTH (not used by current Fly deploy; reserved
  // for if coach ever wants to expose her UI behind a password).
  const username = process.env.COACH_AUTH_USERNAME ?? "shivani";
  const authHeader = req.headers.get("authorization");
  if (validateBasicAuth(authHeader, username, password)) {
    return NextResponse.next();
  }
  return unauthorised();
}

export const config = {
  // Match everything EXCEPT static asset prefixes that Next.js serves
  // directly. Avoids running middleware on every image / font request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};

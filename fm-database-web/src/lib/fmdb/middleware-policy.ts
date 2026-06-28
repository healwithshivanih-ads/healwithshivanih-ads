/**
 * Pure auth-gate policy for the coach UI — NO Next.js imports.
 *
 * src/middleware.ts is a thin adapter that maps decideGate() onto
 * NextResponse. Keeping the decision logic here means:
 *   (a) the public/coach boundary is unit-testable in plain vitest,
 *       without the Edge runtime (next/server doesn't resolve there); and
 *   (b) the policy survives a future middleware→proxy migration unchanged
 *       — only the adapter that calls it would move.
 *
 * THREE OPERATING MODES — selected by env vars (see decideGate):
 *   1. INTAKE-ONLY (Fly): FLY_INTAKE_ONLY=1 → every non-public path 404s.
 *   2. COACH AUTH:        COACH_AUTH_PASSWORD set → Basic auth wall.
 *   3. LOCAL DEV:         neither set → no-op (everything reachable).
 *
 * Uses the Web-standard global atob() (available in both the Edge runtime
 * and Node), so no Buffer / Node-only APIs leak in.
 */

// Routes that must remain public regardless of mode. NOTE: "public" here
// means "bypasses the Basic-auth wall / exists on the Fly intake host" —
// each route still enforces its OWN auth (token or HMAC) at the handler.
export const PUBLIC_PATH_PREFIXES = [
  "/intake/", // client-facing intake form (intake_token = auth)
  "/start/", // client-facing plan-start confirmation
  "/guide/",
  // Public letter page: clients open the consolidated plan letter via a
  // token-based URL (plan.letter_token). Generated at publish; cleared
  // on revoke. Behaviour mirrors /intake/.
  "/letter/",
  // Short-link redirects:
  //   /s/<code> → /intake/<intake_token>  (7-char base62 short code)
  //   /l/<code> → /letter/<letter_token>  (7-char base62 short code)
  // Must be public so the redirect works on Fly (FLY_INTAKE_ONLY) without auth.
  "/s/",
  "/l/",
  // Supplement order page: lists supplements from the plan with buy links.
  // Public PREFIX (bypasses Basic auth), but the route handler enforces a
  // letter_token server-side (TOKEN-ONLY since 2026-06-11) — plan slugs are
  // guessable, so the old slug fallback was removed.
  "/supplements/",
  // Recipe pack: full ingredients + method for every ✦ dish in the meal
  // plan. Same TOKEN-ONLY gate as /supplements/ — the route resolves a
  // letter_token before reading any plan file.
  "/recipes/",
  // Client companion app ("The Ochre Tree" PWA): /app/<letter_token>.
  // Token = the same plan letter_token that gates /letter/. The /api/app-*
  // routes are the app's write-backs + co-pilot — all re-verify the token
  // server-side before doing anything.
  "/app/",
  "/api/app-checkin",
  "/api/app-msq",
  "/api/app-copilot",
  "/api/app-travel",
  "/api/app-body",
  "/api/app-swap",
  "/api/app-push",
  // App reports it's running installed (adoption signal). Token-scoped.
  "/api/app-installed",
  // GET serves the client's avatar; POST lets the client set their own.
  // Token-scoped, re-verified server-side. Matches /api/app-photo and
  // /api/app-photo/<token>.
  "/api/app-photo",
  // Lab-order payment (Razorpay). /pay bound-checks the amount server-side;
  // /webhook is HMAC-verified and is the only path that marks an order paid.
  // The COACH actions are server actions on the private page (and hard-refuse
  // under FLY_INTAKE_ONLY), so they are deliberately NOT here.
  "/api/lab-order/",
  // Maintenance renewal payment (Razorpay) — same posture as /api/lab-order/.
  // /[clientId]/pay charges a SERVER-FIXED amount; /webhook is HMAC-verified and
  // is the only path that marks a maintenance order paid.
  "/api/maintenance/",
  // Static PWA assets (manifest + home-screen icons). No data.
  "/ochre-app/",
  // Recipe photos for the client app's recipe cards. Generic food images.
  "/recipe-images/",
  // Public client handouts — static branded 1-page guides. No client data.
  "/handouts/",
  // Inbound WhatsApp (self-hosted Fly app). HMAC-verified at the route via
  // WHATSAPP_WEBHOOK_SECRET.
  "/api/whatsapp-webhook",
  "/api/whatsapp-poll-webhook",
  "/api/health", // Fly health check
  // Token-scoped public file upload for the intake form ("photo your medicine
  // strips"). Resolves the intake token → client_id server-side; refuses
  // invalid/expired tokens.
  "/api/intake",
  // Cron endpoints — hit by the fm-coach-cron sidecar. Auth via x-cron-secret
  // (CRON_SECRET) at the route; no Basic-auth session in the cron process.
  "/api/cron/",
  // Handover endpoints — HMAC-signed POST from ochre-followup
  // (x-handover-signature + HANDOVER_SECRET). /api/handover/test uses
  // x-cron-secret (coach-only smoke test).
  "/api/handover/",
  // Cal.com booking webhook — HMAC-verified via CAL_COM_SIGNING_SECRET.
  "/api/cal-com-webhook",
  // Zoom Cloud Recording webhook — HMAC-verified via ZOOM_WEBHOOK_SECRET_TOKEN.
  "/api/zoom-webhook",
];

export function isPublicPath(path: string): boolean {
  if (path === "/favicon.ico" || path === "/robots.txt") return true;
  if (path.startsWith("/_next/")) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/** Validate an HTTP Basic auth header against expected creds. Web-standard
 *  atob() (works in Edge + Node), so this is runtime-agnostic. */
export function validateBasicAuth(
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

export type GateEnv = {
  flyIntakeOnly?: string;
  coachAuthPassword?: string;
  coachAuthUsername?: string;
};

/** What the adapter should do with a request. */
export type GateDecision = "next" | "notfound" | "unauthorised";

/**
 * The whole boundary, as a pure function. Mirrors src/middleware.ts exactly:
 *   - FLY_INTAKE_ONLY: public → next, everything else → notfound (404)
 *   - public path: next (skips the auth wall)
 *   - no COACH_AUTH_PASSWORD: next (local dev no-op)
 *   - COACH_AUTH_PASSWORD set: valid Basic auth → next, else unauthorised (401)
 */
export function decideGate(
  path: string,
  env: GateEnv,
  authHeader: string | null,
): GateDecision {
  // Mode 1: INTAKE-ONLY (Fly production). Only public paths exist; any
  // coach route returns 404 — it doesn't appear to be there at all.
  if (env.flyIntakeOnly === "1") {
    return isPublicPath(path) ? "next" : "notfound";
  }

  // Public paths always skip auth.
  if (isPublicPath(path)) return "next";

  // Mode 3: LOCAL DEV — no password set, no-op.
  const password = env.coachAuthPassword;
  if (!password) return "next";

  // Mode 2: COACH UI WITH AUTH.
  const username = env.coachAuthUsername ?? "shivani";
  if (validateBasicAuth(authHeader, username, password)) return "next";
  return "unauthorised";
}

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
 * FOUR OPERATING MODES — selected by env vars (see decideGate):
 *   1. INTAKE-ONLY (Fly): FLY_INTAKE_ONLY=1 → every non-public path 404s.
 *   2. COACH AUTH:        COACH_AUTH_PASSWORD set → Basic auth wall.
 *   3. LOCAL DEV:         neither set → no-op (everything reachable).
 *   4. COACH MOBILE:      /m configured → /m only, signed session
 *                         cookie instead of Basic auth. Unset → /m is just
 *                         another coach route and 404s on Fly (fails closed).
 *
 * Uses the Web-standard globals atob() and URL (available in both the Edge
 * runtime and Node), so no Buffer / Node-only APIs leak in. Cookie signing
 * needs node:crypto and therefore lives in coach-session.ts, called by the
 * adapter — decideGate takes the verified result as a boolean.
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
  // Period-start write-back for the seed-cycling section (client taps "my
  // period started today"). Token-scoped, re-verified server-side. Must be
  // public or it 404s on Fly under FLY_INTAKE_ONLY and the seed-cycling reset
  // silently breaks for every client.
  "/api/app-period",
  // Mind-body practice log write-back (breathing / EFT / sleep wind-down).
  // Token-scoped, re-verified server-side. Feeds the adherence scanner + the
  // progressive-unlock drip engine. (Was missing → 404'd on Fly under
  // FLY_INTAKE_ONLY, silently breaking practice logging for every client.)
  "/api/app-practice",
  // Daily checklist ticks (supplements / remedies / practices). Token-scoped,
  // client derived server-side. This is the adherence dataset the coach's
  // daily-log panel reads — off the allowlist it 404s on Fly and every tick is
  // dropped, which is the same silent loss it exists to end.
  "/api/app-ticks",
  // Client reminder preferences (AM/PM supplements, weekly check-in). Token-
  // scoped. (Same missing-from-allowlist bug as app-practice.)
  "/api/app-reminders",
  // The client's side of the in-app chat. Token-scoped and re-verified
  // server-side, like every other app-* route. Off the allowlist it 404s on
  // Fly under FLY_INTAKE_ONLY and messages vanish with no error the client
  // can see — the same silent failure app-practice shipped with.
  "/api/app-chat",
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
  // Client-app receipts for lab / maintenance payments. Token-scoped
  // (verifyAppClient re-checks the letter token against the query clientId
  // server-side) — same posture as /api/lab-order/. Without this the receipt
  // fetch 404s on Fly under FLY_INTAKE_ONLY and the client-side res.json()
  // chokes on the plain-text "Not Found" body.
  "/api/invoice/",
  // Static PWA assets (manifest + home-screen icons). No data.
  "/ochre-app/",
  // Same, for the COACH app (/m). Manifest + icons only — iOS fetches the
  // manifest without credentials, so it must resolve before the session gate.
  // Contains no client data; the app itself stays behind the cookie gate.
  "/coach-app/",
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
  // Coach-app AI bridge: the Fly copy of /m asks the MAC to answer a client
  // question, because the answer needs the full record that deliberately does
  // not leave the Mac. Same posture as /api/cron/ — public prefix so it is
  // reachable, mandatory `x-coach-bridge` secret enforced at the route, and
  // 404 while COACH_BRIDGE_SECRET is unset.
  "/api/m-bridge/",
  // Cal.com booking webhook — HMAC-verified via CAL_COM_SIGNING_SECRET.
  "/api/cal-com-webhook",
  // Zoom Cloud Recording webhook — HMAC-verified via ZOOM_WEBHOOK_SECRET_TOKEN.
  "/api/zoom-webhook",
];

/**
 * The coach mobile app ("/m") — a phone-shaped surface over the coach's own
 * view of client records.
 *
 * DELIBERATELY NOT in PUBLIC_PATH_PREFIXES. "Public" in that list means "no
 * auth at all on the Fly host" — that is how /intake/<token> works, and it is
 * correct there because the token IS the credential. /m has no such token: it
 * lists every client. So it gets its OWN gate (a signed session cookie) and
 * FAILS CLOSED — with COACH_MOBILE_PASSWORD unset it behaves exactly like any
 * other coach route (404 on Fly). Enabling the surface is an explicit act.
 */
export const COACH_MOBILE_PREFIX = "/m";
export const COACH_MOBILE_API_PREFIX = "/api/m/";

/**
 * Exact-segment match, NOT a bare startsWith("/m").
 *
 * `"/mindmap".startsWith("/m")` is true — so a bare prefix test would pull
 * /mindmap and /messages (both real coach routes) into the mobile gate and
 * turn their Fly 404 into a login redirect. Anchor on the segment boundary.
 */
export function isMobilePath(path: string): boolean {
  if (path === COACH_MOBILE_PREFIX) return true;
  if (path.startsWith(COACH_MOBILE_PREFIX + "/")) return true;
  return path.startsWith(COACH_MOBILE_API_PREFIX);
}

/**
 * The only paths inside /m reachable WITHOUT a session — otherwise you could
 * never log in. Kept to an exact list (not a prefix) so it cannot widen by
 * accident. Logout is here too: clearing a cookie you don't have is harmless.
 */
const MOBILE_AUTH_PATHS = ["/m/login", "/api/m/login", "/api/m/logout"];

export function isMobileAuthPath(path: string): boolean {
  return MOBILE_AUTH_PATHS.includes(path);
}

/**
 * Clamp a post-login `?next=` destination to somewhere inside /m.
 *
 * NORMALISE FIRST, THEN VALIDATE. A plain `raw.startsWith("/m/")` test looks
 * right and is wrong: "/m/../clients-v2" passes it, and the browser (or
 * `new URL()`) then resolves the ".." away and navigates to /clients-v2. Same
 * bug shape as validating a file path before resolving it.
 *
 * Parsing against a sentinel origin collapses "..", and any absolute or
 * protocol-relative input ("https://evil.com", "//evil.com") changes the
 * hostname — so one check catches traversal and off-site redirects together.
 * Anything that isn't plainly inside /m falls back to /m.
 */
export function safeMobileNext(raw: string | null | undefined): string {
  if (!raw) return COACH_MOBILE_PREFIX;

  const SENTINEL = "internal.invalid";
  let url: URL;
  try {
    url = new URL(raw, `http://${SENTINEL}`);
  } catch {
    return COACH_MOBILE_PREFIX;
  }

  // Absolute or protocol-relative input escaped the sentinel origin.
  if (url.hostname !== SENTINEL) return COACH_MOBILE_PREFIX;

  const dest = url.pathname + url.search;
  if (url.pathname !== COACH_MOBILE_PREFIX && !url.pathname.startsWith(COACH_MOBILE_PREFIX + "/")) {
    return COACH_MOBILE_PREFIX;
  }
  // Never bounce back to the login page itself — that's a redirect loop.
  if (url.pathname === "/m/login") return COACH_MOBILE_PREFIX;
  return dest;
}

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
  /** True when /m is configured on this host (an auth record exists, or
   *  COACH_MOBILE_PASSWORD is set to bootstrap one). False → /m is just
   *  another coach route and 404s on Fly. The adapter computes this; the
   *  credential itself never reaches the policy module. */
  coachMobileEnabled?: boolean;
};

/** What the adapter should do with a request. */
export type GateDecision = "next" | "notfound" | "unauthorised" | "login";

/**
 * The whole boundary, as a pure function. Mirrors src/proxy.ts exactly:
 *   - public path: next (skips every wall, in every mode)
 *   - /m + COACH_MOBILE_PASSWORD set: valid session → next, else login
 *   - FLY_INTAKE_ONLY: everything else → notfound (404)
 *   - no COACH_AUTH_PASSWORD: next (local dev no-op)
 *   - COACH_AUTH_PASSWORD set: valid Basic auth → next, else unauthorised (401)
 *
 * `mobileSessionValid` is computed by the adapter, not here: verifying the
 * signed cookie needs node:crypto (see coach-session.ts) and this module is
 * deliberately runtime-agnostic. Defaults to false so a caller that forgets
 * to pass it fails CLOSED.
 */
export function decideGate(
  path: string,
  env: GateEnv,
  authHeader: string | null,
  mobileSessionValid: boolean = false,
): GateDecision {
  // Public paths always skip every wall. Checked first in ALL modes so the
  // token-gated client surface behaves identically on Fly and on the Mac.
  // (Behaviour-identical to the old Fly-first ordering: a public path
  // returned "next" under Fly too.)
  if (isPublicPath(path)) return "next";

  // Mode 4: COACH MOBILE (/m). Only exists when COACH_MOBILE_PASSWORD is set;
  // otherwise fall through and /m is treated as any other coach route — which
  // means 404 on Fly. That fall-through is the fail-closed property.
  if (isMobilePath(path) && env.coachMobileEnabled) {
    if (isMobileAuthPath(path)) return "next";
    return mobileSessionValid ? "next" : "login";
  }

  // Mode 1: INTAKE-ONLY (Fly production). Any coach route returns 404 — it
  // doesn't appear to be there at all.
  if (env.flyIntakeOnly === "1") return "notfound";

  // Mode 3: LOCAL DEV — no password set, no-op.
  const password = env.coachAuthPassword;
  if (!password) return "next";

  // Mode 2: COACH UI WITH AUTH.
  const username = env.coachAuthUsername ?? "shivani";
  if (validateBasicAuth(authHeader, username, password)) return "next";
  return "unauthorised";
}

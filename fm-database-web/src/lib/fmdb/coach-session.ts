/**
 * Signed session token for the /m coach mobile app.
 *
 * WHY A COOKIE AND NOT BASIC AUTH: the rest of the coach UI uses HTTP Basic
 * (see middleware-policy.ts Mode 2). Basic auth inside an installed iOS PWA
 * re-prompts on cold start and renders a system dialog that looks like a
 * failure — unusable for a home-screen app. So /m gets a cookie session.
 *
 * WHY node:crypto LIVES HERE: middleware-policy.ts is deliberately free of
 * Node-only APIs so the boundary stays unit-testable without a runtime. Next
 * 16's `proxy` runs on the Node.js runtime (the Edge runtime is not supported
 * there), so createHmac is safe in the adapter — but it must not leak into the
 * pure policy module. Hence the split.
 *
 * TOKEN SHAPE: `<expiry-ms>.<hex hmac-sha256 of expiry, keyed by password>`
 *   - Expiry is INSIDE the signature, so a client cannot extend its own
 *     session by editing the cookie; the check is server-side, not Max-Age.
 *   - The key is the SIGNING SECRET from coach-auth.ts, never the password
 *     (which is only ever stored as a scrypt hash). Rotating that secret on a
 *     password change invalidates every live session with no session store.
 *
 * This is a single-user surface, so there is no per-session identity — the
 * token proves "someone knew the password before <expiry>", which is exactly
 * the claim we need.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Cookie name. httpOnly + Secure + SameSite=Lax are set by the login route. */
export const COACH_MOBILE_COOKIE = "fmcoach_m";

/** 30 days — long enough that a home-screen app doesn't nag, short enough
 *  that a stolen phone doesn't stay authorised indefinitely. */
export const COACH_MOBILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(payload: string, password: string): string {
  return createHmac("sha256", password).update(payload).digest("hex");
}

/** Mint a token valid until `now + ttlMs`, keyed by the auth store's signing
 *  secret. `now` is injectable for tests. */
export function createSessionToken(
  key: string,
  now: number = Date.now(),
  ttlMs: number = COACH_MOBILE_TTL_MS,
): string {
  const expiry = String(now + ttlMs);
  return `${expiry}.${sign(expiry, key)}`;
}

/**
 * True only for a well-formed, unexpired token whose signature matches.
 * Every failure path returns false — malformed input is never an exception.
 */
export function verifySessionToken(
  token: string | null | undefined,
  key: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token || !key) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expiryPart = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  // Reject anything not a plain positive integer BEFORE parsing, so inputs
  // like "1e99" or " 123" can't sneak through Number()'s leniency.
  if (!/^\d+$/.test(expiryPart)) return false;
  const expiry = Number(expiryPart);
  if (!Number.isSafeInteger(expiry) || expiry <= now) return false;

  const expected = sign(expiryPart, key);
  if (signature.length !== expected.length) return false;

  try {
    // Constant-time — the token is a bearer credential.
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    // Non-hex signature of the right length lands here.
    return false;
  }
}

/**
 * Authorization helper for PUBLIC client-app write routes that mutate a
 * specific client's data (payments, lab bookings, maintenance renewals).
 *
 * Why this exists:
 *   The public payment routes (/api/maintenance/[clientId]/*, /api/lab-order/
 *   [orderId]/pay) used to trust the clientId/orderId straight from the
 *   request — no proof the caller was that client. clientIds are guessable
 *   (cl-005, nidhi-jain), so an unauthenticated caller could create Razorpay
 *   orders, spam order records, or overwrite a client's lab home-collection
 *   logistics. The /api/app-* write-back routes already do the right thing:
 *   they resolve the app token server-side and derive the client from it.
 *   This helper makes that same gate one line for every money/booking route.
 *
 * The token — never a request-supplied id — is the authority.
 */
import { resolveAppToken } from "@/lib/server-actions/letter-token";

export type AppClientAuth =
  | { ok: true; clientId: string; planSlug: string }
  | { ok: false; status: number; error: string };

/**
 * Resolve a client-app bearer token and (optionally) confirm it belongs to
 * `expectedClientId`. Returns the server-derived client_id on success — callers
 * should use THAT, not any id from the request body.
 *
 * - Missing / too-short token → 401.
 * - Token doesn't resolve to a client → 401 ("invalid or expired link").
 * - Token resolves but to a DIFFERENT client than expected → 403.
 */
export async function verifyAppClient(
  token: unknown,
  expectedClientId?: string,
): Promise<AppClientAuth> {
  const t = typeof token === "string" ? token : "";
  if (t.length < 16) return { ok: false, status: 401, error: "unauthorized" };
  const auth = await resolveAppToken(t);
  if (!auth.ok) return { ok: false, status: 401, error: "invalid or expired link" };
  if (expectedClientId != null && auth.client_id !== expectedClientId) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, clientId: auth.client_id, planSlug: auth.plan_slug };
}

/**
 * Shared HMAC verification for /api/handover/* routes.
 *
 * ochre-followup posts JSON with x-handover-signature: sha256=<hex>
 * The signature is HMAC-SHA256 over the raw request body, keyed by
 * HANDOVER_SECRET (shared env var, set on both apps via setup).
 *
 * Defence in depth: also checks the source field matches a whitelist —
 * stops a misconfigured app from impersonating ochre.
 */
import crypto from "node:crypto";

const ALLOWED_SOURCES = new Set(["ochre-followup", "fm-coach-manual"]);

export interface AuthResult {
  ok: boolean;
  body?: unknown;
  rawBody?: string;
  error?: string;
}

export async function verifyHandoverRequest(req: Request): Promise<AuthResult> {
  const secret = process.env.HANDOVER_SECRET;
  if (!secret) {
    return { ok: false, error: "HANDOVER_SECRET not configured on server" };
  }

  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const sigHeader = req.headers.get("x-handover-signature") || "";
  const sigMatch = /^sha256=([0-9a-f]+)$/i.exec(sigHeader);
  if (!sigMatch) {
    return { ok: false, error: "missing_or_malformed_signature" };
  }
  const provided = sigMatch[1].toLowerCase();
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  // Constant-time comparison
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "signature_mismatch" };
  }

  const source = body.source;
  if (typeof source !== "string" || !ALLOWED_SOURCES.has(source)) {
    return { ok: false, error: `source_not_allowed: ${String(source)}` };
  }

  return { ok: true, body, rawBody };
}

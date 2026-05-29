// Wix self-hosted Webhooks API — JWT verify + double-decode.
//
// Wix delivers webhook payloads as a single RS256-signed JWT in the
// request body (content-type: text/plain). The structure is *layered*:
//
//   raw text body  =  "<JWT string>"
//      ↓ jwt.verify(raw, publicKey, { algorithms: ['RS256'] })
//   { data: "<JSON string>", iat, iss, ... }
//      ↓ JSON.parse(data)
//   { instanceId, eventType, data: "<JSON string>", entityFqdn, slug, ... }
//      ↓ JSON.parse(data)                              ← inner JSON-stringified again
//   { actionEvent: {...}, entityId, eventTime, ... }   ← the real Wix event envelope
//
// The "real event envelope" contains the booking object under one of a
// few shapes (Wix's bookings v2 emits `actionEvent.body.booking` or
// similar, plus an `entityFqdn` like "wix.bookings.v2.booking"). The
// existing `extractBooking` in routes/webhooks/wix-bookings.js already
// handles these shape variations defensively — we just need to feed it
// the fully-decoded envelope.
//
// Public key is the static per-site RSA key from
// Wix dashboard → Webhooks → "Get Public Key". Stored as Fly secret
// WIX_WEBHOOK_PUBLIC_KEY (PEM, including the BEGIN/END lines).

import jwt from 'jsonwebtoken';
import process from 'node:process';

export class WixJwtVerifyError extends Error {
  constructor(msg, { code, cause } = {}) {
    super(msg);
    this.name = 'WixJwtVerifyError';
    this.code = code || 'verify_failed';
    if (cause) this.cause = cause;
  }
}

/**
 * Verify the JWT signature and return the decoded outer payload.
 * Throws WixJwtVerifyError on signature failure or missing public key.
 */
export function verifyWixJwt(rawJwt) {
  const pubKey = process.env.WIX_WEBHOOK_PUBLIC_KEY;
  if (!pubKey) {
    throw new WixJwtVerifyError('WIX_WEBHOOK_PUBLIC_KEY not set', { code: 'no_public_key' });
  }
  try {
    return jwt.verify(rawJwt, pubKey, { algorithms: ['RS256'] });
  } catch (e) {
    throw new WixJwtVerifyError(`JWT verify failed: ${e.message}`, {
      code: e.name === 'TokenExpiredError' ? 'expired' : 'bad_signature',
      cause: e,
    });
  }
}

/**
 * Full pipeline: verify signature, then unwrap the two JSON-string layers
 * Wix wraps around the actual event envelope. Returns:
 *
 *   {
 *     envelope: <inner real event object>,
 *     eventType, entityFqdn, instanceId, slug,
 *     verifiedAt, outerIat
 *   }
 *
 * Throws WixJwtVerifyError on any decode failure.
 */
export function decodeWixWebhook(rawJwt) {
  const outer = verifyWixJwt(rawJwt);
  // Layer 1: outer.data is a JSON string
  let middle;
  try {
    middle = typeof outer.data === 'string' ? JSON.parse(outer.data) : outer.data;
  } catch (e) {
    throw new WixJwtVerifyError(`failed to parse outer.data: ${e.message}`, {
      code: 'bad_outer_json',
      cause: e,
    });
  }
  if (!middle || typeof middle !== 'object') {
    throw new WixJwtVerifyError('outer.data did not decode to an object', { code: 'bad_outer_json' });
  }

  // Layer 2: middle.data is also a JSON string (the real envelope)
  let envelope;
  try {
    envelope = typeof middle.data === 'string' ? JSON.parse(middle.data) : (middle.data || middle);
  } catch (e) {
    throw new WixJwtVerifyError(`failed to parse middle.data: ${e.message}`, {
      code: 'bad_inner_json',
      cause: e,
    });
  }

  return {
    envelope: envelope || {},
    eventType: middle.eventType || middle.slug || null,
    entityFqdn: middle.entityFqdn || null,
    instanceId: middle.instanceId || null,
    slug: middle.slug || null,
    outerIat: outer.iat || null,
    verifiedAt: new Date().toISOString(),
  };
}

import crypto from 'node:crypto';
import { config } from '../config.js';

// Meta sends X-Hub-Signature-256: sha256=<hex>. We compute HMAC over the raw body
// using META_APP_SECRET and compare in constant time.
export function verifyMetaSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !config.whatsapp.appSecret) return false;
  const expected = 'sha256=' +
    crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function verifyCalendlySignature(rawBody, signatureHeader, secret) {
  // Calendly sends t=...,v1=... — optional, only if CALENDLY_SIGNING_SECRET set
  if (!secret) return true; // not configured, skip verification
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    }),
  );
  if (!parts.t || !parts.v1) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

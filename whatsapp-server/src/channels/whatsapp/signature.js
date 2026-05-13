// Meta sends X-Hub-Signature-256: sha256=<hex>. We compute HMAC over the raw
// body using META_APP_SECRET and compare in constant time.
import crypto from 'node:crypto';

/**
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader  full header value, e.g. "sha256=abc..."
 * @param {string} secret           META_APP_SECRET
 * @returns {boolean}
 */
export function verify(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(buf).digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Captures the raw request body bytes for HMAC signature verification.
// MUST be applied before express.json() on routes that need it (i.e. /webhook).
import express from 'express';

export const rawJson = express.raw({
  type: 'application/json',
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
});

/** Parses the captured raw body to JSON for downstream handlers. */
export function parseRawJson(req, _res, next) {
  if (req.rawBody && req.rawBody.length) {
    try {
      req.body = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      req.body = {};
    }
  }
  next();
}

// Express middleware to capture raw body bytes for HMAC signature verification.
// Must be applied BEFORE express.json() on routes that need it.
import express from 'express';

export const rawJson = express.raw({
  type: 'application/json',
  limit: '2mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

// Parse the captured raw body to JSON for downstream handlers
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

import rateLimit from 'express-rate-limit';

export const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120, // Meta retries can spike; keep generous
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

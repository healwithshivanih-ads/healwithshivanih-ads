import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    ts: new Date().toISOString(),
    version: 'v21.0',
  });
});

// Public, unauthenticated lightweight ping for monitoring
healthRouter.get('/api/healthz', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

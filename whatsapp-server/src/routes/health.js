import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    version: '2.0.0',
    ts: new Date().toISOString(),
  });
});

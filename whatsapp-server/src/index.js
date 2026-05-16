import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { config, configSummary } from './config.js';
import { logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { webhookRouter } from './routes/webhook.js';
import { webhooksRouter } from './routes/webhooks/index.js';
import { apiRouter } from './routes/api/index.js';
import { flowEndpointRouter } from './routes/flow-endpoint.js';
import { webhookLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { start as startScheduler, stop as stopScheduler } from './scheduler/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Trust Fly's edge proxy (single hop). Without this, express-rate-limit
// throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request because it
// doesn't know how many hops to trust when reading the client IP from
// X-Forwarded-For. `1` = trust exactly one proxy in front of us (Fly's
// load balancer). Anything higher would let clients spoof their own IP
// via X-Forwarded-For headers.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false, // admin-ui needs inline tailwind output
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());

// Health check (no auth, no rate limit)
app.use(healthRouter);

// Meta WhatsApp webhook — raw body captured BEFORE express.json (signature verify needs bytes).
app.use('/webhook', webhookLimiter, webhookRouter);

// Third-party webhooks (calendly / wix / meta-ad / form). Each mounts its own
// express.json() locally so it doesn't clash with the raw-body path above.
app.use('/webhooks', webhookLimiter, webhooksRouter);

// Admin REST API — JSON parser is mounted INSIDE the apiRouter so it doesn't
// clash with the raw-body path above.
app.use('/api', apiRouter);

// Meta WhatsApp Flow endpoint — encrypted data exchange. Mounted outside
// /api/* so it bypasses adminAuth (Meta doesn't send a key; auth is via
// the encryption itself). Mounts its own express.json() locally.
app.use('/whatsapp-flow-endpoint', flowEndpointRouter);

// Serve admin UI in production from admin-ui/dist (built by `npm run build:ui`).
const distDir = path.resolve(__dirname, '../admin-ui/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/webhook') ||
      req.path.startsWith('/whatsapp-flow-endpoint') ||
      req.path.startsWith('/healthz')
    ) {
      return next();
    }
    const index = path.join(distDir, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    next();
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      `whatsapp-server v2 is running.\n` +
      `Admin UI not built — run: cd admin-ui && npm install && npm run build\n` +
      `Health:           GET  /healthz\n` +
      `Webhook verify:   GET  /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...\n` +
      `Webhook receive:  POST /webhook (signed)\n`,
    );
  });
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'whatsapp-server listening');
  logger.info({ config: configSummary() }, 'startup config (masked)');
  startScheduler();
});

function shutdown(sig) {
  logger.info({ sig }, 'shutting down');
  try { stopScheduler(); } catch (e) { logger.warn({ err: e.message }, 'stopScheduler failed'); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

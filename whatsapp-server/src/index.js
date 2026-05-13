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
import { apiRouter } from './routes/api/index.js';
import { webhookLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { start as startScheduler } from './scheduler/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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

// Admin REST API — JSON parser is mounted INSIDE the apiRouter so it doesn't
// clash with the raw-body path above.
app.use('/api', apiRouter);

// Serve admin UI in production from admin-ui/dist (built by `npm run build:ui`).
const distDir = path.resolve(__dirname, '../admin-ui/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook') || req.path.startsWith('/healthz')) {
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config, configSummary } from './config.js';
import { logger } from './logger.js';
import { webhookLimiter, apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { webhookRouter } from './routes/webhook.js';
import { externalRouter } from './routes/external.js';
import { adminRouter } from './routes/admin.js';
import { healthRouter } from './routes/health.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false, // admin-ui needs inline styles from Tailwind build
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());

// Health checks (no rate limit, public)
app.use(healthRouter);

// Meta webhook — rate-limited, raw-body parsed inside the router
app.use('/webhook', webhookLimiter, webhookRouter);

// External integrations — also raw or JSON depending on route, defined per-handler
app.use('/webhooks', webhookLimiter, externalRouter);

// Admin API — JSON parsed inside admin router, auth + rate limit
app.use('/api', apiLimiter, adminRouter);

// Serve admin UI in production from admin-ui/dist
const distDir = path.resolve(__dirname, '../admin-ui/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res, next) => {
    // SPA fallback — but don't catch /api, /webhook, /webhooks
    const index = path.join(distDir, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    next();
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      `WhatsApp server is running.\n` +
      `Admin UI not built yet — run \`cd admin-ui && npm install && npm run build\`.\n` +
      `Health: GET /healthz\n` +
      `Webhook verify: GET /webhook\n` +
      `Webhook receive: POST /webhook\n`,
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

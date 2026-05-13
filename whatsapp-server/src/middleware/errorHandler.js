import { logger } from '../logger.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'not_found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  logger.error({ err: err.message, stack: err.stack }, 'request error');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.code || 'internal_error', message: err.message });
}

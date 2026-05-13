import { logger } from '../logger.js';
import { AppError } from '../errors.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'not_found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err: err.message, code: err.code, path: req.path }, 'app error');
    } else {
      logger.warn({ err: err.message, code: err.code, path: req.path }, 'app error');
    }
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  const status = err.status || err.statusCode || 500;
  logger.error({ err: err.message, stack: err.stack, status, path: req.path }, 'unhandled error');
  res.status(status).json({ error: 'internal_error', message: err.message });
}

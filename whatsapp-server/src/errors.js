// Typed application errors. Mapped to HTTP responses by middleware/errorHandler.js.

export class AppError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'app_error';
    this.status = status || 500;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'validation_error', status: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found', details) {
    super(message, { code: 'not_found', status: 404, details });
  }
}

export class OutsideServiceWindowError extends AppError {
  constructor(message = 'free-text replies are only allowed within 24h of last inbound message') {
    super(message, { code: 'outside_service_window', status: 409 });
  }
}

export class SuppressionError extends AppError {
  constructor(message = 'contact is suppressed', details) {
    super(message, { code: 'suppressed', status: 409, details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'rate limited', details) {
    super(message, { code: 'rate_limited', status: 429, details });
  }
}

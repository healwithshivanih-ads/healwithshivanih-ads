import pino from 'pino';
import { config } from './config.js';

const transport = config.env === 'production'
  ? undefined
  : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    };

export const logger = pino({
  level: config.logLevel,
  transport,
  redact: {
    paths: [
      '*.token',
      '*.WHATSAPP_TOKEN',
      'headers.authorization',
      'headers["x-api-key"]',
      'headers["x-hub-signature-256"]',
      '*.apiKey',
      '*.api_key',
      '*.serviceRoleKey',
      '*.service_role_key',
      '*.appSecret',
      '*.app_secret',
      '*.password',
      'req.headers.authorization',
      'req.headers["x-api-key"]',
    ],
    censor: '[REDACTED]',
  },
});

// Env loading + validation. Fails fast in production for missing required vars;
// in development, missing vars log a warning and return '' so you can boot the
// scaffold and explore the UI without secrets.
import dotenv from 'dotenv';
dotenv.config();

const REQUIRED = [
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'VERIFY_TOKEN',
  'META_APP_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_API_KEY',
];

const env = process.env.NODE_ENV || 'development';
const missing = REQUIRED.filter((k) => !process.env[k]);

if (missing.length && env === 'production') {
  // eslint-disable-next-line no-console
  console.error(`[config] Missing required env vars in production: ${missing.join(', ')}`);
  process.exit(1);
}
if (missing.length) {
  // eslint-disable-next-line no-console
  console.warn(`[config] WARNING: missing env vars (dev mode — proceeding): ${missing.join(', ')}`);
}

export const config = {
  env,
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug'),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Optional default workspace ID. If unset, services/workspaces.getDefault()
  // returns the first row in the workspaces table (creating one if absent).
  workspaceId: process.env.WORKSPACE_ID || null,
  workspaceName: process.env.WORKSPACE_NAME || 'Heal With Shivani',

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    verifyToken: process.env.VERIFY_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
    graphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  admin: {
    apiKey: process.env.ADMIN_API_KEY || '',
  },

  // Round 2: Wix encryption key for storing OAuth tokens at rest.
  // 32 bytes, base64-encoded. Generated once with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY || '',

  // External webhook forwarder. When set, inbound WhatsApp messages (after
  // they're persisted to the messages table) are forwarded to this URL.
  // Used by the FM coach app to ingest WhatsApp messages as session quick-notes.
  // HMAC-SHA256 signature is sent in X-Whatsapp-Signature-256 header.
  fmCoachWebhook: {
    url: process.env.FM_COACH_WEBHOOK_URL || '',
    secret: process.env.FM_COACH_WEBHOOK_SECRET || '',
  },
};

export function configSummary() {
  const mask = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)` : '(empty)');
  return {
    env: config.env,
    port: config.port,
    baseUrl: config.baseUrl,
    workspaceId: config.workspaceId || '(auto)',
    workspaceName: config.workspaceName,
    whatsapp: {
      phoneNumberId: config.whatsapp.phoneNumberId,
      businessAccountId: config.whatsapp.businessAccountId,
      token: mask(config.whatsapp.token),
      verifyToken: mask(config.whatsapp.verifyToken),
      appSecret: mask(config.whatsapp.appSecret),
      graphVersion: config.whatsapp.graphVersion,
    },
    supabase: {
      url: config.supabase.url,
      serviceRoleKey: mask(config.supabase.serviceRoleKey),
    },
    admin: { apiKey: mask(config.admin.apiKey) },
    integrationEncryptionKey: mask(config.integrationEncryptionKey),
  };
}

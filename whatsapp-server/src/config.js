import dotenv from 'dotenv';
dotenv.config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`);
    }
    console.warn(`[config] WARNING: ${name} is not set (dev mode — proceeding)`);
    return '';
  }
  return v;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  whatsapp: {
    token: required('WHATSAPP_TOKEN'),
    phoneNumberId: required('PHONE_NUMBER_ID'),
    businessAccountId: required('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    verifyToken: required('VERIFY_TOKEN'),
    appSecret: required('META_APP_SECRET'),
    graphVersion: 'v21.0',
  },

  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  admin: {
    apiKey: required('ADMIN_API_KEY'),
  },

  calendly: {
    signingSecret: process.env.CALENDLY_SIGNING_SECRET || '',
  },
};

// Masked summary at boot (never log full secrets)
export function configSummary() {
  const mask = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)` : '(empty)');
  return {
    env: config.env,
    port: config.port,
    baseUrl: config.baseUrl,
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
    calendly: { signingSecret: mask(config.calendly.signingSecret) },
  };
}

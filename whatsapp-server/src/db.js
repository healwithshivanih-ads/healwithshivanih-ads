import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logger } from './logger.js';

let _client = null;

export function db() {
  if (_client) return _client;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    logger.warn('Supabase not configured — db calls will fail. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    // Return a stub that throws so callers fail loudly instead of silently
    _client = new Proxy(
      {},
      {
        get() {
          throw new Error('Supabase client not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        },
      },
    );
    return _client;
  }
  _client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

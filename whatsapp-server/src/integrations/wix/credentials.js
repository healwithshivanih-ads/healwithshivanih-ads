// Encrypted credential storage for the wix integration row.
//
// `integrations.credentials_encrypted` is a jsonb column. We store an object
// like { api_key_enc: '<v1:...>', signing_secret_enc?: '<v1:...>' }.
// Each value is encrypted via util/crypto (AES-256-GCM, 32-byte key from env).

import { db } from '../../db.js';
import { encrypt, decrypt } from '../../util/crypto.js';
import { config } from '../../config.js';
import { NotFoundError } from '../../errors.js';

function ensureKey() {
  if (!config.integrationEncryptionKey) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY not set — cannot encrypt integration credentials');
  }
}

export async function setApiKey(integrationId, apiKey) {
  ensureKey();
  const integration = await loadRow(integrationId);
  const blob = { ...(integration.credentials_encrypted || {}) };
  blob.api_key_enc = apiKey ? encrypt(apiKey) : null;
  const { data, error } = await db().from('integrations')
    .update({ credentials_encrypted: blob })
    .eq('id', integrationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSigningSecret(integrationId, secret) {
  ensureKey();
  const integration = await loadRow(integrationId);
  const blob = { ...(integration.credentials_encrypted || {}) };
  blob.signing_secret_enc = secret ? encrypt(secret) : null;
  const { data, error } = await db().from('integrations')
    .update({ credentials_encrypted: blob })
    .eq('id', integrationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getApiKey(integrationId) {
  ensureKey();
  const integration = await loadRow(integrationId);
  const enc = integration.credentials_encrypted?.api_key_enc;
  return enc ? decrypt(enc) : null;
}

export async function getSigningSecret(integrationId) {
  ensureKey();
  const integration = await loadRow(integrationId);
  const enc = integration.credentials_encrypted?.signing_secret_enc;
  return enc ? decrypt(enc) : null;
}

async function loadRow(id) {
  const { data, error } = await db().from('integrations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('integration not found');
  return data;
}

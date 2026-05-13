import { Router } from 'express';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import * as wixCreds from '../../integrations/wix/credentials.js';
import * as wixClient from '../../integrations/wix/client.js';
import * as wixReconciler from '../../integrations/wix/reconciler.js';
import { NotFoundError, ValidationError } from '../../errors.js';

export const integrationsRouter = Router();

// GET /api/integrations
integrationsRouter.get('/', async (_req, res, next) => {
  try {
    const ws = await getDefaultWorkspace();
    const { data, error } = await db().from('integrations').select('*')
      .eq('workspace_id', ws.id)
      .order('type');
    if (error) throw error;
    // Strip ciphertext from response
    const out = (data || []).map(stripCreds);
    res.json({ items: out });
  } catch (e) { next(e); }
});

// POST /api/integrations  body: { type, credentials?: { api_key?, signing_secret? }, config? }
// Creates or updates the row + stashes creds encrypted.
integrationsRouter.post('/', async (req, res, next) => {
  try {
    const ws = await getDefaultWorkspace();
    const { type, credentials, config: cfg } = req.body || {};
    if (!type || !['wix', 'calendly', 'meta_ads', 'meta_whatsapp'].includes(type)) {
      throw new ValidationError(`type must be wix|calendly|meta_ads|meta_whatsapp`);
    }

    // Upsert the row.
    const { data: existing } = await db().from('integrations')
      .select('*').eq('workspace_id', ws.id).eq('type', type).maybeSingle();
    let row;
    if (existing) {
      const patch = { config: cfg || existing.config || {} };
      if (credentials) {
        // Will be re-stashed below; mark connected provisionally if a key was passed.
        patch.status = 'connected';
        patch.last_error = null;
      }
      const { data, error } = await db().from('integrations')
        .update(patch).eq('id', existing.id).select().single();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await db().from('integrations').insert({
        workspace_id: ws.id,
        type,
        status: credentials ? 'connected' : 'pending',
        config: cfg || {},
      }).select().single();
      if (error) throw error;
      row = data;
    }

    if (credentials?.api_key) await wixCreds.setApiKey(row.id, credentials.api_key);
    if (credentials?.signing_secret) await wixCreds.setSigningSecret(row.id, credentials.signing_secret);

    const fresh = await loadIntegration(row.id);
    res.json(stripCreds(fresh));
  } catch (e) { next(e); }
});

// POST /api/integrations/:id/test  (verify credentials)
integrationsRouter.post('/:id/test', async (req, res, next) => {
  try {
    const i = await loadIntegration(req.params.id);
    if (i.type !== 'wix') {
      return res.json({ ok: true, message: `test not implemented for type=${i.type}` });
    }
    try {
      const apiKey = await wixCreds.getApiKey(i.id);
      if (!apiKey) return res.status(400).json({ ok: false, error: 'no_api_key' });
      const r = await wixClient.ping(apiKey);
      // mark connected
      await db().from('integrations').update({ status: 'connected', last_error: null }).eq('id', i.id);
      res.json({ ok: true, sample_count: r?.items?.length || 0 });
    } catch (e) {
      await db().from('integrations').update({
        status: 'error',
        last_error: { message: e.message, status: e.status, at: new Date().toISOString() },
      }).eq('id', i.id);
      res.status(400).json({ ok: false, error: e.message, status: e.status, body: e.body });
    }
  } catch (e) { next(e); }
});

// POST /api/integrations/:id/sync  (kick off full resync, async)
integrationsRouter.post('/:id/sync', async (req, res, next) => {
  try {
    const i = await loadIntegration(req.params.id);
    if (i.type !== 'wix') return res.status(400).json({ ok: false, error: `sync not supported for type=${i.type}` });
    res.status(202).json({ ok: true, started: true });
    wixReconciler.fullResync(i.id).catch((e) =>
      logger.error({ err: e.message }, 'wix full resync failed'));
  } catch (e) { next(e); }
});

// DELETE /api/integrations/:id
integrationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { data, error } = await db().from('integrations').update({
      status: 'disconnected',
      credentials_encrypted: null,
    }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ ok: true, integration: stripCreds(data) });
  } catch (e) { next(e); }
});

async function loadIntegration(id) {
  const { data, error } = await db().from('integrations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('integration not found');
  return data;
}

function stripCreds(row) {
  if (!row) return row;
  const { credentials_encrypted, ...rest } = row;
  return {
    ...rest,
    has_credentials: !!(credentials_encrypted && Object.values(credentials_encrypted).some(Boolean)),
  };
}

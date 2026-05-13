// Generic form webhook (Wix forms, Tally, JotForm, custom landing pages, etc.).
// Body: { phone, name?, email?, tags?: string[], source?: string }

import { Router } from 'express';
import express from 'express';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { matchContact } from '../../services/contacts/matcher.js';
import * as tagsSvc from '../../services/contacts/tags.js';

export const formWebhook = Router();
formWebhook.use(express.json({ limit: '1mb' }));

formWebhook.post('/', async (req, res) => {
  const body = req.body || {};

  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'form',
      event_type: body?.source || null,
      signature_valid: null,
      payload: body,
      headers: scrubHeaders(req.headers),
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (form) failed');
  }

  res.sendStatus(200);

  processForm(body, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'form process failed'));
});

async function processForm(body, webhookRowId) {
  try {
    const ws = await getDefaultWorkspace();
    const { phone, name, email, tags, source } = body || {};
    if (!phone && !email) {
      logger.warn({ body }, 'form webhook: no phone or email, skipping');
    } else {
      const { contact } = await matchContact(ws.id, {
        phone, email, display_name: name,
        opt_in_source: source || 'form',
      });
      const tagList = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [];
      for (const t of tagList) {
        await tagsSvc.addToContact(contact.id, t, 'form_webhook').catch(() => {});
      }
    }
  } catch (e) {
    logger.error({ err: e.message }, 'form inbound processing failed');
  }
  if (webhookRowId) {
    await db().from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', webhookRowId)
      .catch(() => {});
  }
}

function scrubHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const kl = k.toLowerCase();
    if (kl === 'authorization' || kl === 'x-api-key') continue;
    out[k] = v;
  }
  return out;
}

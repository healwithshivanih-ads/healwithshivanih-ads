// Wix webhook handler.
//
// Persists raw → 200 fast → process async via integrations/wix/inbound.
// Wix payloads are JWT-signed when delivered as `Webhook` style. We don't ship
// jsonwebtoken in this round to keep the dep tree minimal — TODO: verify the
// JWT signature once we wire `jsonwebtoken`. For now, if WIX_WEBHOOK_SECRET is
// set, we attempt a coarse match against `x-wix-secret` header (some Wix
// integrations do support this); otherwise we accept and log.

import { Router } from 'express';
import express from 'express';
import process from 'node:process';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import * as wixInbound from '../../integrations/wix/inbound.js';

export const wixWebhook = Router();
wixWebhook.use(express.json({ limit: '5mb' }));

wixWebhook.post('/', async (req, res) => {
  const body = req.body || {};
  const eventType = body?.eventType || body?.slug || body?.event || null;

  let signatureValid = null;
  const secret = process.env.WIX_WEBHOOK_SECRET || '';
  if (secret) {
    const headerSecret = req.header('x-wix-secret') || req.header('x-wix-webhook-secret') || '';
    signatureValid = headerSecret === secret;
    // TODO: properly verify the JWT signature using `jsonwebtoken` once added.
  }

  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'wix',
      event_type: eventType,
      signature_valid: signatureValid,
      payload: body,
      headers: scrubHeaders(req.headers),
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (wix) failed');
  }

  if (secret && signatureValid === false) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  res.sendStatus(200);

  processWix(body, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'wix process failed'));
});

async function processWix(body, webhookRowId) {
  try {
    await wixInbound.processContactEvent(body);
  } catch (e) {
    logger.error({ err: e.message }, 'wix inbound processing failed');
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

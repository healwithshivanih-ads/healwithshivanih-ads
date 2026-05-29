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
// Accept BOTH application/json AND text/plain — Wix's Webhooks API delivers
// signed payloads as a JWT string with content-type: text/plain. We need
// the raw text to JWT-decode later. (Until v0.64-ish we used express.json()
// which silently turned text/plain into `{}` and we lost the body.)
wixWebhook.use(express.text({ type: '*/*', limit: '5mb' }));

wixWebhook.post('/', async (req, res) => {
  const rawBody = typeof req.body === 'string' ? req.body : '';
  const body = parseMaybeJson(rawBody);
  const eventType = body?.eventType || body?.slug || body?.event || null;
  // Sniff: starts with eyJ ⇒ Wix JWT. Useful for diagnostics until we
  // properly verify + decode with `jsonwebtoken`.
  const looksLikeJwt = /^eyJ[\w-]+\./.test(rawBody.trim());
  logger.info({ path: req.originalUrl, ct: req.get('content-type') || null, looksLikeJwt, raw_len: rawBody.length }, 'wix webhook hit');

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
      // Persist BOTH parsed body (best-effort) AND raw text so we can
      // JWT-decode later. Path stashed in payload so we can tell which
      // route Wix is actually configured to hit (wix vs wix-bookings).
      payload: { parsed: body, raw_body: rawBody, request_path: req.originalUrl, looks_like_jwt: looksLikeJwt },
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
    try {
      await db().from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', webhookRowId);
    } catch (e) {
      logger.warn({ err: e.message }, 'wix: marking webhook_events processed failed');
    }
  }
}

function parseMaybeJson(s) {
  if (!s) return {};
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return {};
  try { return JSON.parse(t); } catch { return {}; }
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

// Generic CTWA (Click-to-WhatsApp) ad lead webhook.
// No signature verification — these come from internal forwarders or our own
// edge functions that already authenticate the upstream.
//
// Body shape:
//   { phone, name?, email?, ad_id?, campaign_name?, form_responses? }

import { Router } from 'express';
import express from 'express';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { matchContact } from '../../services/contacts/matcher.js';
import * as tagsSvc from '../../services/contacts/tags.js';
import * as contacts from '../../services/contacts/index.js';

export const metaAdWebhook = Router();
metaAdWebhook.use(express.json({ limit: '1mb' }));

metaAdWebhook.post('/', async (req, res) => {
  const body = req.body || {};

  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'meta_ad',
      event_type: body?.campaign_name || null,
      signature_valid: null,
      payload: body,
      headers: scrubHeaders(req.headers),
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (meta_ad) failed');
  }

  res.sendStatus(200);

  processMetaAd(body, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'meta-ad process failed'));
});

async function processMetaAd(body, webhookRowId) {
  try {
    const ws = await getDefaultWorkspace();
    const { phone, name, email, ad_id, campaign_name, form_responses } = body || {};
    if (!phone && !email) {
      logger.warn({ body }, 'meta-ad: no phone or email, skipping');
    } else {
      const { contact, created } = await matchContact(ws.id, {
        phone, email, display_name: name,
        opt_in_source: 'meta_ad',
        metadata: {
          meta_ad_id: ad_id,
          meta_campaign_name: campaign_name,
          form_responses,
        },
      });

      // For existing contacts, also patch the meta metadata + opt_in_source.
      if (!created) {
        await contacts.patch(contact.id, {
          opt_in_source: contact.opt_in_source || 'meta_ad',
          metadata: {
            ...(contact.metadata || {}),
            meta_ad_id: ad_id,
            meta_campaign_name: campaign_name,
            form_responses,
          },
        }).catch((e) => logger.warn({ err: e.message }, 'meta_ad patch failed'));
      }

      await tagsSvc.addToContact(contact.id, 'health-coaching-lead', 'meta_ad').catch(() => {});
      if (campaign_name && /cortisol/i.test(campaign_name)) {
        await tagsSvc.addToContact(contact.id, 'cortisol-lead', 'meta_ad').catch(() => {});
      }
    }
  } catch (e) {
    logger.error({ err: e.message }, 'meta-ad inbound processing failed');
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

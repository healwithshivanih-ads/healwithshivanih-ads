// Outbound webhook forwarder for inbound WhatsApp messages.
//
// When the Meta webhook delivers a new inbound message, the webhook router
// calls forwardInbound() with the parsed event + contact context. This service
// fires a signed POST to config.fmCoachWebhook.url. Fire-and-forget: failures
// are logged but never block inbound processing. The raw event already lives
// in webhook_events, so a missed forward is recoverable manually.
//
// Signature: HMAC-SHA256 of the exact JSON body bytes, hex-encoded, sent as
// `sha256=<hex>` in the X-Whatsapp-Signature-256 header (mirrors Meta's
// signature pattern so the receiver can reuse the same verifier).

import { createHmac } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

const TIMEOUT_MS = 5000;

export async function forwardInbound({ event, contact, conversation, message }) {
  const url = config.fmCoachWebhook.url;
  const secret = config.fmCoachWebhook.secret;
  if (!url) return; // forwarder disabled

  const payload = {
    type: 'inbound_message',
    wa_id: event.wa_id,
    profile_name: event.profile_name || null,
    message_type: event.type,
    body: event.body || '',
    external_message_id: event.external_message_id,
    timestamp: event.timestamp,
    contact_id: contact?.id || null,
    contact_display_name: contact?.display_name || null,
    conversation_id: conversation?.id || null,
    message_id: message?.id || null,
    raw_payload: event.payload || null,
  };

  const bodyStr = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const sig = createHmac('sha256', secret).update(bodyStr).digest('hex');
    headers['X-Whatsapp-Signature-256'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, url, body: text.slice(0, 200) },
        'fm-coach webhook forward returned non-2xx',
      );
    } else {
      logger.info({ wa_id: event.wa_id, url }, 'fm-coach webhook forwarded');
    }
  } catch (err) {
    logger.warn({ err: err.message, url }, 'fm-coach webhook forward failed');
  } finally {
    clearTimeout(timer);
  }
}

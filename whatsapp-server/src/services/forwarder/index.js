// Outbound webhook forwarder for inbound WhatsApp messages.
//
// Routing — each inbound is forwarded to EXACTLY ONE destination based on
// signals in the message body:
//
//   1. If the body contains a `ref:<slug>` (or `[funnel:<slug>]`) token AND
//      the slug is in config.funnelsAppSlugs → forward to the funnels app
//      (Ochre Funnel — AI agent + Conversations panel for CTWA leads).
//   2. Otherwise → forward to the fm-coach app (historical default — FM
//      coach clients messaging her business number).
//
// One destination per message — these are distinct audiences with distinct
// downstream pipelines. Fire-and-forget: failures are logged but never
// block inbound processing. The raw event already lives in webhook_events,
// so a missed forward is recoverable manually.
//
// Signature: HMAC-SHA256 of the exact JSON body bytes, hex-encoded, sent as
// `sha256=<hex>` in the X-Whatsapp-Signature-256 header (mirrors Meta's
// signature pattern so the receiver can reuse the same verifier).

import { createHmac } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

const TIMEOUT_MS = 5000;

/** Extract a `ref:<slug>` / `[funnel:<slug>]` token from the message body.
 *  Matches the funnels app's own slug-extractor so both sides agree. */
function extractFunnelSlug(body) {
  if (!body) return null;
  const m = body.match(
    /(?:\bref[:=]|\[funnel[:=])\s*([a-z0-9][a-z0-9-]{1,59})\]?/i,
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * PURE routing decision. Returns { name: 'funnels-app'|'fm-coach', slug }.
 *
 * Number-aware (multi-number support):
 *   - Inbound on the MARKETING number (88501) → always the funnels app, since
 *     that number carries only CTWA/acquisition traffic. We still extract a
 *     slug for attribution, but route there even if none is found.
 *   - Inbound on the DEFAULT/clients number (89765) → the original
 *     content-based routing: `ref:<slug>` in a known funnel → funnels app,
 *     everything else → fm-coach.
 *
 * Back-compat: when no marketing number is configured (marketingPhoneNumberId
 * null), the number branch never fires and behaviour is exactly as before.
 */
export function chooseRoute(event, { marketingPhoneNumberId, funnelsAppSlugs }) {
  const slug = extractFunnelSlug(event.body);
  const onMarketingNumber =
    marketingPhoneNumberId &&
    event.phone_number_id &&
    String(event.phone_number_id) === String(marketingPhoneNumberId);
  if (onMarketingNumber) {
    return { name: 'funnels-app', slug };
  }
  if (slug && (funnelsAppSlugs || []).includes(slug)) {
    return { name: 'funnels-app', slug };
  }
  return { name: 'fm-coach', slug: null };
}

/** Pick the destination (URL + secret + name for logging) for an inbound. */
function pickDestination(event) {
  const route = chooseRoute(event, {
    marketingPhoneNumberId: config.whatsapp.numbers?.marketing?.phoneNumberId || null,
    funnelsAppSlugs: config.funnelsAppSlugs,
  });
  if (route.name === 'funnels-app') {
    return {
      name: 'funnels-app',
      url: config.funnelsAppWebhook.url,
      secret: config.funnelsAppWebhook.secret,
      slug: route.slug,
    };
  }
  return {
    name: 'fm-coach',
    url: config.fmCoachWebhook.url,
    secret: config.fmCoachWebhook.secret,
    slug: null,
  };
}

/**
 * Forward an India-payment status update to the funnels app. In-chat WhatsApp
 * Pay (order_details) confirmations arrive as `statuses[].type === 'payment'`;
 * the funnels app reconciles by `reference_id` and marks the lead registered.
 * Payments only ever belong to the funnels app (acquisition), so — unlike
 * inbound messages — there's no fm-coach branch. Fire-and-forget.
 */
export async function forwardPaymentStatus({ event }) {
  const url = config.funnelsAppWebhook.url;
  const secret = config.funnelsAppWebhook.secret;
  if (!url) return; // funnels app not configured

  const payment = event.payment || {};
  const payload = {
    type: 'payment_status',
    reference_id: payment.reference_id || null,
    // captured | pending | failed (the overall payment status)
    payment_status: event.status || payment.status || null,
    recipient_id: event.recipient_id || null,
    external_message_id: event.external_message_id || null,
    timestamp: event.timestamp,
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
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, url, ref: payload.reference_id, body: text.slice(0, 200) },
        'funnels-app payment_status forward returned non-2xx',
      );
    } else {
      logger.info(
        { ref: payload.reference_id, payment_status: payload.payment_status },
        'funnels-app payment_status forwarded',
      );
    }
  } catch (err) {
    logger.warn({ err: err.message, url, ref: payload.reference_id }, 'funnels-app payment_status forward failed');
  } finally {
    clearTimeout(timer);
  }
}

export async function forwardInbound({ event, contact, conversation, message }) {
  const dest = pickDestination(event);
  if (!dest.url) return; // destination disabled / unset

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
    // Funnels-app receiver reads referral.funnel_slug to attach the
    // conversation to a funnel. Include it explicitly when the router
    // detected one so the receiver doesn't need to re-parse the body.
    referral: dest.slug ? { funnel_slug: dest.slug } : undefined,
  };

  const bodyStr = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (dest.secret) {
    const sig = createHmac('sha256', dest.secret).update(bodyStr).digest('hex');
    headers['X-Whatsapp-Signature-256'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(dest.url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { dest: dest.name, status: res.status, url: dest.url, body: text.slice(0, 200) },
        `${dest.name} webhook forward returned non-2xx`,
      );
    } else {
      logger.info(
        { dest: dest.name, wa_id: event.wa_id, url: dest.url, slug: dest.slug },
        `${dest.name} webhook forwarded`,
      );
    }
  } catch (err) {
    logger.warn(
      { dest: dest.name, err: err.message, url: dest.url },
      `${dest.name} webhook forward failed`,
    );
  } finally {
    clearTimeout(timer);
  }
}

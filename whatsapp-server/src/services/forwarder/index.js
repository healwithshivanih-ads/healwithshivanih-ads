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

// Media (image/document/audio/video/sticker) is downloaded with the WABA
// access token and inlined as base64 in the forward, because the receiver
// (fm-coach on the Mac) has no Meta token and the lookaside CDN URL needs
// one + expires. Cap the inline size so a 100 MB document can't blow the
// receiver's request-body limit — above the cap we forward metadata only
// and the receiver records a "not synced" note so the info still surfaces.
const MEDIA_KINDS = new Set(['image', 'document', 'audio', 'video', 'sticker']);
const MAX_INLINE_BYTES = 12 * 1024 * 1024; // 12 MB

/**
 * Resolve + download a WhatsApp media attachment for forwarding. Returns null
 * for non-media events. For media, returns { media_kind, media_mime,
 * media_filename, media_size, media_base64 } — media_base64 is null (with a
 * skipped_reason) when the token is missing, the file is too large, or the
 * download fails, so the receiver always learns the attachment EXISTED.
 */
async function downloadMediaForForward(event) {
  const kind = event.type;
  if (!MEDIA_KINDS.has(kind)) return null;
  const obj = event.payload?.[kind] || {};
  const mediaId = obj.id;
  const base = {
    media_kind: kind,
    media_mime: obj.mime_type || null,
    media_filename: obj.filename || null,
    media_caption: obj.caption || null,
    media_base64: null,
  };
  if (!mediaId) return { ...base, skipped_reason: 'no_media_id' };

  const token = config.whatsapp.token;
  if (!token) {
    logger.warn({ mediaId, kind }, 'media forward: no WABA token configured');
    return { ...base, skipped_reason: 'no_token' };
  }
  const gv = config.whatsapp.graphVersion;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${gv}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    if (!meta?.url) return { ...base, skipped_reason: 'no_download_url' };
    if (meta.mime_type) base.media_mime = meta.mime_type;
    if (meta.file_size && meta.file_size > MAX_INLINE_BYTES) {
      return { ...base, media_size: meta.file_size, skipped_reason: 'too_large' };
    }
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await binRes.arrayBuffer());
    if (buf.length > MAX_INLINE_BYTES) {
      return { ...base, media_size: buf.length, skipped_reason: 'too_large' };
    }
    return { ...base, media_size: buf.length, media_base64: buf.toString('base64') };
  } catch (err) {
    logger.warn({ err: err.message, mediaId, kind }, 'media download for forward failed');
    return { ...base, skipped_reason: 'download_error' };
  }
}

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

/**
 * Forward an OUTBOUND message (coach reply typed in the admin Inbox UI) to the
 * fm-coach app so it lands in the client's chat thread there too.
 *
 * Why this exists: the FM coach reads/replies in TWO places — the fm-coach
 * dashboard Communication tab AND this server's admin Inbox. fm-coach already
 * self-records any message IT sends (origin='api'); but a reply Shivani types
 * directly in the admin Inbox (origin='manual') never reaches fm-coach, so it
 * looked like a one-sided thread. This closes that gap.
 *
 * Routing — mirror the inbound number-aware decision:
 *   - Sent AS the marketing number (88501) → funnels-app audience → skip
 *     fm-coach (those are CTWA leads, not coach clients).
 *   - Otherwise (default/clients number 89765) → fm-coach.
 *
 * Dedup guarantee: the ONLY caller is messages.send(), and it calls this
 * EXCLUSIVELY for origin==='manual'. fm-coach-initiated sends (origin==='api'),
 * reminders, broadcasts and AI replies are never forwarded — so fm-coach never
 * receives an echo of a message it (or a cron) already recorded.
 *
 * Fire-and-forget. The recipient phone is the client's wa_id from fm-coach's
 * point of view, so the receiver matches the client exactly as it does for
 * inbound.
 */
export async function forwardOutbound({ message, contact, from }) {
  // Marketing-number sends belong to the funnels app, which has no coach
  // thread to update — drop them. Everything else → fm-coach.
  const onMarketing = from && String(from).toLowerCase() === 'marketing';
  if (onMarketing) return;

  const url = config.fmCoachWebhook.url;
  const secret = config.fmCoachWebhook.secret;
  if (!url) return; // fm-coach not configured

  const to = contact?.primary_phone;
  if (!to) return; // can't attribute without the recipient phone

  const payload = {
    type: 'inbound_message', // receiver's envelope type; direction below disambiguates
    direction: 'outbound',
    wa_id: to, // the CLIENT's phone — fm-coach matches the client by this
    profile_name: contact?.display_name || null,
    message_type: message?.type || 'text',
    body: message?.body || '',
    external_message_id: message?.external_message_id || null,
    // Use the actual send time so the chat bubble carries the right timestamp.
    timestamp: message?.sent_at || new Date().toISOString(),
    template_name: message?.template_name || null,
    contact_id: contact?.id || null,
    contact_display_name: contact?.display_name || null,
    message_id: message?.id || null,
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
        { status: res.status, url, wa_id: to, body: text.slice(0, 200) },
        'fm-coach outbound forward returned non-2xx',
      );
    } else {
      logger.info({ wa_id: to, url }, 'fm-coach outbound forwarded');
    }
  } catch (err) {
    logger.warn({ err: err.message, url, wa_id: to }, 'fm-coach outbound forward failed');
  } finally {
    clearTimeout(timer);
  }
}

export async function forwardInbound({ event, contact, conversation, message }) {
  const dest = pickDestination(event);
  if (!dest.url) return; // destination disabled / unset

  // Media messages (image/document/etc.) — download + inline so the receiver
  // can store the file and surface it in the thread. null for plain text.
  const media = await downloadMediaForForward(event);

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
    // Inlined attachment (base64 + mime + filename) when this is a media
    // message; spread so plain-text forwards are byte-identical to before.
    ...(media || {}),
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

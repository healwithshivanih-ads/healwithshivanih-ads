// Wix Bookings webhook handler.
//
// Receives booking-lifecycle events from Wix (Wix Bookings v2 webhook config).
// Persists raw → 200 fast → process async.
//
// Wix is notably defensive about webhook payload shape: depending on whether
// it's configured via the Wix Webhooks API, Wix Automations (visual builder),
// or direct Bookings webhook, the payload structure differs. We extract
// fields from multiple known locations.
//
// Signature: Wix uses JWT-signed bodies for the Webhooks API path. We don't
// ship `jsonwebtoken` yet, so verification is a coarse `x-wix-secret` header
// check when WIX_BOOKINGS_WEBHOOK_SECRET is set. TODO: full JWT verify later.

import { Router } from 'express';
import express from 'express';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { matchContact } from '../../services/contacts/matcher.js';
import * as appointments from '../../services/appointments/index.js';
import * as tagsSvc from '../../services/contacts/tags.js';
import { decodeWixWebhook, WixJwtVerifyError } from '../../integrations/wix/jwt.js';

export const wixBookingsWebhook = Router();
// Wix sends bookings webhooks as JWT strings with content-type: text/plain.
// Accept everything as text so the raw body survives for later JWT decode.
wixBookingsWebhook.use(express.text({ type: '*/*', limit: '5mb' }));

wixBookingsWebhook.post('/', async (req, res) => {
  const rawBody = typeof req.body === 'string' ? req.body : '';
  const looksLikeJwt = /^eyJ[\w-]+\./.test(rawBody.trim());
  logger.info({ path: req.originalUrl, ct: req.get('content-type') || null, looksLikeJwt, raw_len: rawBody.length }, 'wix-bookings webhook hit');

  // Verify JWT signature against the WIX_WEBHOOK_PUBLIC_KEY (RS256), then
  // double-unwrap to get the real event envelope. The fallback to plain
  // JSON parsing keeps local probe/test calls working when there's no JWT.
  let signatureValid = null;
  let decoded = null;
  let decodeError = null;
  if (looksLikeJwt) {
    try {
      decoded = decodeWixWebhook(rawBody);
      signatureValid = true;
    } catch (e) {
      signatureValid = false;
      decodeError = e instanceof WixJwtVerifyError ? `${e.code}: ${e.message}` : e.message;
      logger.warn({ err: decodeError }, 'wix-bookings: JWT decode/verify failed');
    }
  }

  // For diagnostics and the legacy handlers, we still want a flattened
  // body. Prefer the decoded envelope when available; fall back to a
  // best-effort JSON parse for non-JWT probe calls.
  const body = decoded?.envelope || parseMaybeJson(rawBody);
  const eventType = decoded?.eventType || decoded?.slug || pickEventType(body);

  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      // DB check-constraint only allows the canonical source enum values.
      // Use `wix` and discriminate at read time via payload.request_path.
      source: 'wix',
      event_type: eventType,
      signature_valid: signatureValid,
      payload: {
        parsed: body,
        raw_body: rawBody,
        request_path: req.originalUrl,
        looks_like_jwt: looksLikeJwt,
        decoded_envelope: decoded?.envelope || null,
        entity_fqdn: decoded?.entityFqdn || null,
        decode_error: decodeError || null,
      },
      headers: scrubHeaders(req.headers),
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (wix-bookings) failed');
  }

  // Always 200 — Wix retries on 4xx/5xx and the raw payload survives in
  // webhook_events for replay. If signature failed we log + drop.
  res.sendStatus(200);
  if (looksLikeJwt && signatureValid === false) {
    logger.warn({ err: decodeError }, 'wix-bookings: dropping unverified JWT');
    return;
  }

  processWixBooking(body, eventType, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'wix-bookings process failed'));
});

async function processWixBooking(body, eventType, webhookRowId) {
  try {
    const action = classifyAction(eventType, body);
    const booking = extractBooking(body);

    if (!action) {
      logger.info({ eventType }, 'wix-bookings: unhandled event type');
    } else if (!booking || !booking.id) {
      logger.warn({ eventType }, 'wix-bookings: could not extract booking id');
    } else if (action === 'create') {
      await handleCreated(booking);
    } else if (action === 'reschedule') {
      await handleRescheduled(booking);
    } else if (action === 'cancel') {
      await handleCancelled(booking);
    }
  } catch (e) {
    logger.error({ err: e.message, eventType }, 'wix-bookings process error');
  }

  if (webhookRowId) {
    await db().from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', webhookRowId)
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Event type → action classification
// ---------------------------------------------------------------------------
function pickEventType(body) {
  return body?.eventType
    || body?.slug
    || body?.event
    || body?.triggerEvent
    || body?.entityFqdn
    || null;
}

function classifyAction(eventType, body) {
  if (!eventType) return null;
  const s = String(eventType).toLowerCase();
  // Common Wix patterns:
  //   wix.bookings.v2.booking_created
  //   bookings/created
  //   BookingCreated
  if (s.includes('created') || s.includes('confirmed') || s.includes('approved')) return 'create';
  if (s.includes('rescheduled') || s.includes('updated') || s.includes('changed')) return 'reschedule';
  if (s.includes('canceled') || s.includes('cancelled') || s.includes('declined') || s.includes('deleted')) return 'cancel';
  // Wix Automations may not set eventType cleanly — fall back to inspecting payload
  if (body?.booking && !body?.booking?.cancelled) return 'create';
  return null;
}

// ---------------------------------------------------------------------------
// Booking extraction — handles multiple Wix payload shapes defensively
// ---------------------------------------------------------------------------
function extractBooking(body) {
  // Common locations: body.booking, body.data.booking, body.actionEvent.body.booking,
  // body.data.data.booking, body.payload.booking
  const candidates = [
    body?.booking,
    body?.data?.booking,
    body?.data,                                  // sometimes booking IS the data
    body?.actionEvent?.body?.booking,
    body?.actionEvent?.bodyAsJson?.booking,
    body?.payload?.booking,
    body?.payload,
  ];
  const booking = candidates.find((b) => b && typeof b === 'object' && (b.id || b._id || b.bookingId));
  if (!booking) return null;

  const id = booking.id || booking._id || booking.bookingId;

  // Contact details may sit under several keys
  const contact = booking.contactDetails
    || booking.contact
    || booking.formInfo?.contactDetails
    || booking.bookedEntity?.contact
    || {};

  const email = contact.email || contact.emailAddress || booking.email || null;
  const phone = contact.phone || contact.phoneNumber || booking.phone || null;
  const firstName = contact.firstName || contact.first_name || booking.firstName || '';
  const lastName = contact.lastName || contact.last_name || booking.lastName || '';
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
    || contact.fullName || contact.name || booking.attendeeName || null;

  // Start / end times — try a few shapes
  const startsAt = booking.startDate
    || booking.start
    || booking.startTime
    || booking.bookedEntity?.slot?.startDate
    || booking.bookedEntity?.startDate
    || null;
  const endsAt = booking.endDate
    || booking.end
    || booking.endTime
    || booking.bookedEntity?.slot?.endDate
    || booking.bookedEntity?.endDate
    || null;

  const title = booking.serviceName
    || booking.bookedEntity?.title
    || booking.bookedEntity?.serviceName
    || booking.title
    || 'Wix booking';

  const location = pickLocation(booking);
  const joinUrl = booking.videoConferenceUrl
    || booking.meetingUrl
    || booking.bookedEntity?.location?.videoConference?.url
    || booking.bookedEntity?.location?.url
    || null;

  const cancelReason = booking.cancellationReason || booking.cancelReason || null;

  return {
    id: String(id),
    email,
    phone,
    name,
    startsAt,
    endsAt,
    title,
    location,
    joinUrl,
    cancelReason,
    raw: booking,
  };
}

function pickLocation(booking) {
  const loc = booking.location || booking.bookedEntity?.location;
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  return loc.locationType || loc.type || loc.name || loc.formattedAddress || null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleCreated(booking) {
  const ws = await getDefaultWorkspace();
  if (!booking.startsAt) {
    logger.warn({ id: booking.id }, 'wix-bookings: no start time, skipping create');
    return;
  }

  const { contact } = await matchContact(ws.id, {
    email: booking.email,
    phone: booking.phone,
    display_name: booking.name,
  });
  await tagsSvc.addToContact(contact.id, 'booked-call', 'wix_bookings_webhook').catch((e) =>
    logger.warn({ err: e.message }, 'tag booked-call failed'));

  await appointments.create({
    workspaceId: ws.id,
    contactId: contact.id,
    source: 'wix',
    externalId: `wix_booking:${booking.id}`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    title: booking.title,
    location: booking.location,
    joinUrl: booking.joinUrl,
    metadata: {
      wix_booking_id: booking.id,
    },
  });
}

async function handleRescheduled(booking) {
  const ws = await getDefaultWorkspace();
  if (!booking.id) return;
  const { data: appt } = await db().from('appointments').select('id')
    .eq('workspace_id', ws.id).eq('source', 'wix')
    .eq('external_id', `wix_booking:${booking.id}`).maybeSingle();
  if (!appt) {
    // Not seen before — treat as create
    return handleCreated(booking);
  }
  await appointments.update(appt.id, {
    starts_at: booking.startsAt,
    ends_at: booking.endsAt,
    status: 'rescheduled',
  });
}

async function handleCancelled(booking) {
  const ws = await getDefaultWorkspace();
  if (!booking.id) return;
  const { data: appt } = await db().from('appointments').select('id')
    .eq('workspace_id', ws.id).eq('source', 'wix')
    .eq('external_id', `wix_booking:${booking.id}`).maybeSingle();
  if (!appt) return;
  await appointments.cancel(appt.id, booking.cancelReason);
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

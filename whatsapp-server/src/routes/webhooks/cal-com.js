// Cal.com webhook handler.
//
// Cal.com (the open-source Calendly alternative) sends webhooks like:
//   { triggerEvent: "BOOKING_CREATED", createdAt: "...", payload: {...} }
//
// Signature header is "X-Cal-Signature-256: <hex>" — straight HMAC-SHA256 of
// the raw body with the secret (no timestamp prefix like Calendly).
//
// Always: persist raw → 200 fast → process async.

import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import process from 'node:process';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { matchContact } from '../../services/contacts/matcher.js';
import * as appointments from '../../services/appointments/index.js';
import * as tagsSvc from '../../services/contacts/tags.js';
import { forwardBookingToFmCoach } from '../../services/forwarder/cal-com-forwarder.js';

export const calComWebhook = Router();

// Capture raw body for signature verification, then parse JSON.
calComWebhook.use(express.raw({ type: 'application/json', limit: '2mb' }));

calComWebhook.post('/', async (req, res) => {
  const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const rawStr = rawBuf.toString('utf8');

  let body = {};
  try { body = rawStr ? JSON.parse(rawStr) : {}; }
  catch (e) {
    logger.warn({ err: e.message }, 'cal.com: invalid JSON payload');
  }

  const headers = scrubHeaders(req.headers);
  const eventType = body.triggerEvent || null;

  let signatureValid = null;
  const secret = process.env.CAL_COM_SIGNING_SECRET || '';
  if (secret) {
    signatureValid = verifyCalComSignature(rawStr, req.header('x-cal-signature-256') || '', secret);
  }

  // Persist before doing anything.
  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'calendly',           // schema enum doesn't have 'cal_com'; store under calendly bucket
      event_type: eventType,
      signature_valid: signatureValid,
      payload: body,
      headers,
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (cal.com) failed');
  }

  if (secret && signatureValid === false) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  res.sendStatus(200);

  processCalCom(body, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'cal.com process failed'));
});

async function processCalCom(body, webhookRowId) {
  const eventType = body?.triggerEvent || null;
  const payload = body?.payload || {};

  try {
    if (!eventType) return;
    switch (eventType) {
      case 'BOOKING_CREATED':
        await handleBookingCreated(payload);
        break;
      case 'BOOKING_RESCHEDULED':
        await handleBookingRescheduled(payload);
        break;
      case 'BOOKING_CANCELLED':
      case 'BOOKING_CANCELED':
        await handleBookingCancelled(payload);
        break;
      default:
        logger.info({ eventType }, 'cal.com: unhandled event type');
    }
  } catch (e) {
    logger.error({ err: e.message, eventType }, 'cal.com process error');
  }
  if (webhookRowId) {
    try {
      await db().from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', webhookRowId);
    } catch (e) {
      logger.warn({ err: e.message }, 'cal.com: marking webhook_events processed failed');
    }
  }
}

async function handleBookingCreated(payload) {
  const ws = await getDefaultWorkspace();

  const attendee = (payload.attendees && payload.attendees[0]) || {};
  const email = attendee.email || payload.responses?.email || null;
  const name = attendee.name || payload.responses?.name || null;
  const phone = pickPhone(payload, attendee);

  const startsAt = payload.startTime;
  const endsAt = payload.endTime || null;
  const title = payload.title || payload.eventTitle || payload.type || 'Cal.com call';
  const externalId = String(payload.uid || payload.bookingId || payload.id || '');
  const { joinUrl, location } = pickLocation(payload);

  if (!startsAt) {
    logger.warn({ payload }, 'cal.com: BOOKING_CREATED has no startTime, skipping');
    return;
  }
  if (!externalId) {
    logger.warn({ payload }, 'cal.com: BOOKING_CREATED has no uid/bookingId, skipping');
    return;
  }

  const { contact } = await matchContact(ws.id, {
    email, phone, display_name: name,
  });
  await tagsSvc.addToContact(contact.id, 'booked-call', 'cal_com_webhook').catch((e) =>
    logger.warn({ err: e.message }, 'tag booked-call failed'));

  const appt = await appointments.create({
    workspaceId: ws.id,
    contactId: contact.id,
    source: 'calendly',           // schema enum currently has only calendly/wix/manual/other
    externalId: `cal_com:${externalId}`,
    startsAt,
    endsAt,
    title,
    location,
    joinUrl,
    metadata: {
      cal_com_uid: payload.uid || null,
      cal_com_booking_id: payload.bookingId || payload.id || null,
      cal_com_attendee_timezone: attendee.timeZone || null,
      cal_com_event_type_id: payload.eventTypeId || null,
    },
  });

  // Slice 2: forward to fm-coach so the dashboard can show "Upcoming bookings".
  forwardBookingToFmCoach({
    type: 'booking_created',
    payload,
    appointmentId: appt?.id,
  }).catch((err) =>
    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_created)'),
  );
}

async function handleBookingRescheduled(payload) {
  const ws = await getDefaultWorkspace();
  const newUid = String(payload.uid || payload.bookingId || payload.id || '');
  const oldUid = String(payload.rescheduleUid || payload.fromUid || '');
  const startsAt = payload.startTime;
  if (!startsAt) return;

  // Find existing appointment by either old or new external_id.
  let row = null;
  for (const candidate of [oldUid, newUid].filter(Boolean)) {
    const { data } = await db().from('appointments').select('id')
      .eq('workspace_id', ws.id).eq('source', 'calendly')
      .eq('external_id', `cal_com:${candidate}`).maybeSingle();
    if (data) { row = data; break; }
  }
  if (!row) {
    // No prior appointment found — treat as a create.
    return handleBookingCreated(payload);
  }
  await appointments.update(row.id, {
    starts_at: startsAt,
    ends_at: payload.endTime || null,
    status: 'rescheduled',
    external_id: newUid ? `cal_com:${newUid}` : undefined,
  });

  forwardBookingToFmCoach({
    type: 'booking_rescheduled',
    payload,
    appointmentId: row.id,
  }).catch((err) =>
    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_rescheduled)'),
  );
}

async function handleBookingCancelled(payload) {
  const ws = await getDefaultWorkspace();
  const uid = String(payload.uid || payload.bookingId || payload.id || '');
  if (!uid) return;
  const { data: appt } = await db().from('appointments').select('id')
    .eq('workspace_id', ws.id).eq('source', 'calendly')
    .eq('external_id', `cal_com:${uid}`).maybeSingle();
  if (!appt) return;
  const reason = payload.cancellationReason || payload.cancellationReasons?.[0] || null;
  await appointments.cancel(appt.id, reason);

  forwardBookingToFmCoach({
    type: 'booking_cancelled',
    payload,
    appointmentId: appt.id,
  }).catch((err) =>
    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_cancelled)'),
  );
}

function pickPhone(payload, attendee) {
  // Direct fields commonly seen on Cal.com payloads.
  if (attendee?.phone) return attendee.phone;
  if (attendee?.phoneNumber) return attendee.phoneNumber;
  if (attendee?.smsReminderNumber) return attendee.smsReminderNumber;
  if (payload?.smsReminderNumber) return payload.smsReminderNumber;
  // Custom responses (Q&A on the booking form).
  const responses = payload.responses || {};
  for (const key of ['phone', 'phoneNumber', 'mobile', 'whatsapp', 'whatsappNumber']) {
    if (responses[key]) return typeof responses[key] === 'string'
      ? responses[key]
      : responses[key]?.value || null;
  }
  return null;
}

function pickLocation(payload) {
  // Cal.com `location` can be a string or an object depending on integration.
  const loc = payload.location;
  if (!loc) {
    return { location: null, joinUrl: payload.meetingUrl || null };
  }
  if (typeof loc === 'string') {
    const isUrl = /^https?:\/\//i.test(loc);
    return isUrl
      ? { location: 'video', joinUrl: loc }
      : { location: loc, joinUrl: payload.meetingUrl || null };
  }
  if (typeof loc === 'object') {
    return {
      location: loc.type || loc.name || null,
      joinUrl: loc.link || loc.url || loc.address || payload.meetingUrl || null,
    };
  }
  return { location: null, joinUrl: null };
}

function verifyCalComSignature(rawBody, header, secret) {
  if (!header) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(header, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
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

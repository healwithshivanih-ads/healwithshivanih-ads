// Calendly webhook handler.
//
// Always: persist raw → 200 fast → process async.
// Optional signature verification via CALENDLY_SIGNING_SECRET env.
// Header format: "Calendly-Webhook-Signature: t=<unix>,v1=<hex-sha256>".

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

export const calendlyWebhook = Router();
calendlyWebhook.use(express.json({ limit: '2mb' }));

calendlyWebhook.post('/', async (req, res) => {
  const body = req.body || {};
  const headers = scrubHeaders(req.headers);
  const eventType = body.event || body.event_type || null;

  let signatureValid = null;
  const secret = process.env.CALENDLY_SIGNING_SECRET || '';
  if (secret) {
    signatureValid = verifyCalendlySignature(
      JSON.stringify(body),
      req.header('Calendly-Webhook-Signature') || '',
      secret,
    );
  }

  // Persist before doing anything.
  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'calendly',
      event_type: eventType,
      signature_valid: signatureValid,
      payload: body,
      headers,
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert (calendly) failed');
  }

  if (secret && signatureValid === false) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  res.sendStatus(200);

  processCalendly(body, webhookRowId).catch((err) =>
    logger.error({ err: err.message, stack: err.stack }, 'calendly process failed'));
});

async function processCalendly(body, webhookRowId) {
  const eventType = body?.event || body?.event_type || null;
  const payload = body?.payload || body;

  try {
    if (!eventType) return;
    if (eventType === 'invitee.created') await handleInviteeCreated(payload);
    else if (eventType === 'invitee.canceled' || eventType === 'invitee.cancelled') {
      await handleInviteeCancelled(payload);
    } else {
      logger.info({ eventType }, 'calendly: unhandled event type');
    }
  } catch (e) {
    logger.error({ err: e.message, eventType }, 'calendly process error');
  }
  if (webhookRowId) {
    await db().from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', webhookRowId)
      .catch(() => {});
  }
}

async function handleInviteeCreated(payload) {
  const ws = await getDefaultWorkspace();

  const inviteeUri = payload?.uri || payload?.invitee?.uri;
  const eventUri = payload?.event || payload?.scheduled_event?.uri || payload?.event_uri;
  const externalId = payload?.uri || inviteeUri || eventUri;
  const email = payload?.email || payload?.invitee?.email || null;
  const name = payload?.name || payload?.invitee?.name || null;

  // Calendly puts phone numbers in `questions_and_answers` or `text_reminder_number`.
  const phone = pickPhone(payload);

  const event = payload?.scheduled_event || payload?.event_payload || payload;
  const startsAt = event?.start_time || payload?.start_time || payload?.scheduled_event?.start_time;
  const endsAt = event?.end_time || payload?.end_time || null;
  const title = event?.name || payload?.event_type?.name || 'Calendly call';
  const joinUrl = event?.location?.join_url || event?.location?.location || null;
  const location = typeof event?.location === 'string' ? event.location
    : (event?.location?.type || null);

  if (!startsAt) {
    logger.warn({ payload }, 'calendly: invitee.created has no start_time, skipping');
    return;
  }

  const { contact } = await matchContact(ws.id, {
    email, phone, display_name: name,
  });
  await tagsSvc.addToContact(contact.id, 'booked-call', 'calendly_webhook').catch((e) =>
    logger.warn({ err: e.message }, 'tag booked-call failed'));

  await appointments.create({
    workspaceId: ws.id,
    contactId: contact.id,
    source: 'calendly',
    externalId,
    startsAt,
    endsAt,
    title,
    location,
    joinUrl,
    metadata: {
      calendly_invitee_uri: inviteeUri,
      calendly_event_uri: eventUri,
    },
  });
}

async function handleInviteeCancelled(payload) {
  const ws = await getDefaultWorkspace();
  const externalId = payload?.uri || payload?.invitee?.uri || payload?.event;
  if (!externalId) return;
  // find appointment
  const { data: appt } = await db().from('appointments').select('id')
    .eq('workspace_id', ws.id).eq('source', 'calendly').eq('external_id', externalId).maybeSingle();
  if (!appt) return;
  const reason = payload?.cancellation?.reason || payload?.reason || null;
  await appointments.cancel(appt.id, reason);
}

function pickPhone(payload) {
  // Direct fields
  if (payload?.phone) return payload.phone;
  if (payload?.text_reminder_number) return payload.text_reminder_number;
  if (payload?.invitee?.text_reminder_number) return payload.invitee.text_reminder_number;
  // Q&A array
  const qa = payload?.questions_and_answers || payload?.invitee?.questions_and_answers || [];
  for (const q of qa) {
    const text = String(q?.question || '').toLowerCase();
    if (text.includes('phone') || text.includes('whatsapp') || text.includes('mobile')) {
      return q.answer || null;
    }
  }
  return null;
}

function verifyCalendlySignature(rawBody, header, secret) {
  if (!header) return false;
  // header: "t=1700000000,v1=hex"
  const parts = String(header).split(',').map((s) => s.trim());
  const tPart = parts.find((p) => p.startsWith('t='));
  const vPart = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !vPart) return false;
  const t = tPart.slice(2);
  const sig = vPart.slice(3);
  const signed = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
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

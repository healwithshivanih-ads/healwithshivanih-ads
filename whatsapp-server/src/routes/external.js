import { Router } from 'express';
import express from 'express';
import { logger } from '../logger.js';
import { db } from '../db.js';
import { config } from '../config.js';
import { rawJson, parseRawJson } from '../middleware/rawBody.js';
import { verifyCalendlySignature } from '../whatsapp/signature.js';
import { upsertContact, addTag } from '../services/contacts.js';
import { createAppointment, cancelAppointment } from '../services/appointments.js';

export const externalRouter = Router();

// helper — persist incoming external webhook payload
async function record(source, eventType, payload, signatureValid = true) {
  try {
    const { data } = await db()
      .from('webhook_events')
      .insert({ source, event_type: eventType, payload, signature_valid: signatureValid, processed: false })
      .select('id')
      .single();
    return data?.id || null;
  } catch (e) {
    logger.warn({ err: e.message }, 'webhook_events insert failed');
    return null;
  }
}

async function markProcessed(id, error = null) {
  if (!id) return;
  try {
    await db()
      .from('webhook_events')
      .update({ processed: !error, error: error ? { message: error.message } : null })
      .eq('id', id);
  } catch {
    /* ignore */
  }
}

function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length ? digits : null;
}

// ---------------- Calendly ------------------------------------------------
// Body shape: { event: 'invitee.created'|'invitee.canceled', payload: { ... } }
externalRouter.post('/calendly', rawJson, parseRawJson, async (req, res) => {
  const signature = req.header('calendly-webhook-signature') || '';
  const valid = verifyCalendlySignature(req.rawBody.toString('utf8'), signature, config.calendly.signingSecret);
  res.sendStatus(200);
  const id = await record('calendly', req.body?.event, req.body, valid);
  if (!valid) {
    logger.warn('rejecting calendly webhook — invalid signature');
    return;
  }
  try {
    const event = req.body?.event;
    const p = req.body?.payload || {};
    const invitee = p.invitee || p; // Calendly payload shape varies
    const scheduled = p.scheduled_event || p.event || {};
    const phone = normalisePhone(invitee?.text_reminder_number || invitee?.phone || invitee?.questions_and_answers?.find?.((q) => /phone|mobile/i.test(q.question || ''))?.answer);
    const name = invitee?.name || null;
    const email = invitee?.email || null;
    if (!phone) {
      logger.warn({ event }, 'calendly event without phone — skipping');
      return markProcessed(id);
    }
    const contact = await upsertContact({
      waId: phone,
      phone: `+${phone}`,
      name,
      source: 'booking',
      metadata: email ? { email } : {},
    });

    if (event === 'invitee.created') {
      const externalId = invitee?.uri || invitee?.uuid || p.uuid;
      const startsAt = scheduled?.start_time || p.event_start_time;
      const endsAt = scheduled?.end_time || p.event_end_time || null;
      const title = scheduled?.name || p.event_type || 'Calendly call';
      const joinUrl = scheduled?.location?.join_url || null;
      if (!startsAt) {
        logger.warn('calendly invitee.created without start_time');
        return markProcessed(id);
      }
      await createAppointment({
        contactId: contact.id,
        externalId,
        source: 'calendly',
        startsAt,
        endsAt,
        title,
        joinUrl,
      });
      await addTag(contact.id, 'booked-call');
    } else if (event === 'invitee.canceled') {
      const externalId = invitee?.uri || invitee?.uuid || p.uuid;
      await cancelAppointment({ source: 'calendly', externalId });
    }
    await markProcessed(id);
  } catch (e) {
    logger.error({ err: e.message }, 'calendly handler failed');
    await markProcessed(id, e);
  }
});

// ---------------- Wix Booking --------------------------------------------
externalRouter.post('/wix-booking', express.json(), async (req, res) => {
  res.sendStatus(200);
  const id = await record('wix', req.body?.eventType || 'booking', req.body, true);
  try {
    const b = req.body || {};
    const phone = normalisePhone(b.phone || b.contact?.phone || b.booking?.formInfo?.phone);
    const name = b.name || b.contact?.name || null;
    const startsAt = b.startsAt || b.booking?.startTime || b.start;
    const title = b.title || b.serviceName || 'Wix booking';
    const externalId = b.id || b.bookingId;
    if (!phone || !startsAt) {
      logger.warn('wix-booking missing phone or startsAt');
      return markProcessed(id);
    }
    const contact = await upsertContact({ waId: phone, phone: `+${phone}`, name, source: 'booking' });
    await createAppointment({
      contactId: contact.id,
      externalId,
      source: 'wix',
      startsAt,
      title,
    });
    await addTag(contact.id, 'booked-call');
    await markProcessed(id);
  } catch (e) {
    logger.error({ err: e.message }, 'wix-booking handler failed');
    await markProcessed(id, e);
  }
});

// ---------------- Meta Click-to-WhatsApp Ad lead -------------------------
externalRouter.post('/meta-ad', express.json(), async (req, res) => {
  res.sendStatus(200);
  const id = await record('meta_ad', 'lead', req.body, true);
  try {
    const b = req.body || {};
    const phone = normalisePhone(b.phone_number || b.phone || b.wa_id);
    const name = b.full_name || b.name || null;
    const campaign = String(b.campaign_name || b.ad_name || '').toLowerCase();
    if (!phone) {
      logger.warn('meta-ad lead missing phone');
      return markProcessed(id);
    }
    const contact = await upsertContact({
      waId: phone,
      phone: `+${phone}`,
      name,
      source: 'meta_ad',
      metadata: { campaign },
    });
    await addTag(contact.id, 'health-coaching-lead');
    if (campaign.includes('cortisol')) {
      await addTag(contact.id, 'cortisol-belly-lead');
    }
    await markProcessed(id);
  } catch (e) {
    logger.error({ err: e.message }, 'meta-ad handler failed');
    await markProcessed(id, e);
  }
});

// ---------------- Generic form intake ------------------------------------
// Body: { phone, name?, tags?: string[], source?: 'website'|'form'|... }
externalRouter.post('/form', express.json(), async (req, res) => {
  res.sendStatus(200);
  const id = await record('form', 'submission', req.body, true);
  try {
    const b = req.body || {};
    const phone = normalisePhone(b.phone);
    if (!phone) {
      logger.warn('form submission missing phone');
      return markProcessed(id);
    }
    const contact = await upsertContact({
      waId: phone,
      phone: `+${phone}`,
      name: b.name || null,
      source: b.source || 'form',
      metadata: b.metadata || {},
    });
    const tags = Array.isArray(b.tags) ? b.tags : [];
    for (const t of tags) await addTag(contact.id, String(t));
    await markProcessed(id);
  } catch (e) {
    logger.error({ err: e.message }, 'form handler failed');
    await markProcessed(id, e);
  }
});

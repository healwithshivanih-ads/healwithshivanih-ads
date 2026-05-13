import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db.js';
import { rawJson, parseRawJson } from '../middleware/rawBody.js';
import { verifyMetaSignature } from '../whatsapp/signature.js';
import { parseIncoming } from '../whatsapp/parse.js';
import { upsertContact } from '../services/contacts.js';
import { getOrCreateConversation, touchInbound } from '../services/conversations.js';
import { logInbound, markStatus } from '../services/messages.js';

export const webhookRouter = Router();

// GET /webhook — Meta hub verification handshake
webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === config.whatsapp.verifyToken) {
    logger.info('webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  logger.warn({ mode, tokenMatches: token === config.whatsapp.verifyToken }, 'webhook verify failed');
  return res.sendStatus(403);
});

// POST /webhook — Meta delivers events here. Must respond within 5s.
webhookRouter.post('/', rawJson, parseRawJson, async (req, res) => {
  const signature = req.header('x-hub-signature-256') || '';
  const valid = verifyMetaSignature(req.rawBody, signature);
  // Always ack quickly; log the event regardless.
  res.sendStatus(200);

  // Fire-and-forget processing
  processMetaWebhook(req.body, valid).catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'webhook processing failed');
  });
});

async function processMetaWebhook(body, signatureValid) {
  // Persist the raw event first
  let webhookRowId = null;
  try {
    const { data } = await db()
      .from('webhook_events')
      .insert({
        source: 'meta',
        event_type: body?.entry?.[0]?.changes?.[0]?.field || null,
        payload: body,
        signature_valid: signatureValid,
        processed: false,
      })
      .select('id')
      .single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.warn({ err: e.message }, 'webhook_events insert failed');
  }

  if (!signatureValid) {
    logger.warn('rejecting meta webhook — invalid signature');
    return;
  }

  const events = parseIncoming(body);
  for (const ev of events) {
    try {
      if (ev.kind === 'message') {
        const contact = await upsertContact({
          waId: ev.wa_id,
          phone: `+${ev.wa_id}`,
          name: ev.name,
          source: 'whatsapp',
        });
        const conv = await getOrCreateConversation(contact.id);
        await logInbound({
          conversationId: conv.id,
          contactId: contact.id,
          waMessageId: ev.wa_message_id,
          type: ev.type,
          body: ev.body,
          payload: ev.payload,
        });
        await touchInbound(conv.id, ev.timestamp);
        logger.info(
          { waId: ev.wa_id, type: ev.type, body: ev.body?.slice?.(0, 80) },
          'inbound message',
        );
      } else if (ev.kind === 'status') {
        await markStatus({
          waMessageId: ev.wa_message_id,
          status: ev.status,
          errors: ev.errors,
        });
      }
    } catch (e) {
      logger.error({ err: e.message, ev: ev.kind }, 'event handler failed');
    }
  }

  if (webhookRowId) {
    await db()
      .from('webhook_events')
      .update({ processed: true })
      .eq('id', webhookRowId);
  }
}

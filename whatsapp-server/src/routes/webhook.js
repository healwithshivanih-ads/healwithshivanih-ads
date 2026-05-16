import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db.js';
import { rawJson, parseRawJson } from '../middleware/rawBody.js';
import { verify } from '../channels/whatsapp/signature.js';
import { parseIncoming } from '../channels/whatsapp/parse.js';
import { matchContact } from '../services/contacts/matcher.js';
import { getOrCreate } from '../services/conversations/index.js';
import { logInbound, updateStatus } from '../services/messages/index.js';
import { getDefault as getDefaultWorkspace } from '../services/workspaces.js';
import { forwardInbound } from '../services/forwarder/index.js';
import { publish, EVENTS } from '../services/events/index.js';
import { handleFlowCompletion } from '../services/flow-completion/index.js';

export const webhookRouter = Router();

// Meta verification handshake
webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === config.whatsapp.verifyToken) {
    logger.info('webhook verification ok');
    return res.status(200).send(String(challenge ?? ''));
  }
  logger.warn({ mode, tokenMatches: token === config.whatsapp.verifyToken }, 'webhook verify failed');
  return res.sendStatus(403);
});

// Inbound events. Signature validated against raw body. Always 200 on valid
// signature; invalid signature → 401 (still logged to webhook_events).
webhookRouter.post('/', rawJson, parseRawJson, async (req, res) => {
  const signature = req.header('x-hub-signature-256') || '';
  const valid = verify(req.rawBody, signature, config.whatsapp.appSecret);
  const body = req.body || {};

  // Always persist the raw event before doing anything else.
  let webhookRowId = null;
  try {
    const ws = await getDefaultWorkspace().catch(() => null);
    const { data } = await db().from('webhook_events').insert({
      workspace_id: ws?.id || null,
      source: 'meta_whatsapp',
      event_type: body?.entry?.[0]?.changes?.[0]?.field || null,
      signature_valid: valid,
      payload: body,
      headers: scrubHeaders(req.headers),
      processed: false,
    }).select('id').single();
    webhookRowId = data?.id || null;
  } catch (e) {
    logger.error({ err: e.message }, 'webhook_events insert failed');
  }

  if (!valid) {
    logger.warn('rejecting meta webhook — invalid signature');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Ack quickly; process async.
  res.sendStatus(200);
  processMetaWebhook(body, webhookRowId).catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'webhook processing failed');
  });
});

function scrubHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const kl = k.toLowerCase();
    if (kl === 'authorization' || kl === 'x-api-key') continue;
    out[k] = v;
  }
  return out;
}

async function processMetaWebhook(body, webhookRowId) {
  const ws = await getDefaultWorkspace();
  const events = parseIncoming(body);

  for (const ev of events) {
    try {
      if (ev.kind === 'message') {
        const { contact } = await matchContact(ws.id, {
          phone: ev.wa_id,
          display_name: ev.profile_name,
        });
        const conv = await getOrCreate(ws.id, contact.id, 'whatsapp');
        const message = await logInbound({
          workspaceId: ws.id,
          conversationId: conv.id,
          contactId: contact.id,
          channel: 'whatsapp',
          externalMessageId: ev.external_message_id,
          type: ev.type,
          body: ev.body,
          payload: ev.payload,
          timestamp: ev.timestamp,
        });
        logger.info(
          { wa_id: ev.wa_id, type: ev.type, body: (ev.body || '').slice(0, 80) },
          'inbound',
        );
        // Notify in-process SSE subscribers (admin Inbox, Ochre /messages
        // when proxied) so their UIs refresh instantly instead of waiting
        // for the next 10 s poll. Lightweight summary only — full message
        // is fetched by the client through the existing GET endpoints.
        publish(EVENTS.INBOUND_MESSAGE, {
          workspace_id: ws.id,
          conversation_id: conv.id,
          contact_id: contact.id,
          wa_id: ev.wa_id,
          message_id: message?.id,
          type: ev.type,
          ts: new Date().toISOString(),
        });
        // Fire-and-forget forward to FM coach webhook (no-op if not configured).
        forwardInbound({ event: ev, contact, conversation: conv, message }).catch(() => {});
        // If this is a WhatsApp Flow submission (user completed a Flow
        // attached to a CTWA ad), kick off the follow-up: build a
        // personalised LP link + send it back as a free-form message
        // inside the post-click 24h window. Fire-and-forget — failures
        // log but don't block the rest of inbound processing.
        if (ev.type === 'flow') {
          handleFlowCompletion({ event: ev, contact, conversation: conv })
            .catch((err) => logger.error({ err: err.message }, 'flow completion failed'));
        }
      } else if (ev.kind === 'status') {
        const errPayload = ev.errors ? { errors: ev.errors } : null;
        await updateStatus(ev.external_message_id, 'whatsapp', ev.status, errPayload);
        publish(EVENTS.OUTBOUND_STATUS, {
          external_message_id: ev.external_message_id,
          status: ev.status,
          ts: new Date().toISOString(),
        });
      }
    } catch (e) {
      logger.error({ err: e.message, kind: ev.kind }, 'event handler failed');
    }
  }

  if (webhookRowId) {
    try {
      await db().from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', webhookRowId);
    } catch (e) {
      logger.warn({ err: e.message }, 'webhook_events processed flag failed');
    }
  }
}

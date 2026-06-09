// THE central send/log/status function. Every outbound message — manual reply,
// AI draft (on approval), reminder, broadcast — flows through `send()`.
//
// Contract:
//   1. Insert messages row with status='queued' BEFORE any external call.
//   2. Call channel adapter; on success, flip to 'sent' + record external id.
//   3. On 5xx/network failure, retry once (the channel client retries internally
//      too; this is the second-level safety net). Hard-fail → status='failed'.
//   4. Bump conversations.last_outbound_at.
//   5. Free-text WhatsApp messages outside the 24h window throw
//      OutsideServiceWindowError BEFORE any DB write.
//
// TODO Round 2: also call ai/policies to enqueue ai_jobs row on inbound.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { OutsideServiceWindowError, ValidationError, NotFoundError } from '../../errors.js';
import { canSendFreeText } from '../conversations/service-window.js';
import { touchOutbound, touchInbound } from '../conversations/index.js';
import { forwardOutbound } from '../forwarder/index.js';
import * as wa from '../../channels/whatsapp/client.js';

const FREE_TEXT_TYPES = new Set(['text', 'interactive_button', 'interactive_list', 'order_details']);

/**
 * Send an outbound message. Returns the messages row.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.conversationId
 * @param {string} input.contactId
 * @param {'whatsapp'|'instagram'|'sms'|'email'} input.channel
 * @param {'text'|'template'|'interactive_button'|'interactive_list'} input.type
 * @param {string} [input.body]
 * @param {object} [input.payload]
 * @param {string} [input.templateName]
 * @param {string} [input.templateLanguage]
 * @param {object} [input.templateVariables]
 * @param {string} [input.origin]      e.g. 'manual','ai_draft','ai_auto','reminder','broadcast','flow','sync','api'
 * @param {string} [input.originRef]   uuid, e.g. broadcast_id, reminder_id, ai_job_id
 * @param {boolean} [input.aiGenerated]
 * @param {number}  [input.aiConfidence]
 * @param {string}  [input.aiReviewStatus]
 * @param {string}  [input.aiJobId]
 */
export async function send(input) {
  const {
    workspaceId, conversationId, contactId, channel, type,
    body, payload, templateName, templateLanguage, templateVariables,
    origin = 'manual', originRef, aiGenerated = false, aiConfidence,
    aiReviewStatus, aiJobId,
    // Which number to send AS (multi-number support). Undefined → default number.
    from,
  } = input;

  if (!workspaceId || !conversationId || !contactId) {
    throw new ValidationError('workspaceId, conversationId, contactId required');
  }
  if (channel !== 'whatsapp') {
    throw new ValidationError(`channel ${channel} not implemented in Round 1`);
  }
  if (!type) throw new ValidationError('type required');

  // Free-text 24h window guard. Templates are always allowed.
  if (type !== 'template' && FREE_TEXT_TYPES.has(type)) {
    const ok = await canSendFreeText(conversationId);
    if (!ok) throw new OutsideServiceWindowError();
  }

  // Recipient phone for the channel adapter.
  const { data: contact, error: cErr } = await db()
    .from('contacts').select('primary_phone').eq('id', contactId).maybeSingle();
  if (cErr) throw cErr;
  if (!contact?.primary_phone) throw new ValidationError('contact has no primary_phone');
  const to = contact.primary_phone;

  // 1. Pre-insert as queued.
  const { data: msgRow, error: insertErr } = await db().from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    contact_id: contactId,
    channel,
    direction: 'outbound',
    type,
    body: body ?? null,
    payload: payload ?? null,
    template_name: templateName ?? null,
    template_language: templateLanguage ?? null,
    template_variables: templateVariables ?? null,
    status: 'queued',
    ai_generated: aiGenerated,
    ai_confidence: aiConfidence ?? null,
    ai_review_status: aiReviewStatus ?? null,
    ai_job_id: aiJobId ?? null,
    origin,
    origin_ref: originRef ?? null,
  }).select().single();
  if (insertErr) {
    logger.error({ insertErr }, 'messages insert failed');
    throw insertErr;
  }
  const msgId = msgRow.id;

  // 2. Dispatch to channel client.
  let attempt = 0;
  const maxAttempts = 2; // initial + 1 retry on 5xx/network
  let lastErr;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      let res;
      if (type === 'text') {
        res = await wa.sendText({ to, body, from });
      } else if (type === 'template') {
        const components = templateVariables?.components || [];
        res = await wa.sendTemplate({
          to, templateName, languageCode: templateLanguage || 'en', components, from,
        });
      } else if (type === 'interactive_button') {
        res = await wa.sendInteractiveButtons({ to, body, buttons: payload?.buttons || [], from });
      } else if (type === 'interactive_list') {
        res = await wa.sendInteractiveList({
          to, body, button: payload?.button, sections: payload?.sections || [], from,
        });
      } else if (type === 'order_details') {
        res = await wa.sendOrderDetails({
          to,
          body,
          footer: payload?.footer,
          headerImageUrl: payload?.headerImageUrl,
          referenceId: payload?.referenceId,
          configName: payload?.configName,
          amountPaise: payload?.amountPaise,
          currency: payload?.currency || 'INR',
          item: payload?.item,
          notes: payload?.notes || {},
          from,
        });
      } else {
        throw new ValidationError(`unsupported type for whatsapp: ${type}`);
      }

      const sentAt = new Date().toISOString();
      const { data: updated, error: uErr } = await db().from('messages').update({
        status: 'sent',
        external_message_id: res.externalMessageId,
        sent_at: sentAt,
        retry_count: attempt - 1,
      }).eq('id', msgId).select().single();
      if (uErr) throw uErr;

      await touchOutbound(conversationId, sentAt).catch((e) =>
        logger.warn({ err: e.message }, 'touchOutbound failed'));

      // Mirror coach-typed admin-Inbox replies into fm-coach's chat thread.
      // ONLY origin==='manual' (a reply typed in this server's Inbox UI) —
      // fm-coach-initiated sends (origin==='api'), reminders and broadcasts
      // are already recorded by their originator, so forwarding them would
      // double up. Fire-and-forget; never blocks the send return.
      if (origin === 'manual') {
        forwardOutbound({
          message: updated,
          contact: { id: contactId, primary_phone: to },
          from,
        }).catch(() => {});
      }

      return updated;
    } catch (err) {
      lastErr = err;
      const transient = !err.status || (err.status >= 500 && err.status < 600);
      if (transient && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      // Permanent failure.
      await db().from('messages').update({
        status: 'failed',
        retry_count: attempt - 1,
        error: { message: err.message, status: err.status, body: err.body },
      }).eq('id', msgId);
      throw err;
    }
  }
  throw lastErr; // unreachable
}

/**
 * Log an inbound message. Idempotent on (workspace, channel, external_message_id).
 */
export async function logInbound({
  workspaceId, conversationId, contactId, channel, externalMessageId,
  type, body, payload, timestamp,
}) {
  const sentAt = timestamp || new Date().toISOString();
  // Avoid re-inserting if Meta retries.
  if (externalMessageId) {
    const { data: existing } = await db().from('messages')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .eq('external_message_id', externalMessageId)
      .maybeSingle();
    if (existing) return existing;
  }
  const { data, error } = await db().from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    contact_id: contactId,
    channel,
    direction: 'inbound',
    external_message_id: externalMessageId || null,
    type: type || 'text',
    body: body ?? null,
    payload: payload ?? null,
    status: 'received',
    sent_at: sentAt,
    origin: 'inbound_webhook',
  }).select().single();
  if (error) throw error;

  await touchInbound(conversationId, sentAt).catch((e) =>
    logger.warn({ err: e.message }, 'touchInbound failed'));

  // TODO Round 2: enqueue ai_jobs row here when an active ai_policy matches.
  return data;
}

/**
 * Status callback (delivery receipts).  Updates the matching outbound message.
 */
export async function updateStatus(externalMessageId, channel, status, error = null) {
  if (!externalMessageId) return null;
  const allowed = ['sent', 'delivered', 'read', 'failed'];
  if (!allowed.includes(status)) {
    logger.warn({ status }, 'updateStatus: ignoring unknown status');
    return null;
  }
  const patch = { status };
  if (error) patch.error = error;
  const { data, error: dbErr } = await db().from('messages')
    .update(patch)
    .eq('channel', channel)
    .eq('external_message_id', externalMessageId)
    .select()
    .maybeSingle();
  if (dbErr) throw dbErr;
  return data;
}

/** Paginated thread view. Newest-last (chat-style). */
export async function listForConversation(conversationId, { limit = 50, before } = {}) {
  let q = db().from('messages').select('*').eq('conversation_id', conversationId);
  if (before) q = q.lt('created_at', before);
  q = q.order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).reverse(); // chronological
}

export async function get(id) {
  const { data, error } = await db().from('messages').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('message not found');
  return data;
}

export async function listByStatus(status, { limit = 50 } = {}) {
  const { data, error } = await db().from('messages').select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

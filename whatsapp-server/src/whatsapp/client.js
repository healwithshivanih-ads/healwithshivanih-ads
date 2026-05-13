import fetch from 'node-fetch';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db.js';

const GRAPH_BASE = () => `https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/messages`;

export class OutsideServiceWindowError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'OUTSIDE_SERVICE_WINDOW';
  }
}

async function _post(payload, { retries = 1 } = {}) {
  const url = GRAPH_BASE();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (!res.ok) {
        const err = new Error(`WhatsApp API ${res.status}: ${text.slice(0, 400)}`);
        err.status = res.status;
        err.body = body;
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
      return body;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

// Insert outbound row, send, update with result. Logs everything to messages table.
async function _logAndSend({
  to, conversationId, contactId, type, body, payload, templateName,
}) {
  const supabase = db();
  // Pre-insert as queued
  const { data: msg, error: insertErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      contact_id: contactId,
      direction: 'outbound',
      type,
      body,
      payload,
      template_name: templateName,
      status: 'queued',
    })
    .select()
    .single();
  if (insertErr) {
    logger.error({ insertErr }, 'failed to insert outbound message');
  }
  const messageRowId = msg?.id;

  try {
    const apiRes = await _post(payload, { retries: 1 });
    const waId = apiRes.messages?.[0]?.id;
    if (messageRowId) {
      await supabase
        .from('messages')
        .update({ wa_message_id: waId, status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', messageRowId);
    }
    if (conversationId) {
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    }
    return { ok: true, wa_message_id: waId, messageRowId };
  } catch (err) {
    if (messageRowId) {
      await supabase
        .from('messages')
        .update({
          status: 'failed',
          error: { message: err.message, status: err.status, body: err.body },
          retry_count: 1,
        })
        .eq('id', messageRowId);
    }
    throw err;
  }
}

// 24h service window check — only allows free-form messages if last_inbound_at < 24h
async function _check24hWindow(conversationId) {
  if (!conversationId) return; // no conversation yet — likely first contact, but template-only anyway
  const { data: conv } = await db().from('conversations').select('last_inbound_at').eq('id', conversationId).maybeSingle();
  const last = conv?.last_inbound_at ? new Date(conv.last_inbound_at) : null;
  if (!last || (Date.now() - last.getTime()) > 24 * 60 * 60 * 1000) {
    throw new OutsideServiceWindowError(
      'Last inbound message older than 24h — use sendTemplate() instead.',
    );
  }
}

export async function sendText({ to, body, conversationId, contactId }) {
  await _check24hWindow(conversationId);
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  return _logAndSend({ to, conversationId, contactId, type: 'text', body, payload });
}

export async function sendTemplate({ to, templateName, languageCode = 'en', components = [], conversationId, contactId }) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };
  return _logAndSend({
    to,
    conversationId,
    contactId,
    type: 'template',
    body: `[template:${templateName}]`,
    payload,
    templateName,
  });
}

export async function sendInteractiveButtons({ to, body, buttons, conversationId, contactId }) {
  await _check24hWindow(conversationId);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  };
  return _logAndSend({ to, conversationId, contactId, type: 'interactive_button', body, payload });
}

export async function sendInteractiveList({ to, body, button, sections, conversationId, contactId }) {
  await _check24hWindow(conversationId);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button, sections },
    },
  };
  return _logAndSend({ to, conversationId, contactId, type: 'interactive_list', body, payload });
}

export async function markRead({ messageId }) {
  try {
    await _post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (e) {
    logger.warn({ err: e.message, messageId }, 'markRead failed');
  }
}

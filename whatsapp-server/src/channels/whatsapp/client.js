// Pure WhatsApp Cloud API client. NO database writes here — that's the
// messages service's job. This file only knows how to POST to Meta and parse
// the response.

import fetch from 'node-fetch';
import { config } from '../../config.js';

const graphUrl = () =>
  `https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/messages`;

class WhatsAppApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.status = status;
    this.body = body;
  }
}

async function _post(payload, { retries = 1 } = {}) {
  const url = graphUrl();
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
        const err = new WhatsAppApiError(`WhatsApp API ${res.status}`, { status: res.status, body });
        // Retry once on 5xx / network blips. Don't retry on 4xx — those are our fault.
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
      return body;
    } catch (e) {
      lastErr = e;
      // ECONNRESET / fetch errors → retry once
      if (!e.status && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

function pickExternalId(apiRes) {
  return apiRes?.messages?.[0]?.id || null;
}

export async function sendText({ to, body }) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  const res = await _post(payload);
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendTemplate({ to, templateName, languageCode = 'en', components = [] }) {
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
  const res = await _post(payload);
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendInteractiveButtons({ to, body, buttons }) {
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
          reply: { id: b.id, title: String(b.title).slice(0, 20) },
        })),
      },
    },
  };
  const res = await _post(payload);
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendInteractiveList({ to, body, button, sections }) {
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
  const res = await _post(payload);
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

/**
 * Send a published Meta WhatsApp Flow to a user as an interactive message.
 * Triggered by inbound keyword matches (services/keywords) — when someone
 * texts "40s" to the WABA number, we reply with this so the Flow opens
 * in their chat. Same Flow we attach to CTWA ads; different entry point.
 *
 * `flow_token` is a string we choose; it comes back to us on completion
 * via the inbound webhook (encrypted in response_json). Use it for
 * attribution / dedup if needed. For now we set it to the campaign slug.
 *
 * `cta` is the chat-bubble button label (<= 20 chars per Meta spec).
 */
export async function sendFlow({
  to,
  flowId,
  flowToken,
  cta = 'Open form',
  headerText,
  bodyText,
  footerText,
  initialScreen = 'WELCOME',
}) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      ...(headerText ? { header: { type: 'text', text: headerText } } : {}),
      body: { text: bodyText || 'Tap below to continue.' },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: String(cta).slice(0, 20),
          flow_action: 'navigate',
          flow_action_payload: {
            screen: initialScreen,
            data: {},
          },
        },
      },
    },
  };
  const res = await _post(payload);
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function markRead(externalMessageId) {
  await _post({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: externalMessageId,
  });
}

export { WhatsAppApiError };

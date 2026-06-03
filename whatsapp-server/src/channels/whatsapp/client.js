// Pure WhatsApp Cloud API client. NO database writes here — that's the
// messages service's job. This file only knows how to POST to Meta and parse
// the response.

import fetch from 'node-fetch';
import { config, resolveWhatsappNumber } from '../../config.js';

const graphUrl = (phoneNumberId) =>
  `https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}/messages`;

class WhatsAppApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.status = status;
    this.body = body;
  }
}

async function _post(payload, { retries = 1, from } = {}) {
  // `from` selects which number to send AS (multi-number support). Undefined →
  // the default/legacy number, so existing callers are unchanged.
  const number = resolveWhatsappNumber(from);
  const url = graphUrl(number.phoneNumberId);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${number.token}`,
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

export async function sendText({ to, body, from }) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  const res = await _post(payload, { from });
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendTemplate({ to, templateName, languageCode = 'en', components = [], from }) {
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
  const res = await _post(payload, { from });
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

/**
 * Send a freeform message with a single CTA URL button. Useful for chat
 * replies (flow completions, keyword responses) where we want a tappable
 * button instead of a bare URL the user has to long-press. `displayText`
 * is the button label (Meta caps at 20 chars).
 *
 * Header options (mutually exclusive — pass at most one):
 *   - `headerText`     plain string (≤60 chars)
 *   - `headerImageUrl` publicly reachable image URL (jpg/png, ≤5 MB)
 *   - `headerImageId`  pre-uploaded Meta media id
 *
 * Works inside the 24h customer-service window without a template.
 */
export async function sendCtaUrl({
  to,
  headerText,
  headerImageUrl,
  headerImageId,
  body,
  footerText,
  displayText,
  url,
  from,
}) {
  let header = null;
  if (headerImageId) {
    header = { type: 'image', image: { id: headerImageId } };
  } else if (headerImageUrl) {
    header = { type: 'image', image: { link: headerImageUrl } };
  } else if (headerText) {
    header = { type: 'text', text: String(headerText).slice(0, 60) };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(header ? { header } : {}),
      body: { text: body },
      ...(footerText ? { footer: { text: String(footerText).slice(0, 60) } } : {}),
      action: {
        name: 'cta_url',
        parameters: {
          display_text: String(displayText).slice(0, 20),
          url,
        },
      },
    },
  };
  const res = await _post(payload, { from });
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendInteractiveButtons({ to, body, buttons, from }) {
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
  const res = await _post(payload, { from });
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function sendInteractiveList({ to, body, button, sections, from }) {
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
  const res = await _post(payload, { from });
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
  from,
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
  const res = await _post(payload, { from });
  return { externalMessageId: pickExternalId(res), payload, raw: res };
}

export async function markRead(externalMessageId, { from } = {}) {
  await _post({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: externalMessageId,
  }, { from });
}

export { WhatsAppApiError };

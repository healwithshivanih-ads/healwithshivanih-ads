import { Router } from 'express';
import * as contactsSvc from '../../services/contacts/index.js';
import * as convSvc from '../../services/conversations/index.js';
import * as msgsSvc from '../../services/messages/index.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { normalizePhone } from '../../util/phone.js';
import { OutsideServiceWindowError, ValidationError } from '../../errors.js';

// origin_ref is a uuid column. Reject non-UUID strings (like "fm-coach")
// rather than passing them through and tripping a Postgres error per send.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sendRouter = Router();

// POST /api/send
//
// Convenience endpoint for external apps (e.g. the FM coach) that want a single
// call to send a WhatsApp message to a phone number. Internally:
//   1. Normalise phone
//   2. Find-or-create contact
//   3. Find-or-create conversation (channel='whatsapp')
//   4. Send via messages.send
//
// Body shape:
//   { phone, name?, type='template'|'text',
//     text?,                                // required for type='text'
//     templateName?, templateLanguage?='en',
//     templateParams?: string[],            // flat positional params for the BODY component
//     origin?='external_api', originRef? }
sendRouter.post('/', async (req, res, next) => {
  try {
    const {
      phone,
      name,
      type = 'template',
      text,
      templateName,
      templateLanguage = 'en',
      templateParams,
      // Optional: for templates with a URL CTA button whose URL has a
      // dynamic {{N}} suffix (e.g. webinar_invite_v1 → https://lp.theochretree.com/lp/{{1}}),
      // pass the suffix value here. We append a button component to the
      // outgoing message that fills in the URL variable.
      buttonUrlParam,
      origin = 'api',
      originRef,
      // Which number to send AS: 'marketing' (88501) | 'clients'/'default' (89765).
      // Omit → default number. Multi-number support; back-compat for existing callers.
      from,
    } = req.body || {};

    if (!phone) throw new ValidationError('phone required');
    if (!['text', 'template'].includes(type)) {
      throw new ValidationError(`type must be text or template, got ${type}`);
    }
    if (type === 'text' && !text) throw new ValidationError('text required for type=text');
    if (type === 'template' && !templateName) {
      throw new ValidationError('templateName required for type=template');
    }

    const normalised = normalizePhone(phone);
    if (!normalised) throw new ValidationError(`could not normalise phone: ${phone}`);

    const ws = await getDefaultWorkspace();

    // Upsert contact by phone. The contacts service handles dedup against
    // existing rows (by phone match) and patches display_name if newer.
    const { contact } = await contactsSvc.upsert({
      primary_phone: normalised,
      display_name: name || undefined,
      identities: [{ channel: 'whatsapp', external_id: normalised, is_primary: true }],
    });

    const conv = await convSvc.getOrCreate(ws.id, contact.id, 'whatsapp');

    const sendInput = {
      workspaceId: ws.id,
      conversationId: conv.id,
      contactId: contact.id,
      channel: 'whatsapp',
      type,
      origin,
      originRef: originRef && UUID_RE.test(originRef) ? originRef : undefined,
      from: from || undefined,
    };

    if (type === 'text') {
      sendInput.body = text;
    } else {
      sendInput.templateName = templateName;
      sendInput.templateLanguage = templateLanguage;
      // Translate the simple flat params array into the Meta component shape
      // that messages.send → wa.sendTemplate expects.
      const components = [];
      if (Array.isArray(templateParams) && templateParams.length) {
        components.push({
          type: 'body',
          parameters: templateParams.map((p) => ({ type: 'text', text: String(p) })),
        });
      }
      if (buttonUrlParam) {
        // URL button params live in their own component. `sub_type: 'url'`
        // tells Meta this fills in the URL suffix of the template's URL
        // button. `index: '0'` = first button (we only register one per
        // template; if a template ever has multiple URL buttons, add an
        // optional buttonIndex field here).
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: String(buttonUrlParam) }],
        });
      }
      if (components.length) {
        sendInput.templateVariables = { components };
      }
    }

    const sent = await msgsSvc.send(sendInput);

    return res.json({
      ok: true,
      message_id: sent.id,
      external_message_id: sent.external_message_id,
      status: sent.status,
      conversation_id: conv.id,
      contact_id: contact.id,
      phone: normalised,
    });
  } catch (e) {
    if (e instanceof OutsideServiceWindowError) {
      return res.status(409).json({
        ok: false,
        code: 'outside_service_window',
        error: e.message,
      });
    }
    if (e instanceof ValidationError) {
      return res.status(400).json({ ok: false, code: 'validation_error', error: e.message });
    }
    next(e);
  }
});

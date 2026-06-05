import { Router } from 'express';
import * as conv from '../../services/conversations/index.js';
import * as msgs from '../../services/messages/index.js';
import { canSendFreeText } from '../../services/conversations/service-window.js';
import { OutsideServiceWindowError, ValidationError } from '../../errors.js';
import { config } from '../../config.js';

export const conversationsRouter = Router();

// GET /api/conversations?status=open&limit=&offset=&search=&phoneNumberId=
//
// `phoneNumberId` filters to conversations whose received_via_phone_number_id
// matches (i.e. Inbox tab). When phoneNumberId === the default (main) number,
// legacy rows with NULL attribution are also included so pre-tabs conversations
// fall into the main tab.
conversationsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const result = await conv.list({
      status: req.query.status || undefined,
      search: req.query.search || undefined,
      phoneNumberId: req.query.phoneNumberId || undefined,
      defaultPhoneNumberId: config.whatsapp.phoneNumberId,
      limit, offset,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/conversations/inbox-tabs
// Exposes the number of conversations per tab so the UI can render counts.
// Both tabs are computed from the same query as /api/conversations.
conversationsRouter.get('/inbox-tabs', async (req, res, next) => {
  try {
    const mainId = config.whatsapp.phoneNumberId;
    const mktId = config.whatsapp.numbers?.marketing?.phoneNumberId || null;
    const [main, mkt] = await Promise.all([
      mainId ? conv.list({ phoneNumberId: mainId, defaultPhoneNumberId: mainId, limit: 1 }) : { total: 0 },
      mktId  ? conv.list({ phoneNumberId: mktId, defaultPhoneNumberId: mainId, limit: 1 }) : { total: 0 },
    ]);
    res.json({
      tabs: [
        {
          key: 'main',
          phoneNumberId: mainId,
          display_phone: '+91 89765 63971',
          verified_name: 'The Ochre Tree',
          priority: 1,
          conversation_count: main.total ?? 0,
        },
        ...(mktId ? [{
          key: 'marketing',
          phoneNumberId: mktId,
          display_phone: '+91 88501 76753',
          verified_name: 'HealwithshivaniH',
          priority: 2,
          conversation_count: mkt.total ?? 0,
        }] : []),
      ],
    });
  } catch (e) { next(e); }
});

// GET /api/conversations/:id
conversationsRouter.get('/:id', async (req, res, next) => {
  try {
    const c = await conv.get(req.params.id);
    const [messages, withinWindow] = await Promise.all([
      msgs.listForConversation(c.id, { limit: 50 }),
      canSendFreeText(c.id),
    ]);
    res.json({ ...c, messages, within_service_window: withinWindow });
  } catch (e) { next(e); }
});

// POST /api/conversations/:id/reply
//   body: { type:'text'|'template'|'interactive_button'|'interactive_list', body?,
//           templateName?, templateLanguage?, templateVariables?,
//           payload?, from? }
//   - interactive_button: payload = { buttons: [{ id, title }] }   (≤3)
//   - interactive_list:   payload = { button, sections: [...] }     (≤10 rows)
const REPLY_TYPES = ['text', 'template', 'interactive_button', 'interactive_list', 'order_details'];
conversationsRouter.post('/:id/reply', async (req, res, next) => {
  try {
    const c = await conv.get(req.params.id);
    const {
      type = 'text', body, payload, templateName, templateLanguage, templateVariables,
      // Which number to reply AS ('marketing'/'clients'/default). Omit → default.
      from,
    } = req.body || {};

    if (!REPLY_TYPES.includes(type)) {
      throw new ValidationError(`reply type must be one of ${REPLY_TYPES.join('|')}, got ${type}`);
    }
    if (type !== 'template' && !body) throw new ValidationError('body required');
    if (type === 'template' && !templateName) {
      throw new ValidationError('templateName required for template reply');
    }
    if (type === 'interactive_button' && !payload?.buttons?.length) {
      throw new ValidationError('payload.buttons required for interactive_button');
    }
    if (type === 'interactive_list' && !payload?.sections?.length) {
      throw new ValidationError('payload.sections required for interactive_list');
    }
    if (type === 'order_details') {
      if (!payload?.referenceId) throw new ValidationError('payload.referenceId required for order_details');
      if (!payload?.configName) throw new ValidationError('payload.configName required for order_details');
      if (!(payload?.amountPaise > 0)) throw new ValidationError('payload.amountPaise (>0) required for order_details');
    }

    const sent = await msgs.send({
      workspaceId: c.workspace_id,
      conversationId: c.id,
      contactId: c.contact_id,
      channel: c.channel,
      type,
      body,
      payload,
      templateName,
      templateLanguage,
      templateVariables,
      origin: 'manual',
      from: from || undefined,
    });
    res.json(sent);
  } catch (e) {
    if (e instanceof OutsideServiceWindowError) {
      return res.status(409).json({ code: 'outside_service_window', message: e.message });
    }
    next(e);
  }
});

// POST /api/conversations/:id/read
conversationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const updated = await conv.markRead(req.params.id);
    res.json(updated);
  } catch (e) { next(e); }
});

// PATCH /api/conversations/:id  body: { status?, ai_policy?, notes? }
conversationsRouter.patch('/:id', async (req, res, next) => {
  try {
    const updated = await conv.patch(req.params.id, req.body || {});
    res.json(updated);
  } catch (e) { next(e); }
});

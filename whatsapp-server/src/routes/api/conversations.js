import { Router } from 'express';
import * as conv from '../../services/conversations/index.js';
import * as msgs from '../../services/messages/index.js';
import { canSendFreeText } from '../../services/conversations/service-window.js';
import { OutsideServiceWindowError, ValidationError } from '../../errors.js';

export const conversationsRouter = Router();

// GET /api/conversations?status=open&limit=&offset=&search=
conversationsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const result = await conv.list({
      status: req.query.status || undefined,
      search: req.query.search || undefined,
      limit, offset,
    });
    res.json(result);
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
const REPLY_TYPES = ['text', 'template', 'interactive_button', 'interactive_list'];
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

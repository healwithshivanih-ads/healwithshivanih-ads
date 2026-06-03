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
//   body: { type:'text'|'template', body?, templateName?, templateLanguage?, templateVariables? }
conversationsRouter.post('/:id/reply', async (req, res, next) => {
  try {
    const c = await conv.get(req.params.id);
    const {
      type = 'text', body, templateName, templateLanguage, templateVariables,
      // Which number to reply AS ('marketing'/'clients'/default). Omit → default.
      from,
    } = req.body || {};

    if (!['text', 'template'].includes(type)) {
      throw new ValidationError(`reply type must be text or template, got ${type}`);
    }
    if (type === 'text' && !body) throw new ValidationError('body required for text reply');
    if (type === 'template' && !templateName) {
      throw new ValidationError('templateName required for template reply');
    }

    const sent = await msgs.send({
      workspaceId: c.workspace_id,
      conversationId: c.id,
      contactId: c.contact_id,
      channel: c.channel,
      type,
      body,
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

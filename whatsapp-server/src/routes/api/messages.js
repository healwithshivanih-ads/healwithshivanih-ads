import { Router } from 'express';
import * as msgs from '../../services/messages/index.js';

export const messagesRouter = Router();

// GET /api/messages?status=draft&limit=
// Round 1: only used for surfacing AI drafts in a future session — keep
// available for convenience.
messagesRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const status = req.query.status;
    if (!status) return res.json({ items: [] });
    const items = await msgs.listByStatus(status, { limit });
    res.json({ items });
  } catch (e) { next(e); }
});

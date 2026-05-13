import { Router } from 'express';
import * as tags from '../../services/contacts/tags.js';

export const tagsRouter = Router();

// GET /api/tags
tagsRouter.get('/', async (_req, res, next) => {
  try {
    const list = await tags.list({ withCounts: true });
    res.json({ items: list });
  } catch (e) { next(e); }
});

// POST /api/tags  body: { name, color?, description? }
tagsRouter.post('/', async (req, res, next) => {
  try {
    const { name, color, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const tag = await tags.ensure(name, { color, description });
    res.status(201).json(tag);
  } catch (e) { next(e); }
});

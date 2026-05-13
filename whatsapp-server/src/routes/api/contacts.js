import { Router } from 'express';
import * as contacts from '../../services/contacts/index.js';
import * as identities from '../../services/contacts/identities.js';
import * as tags from '../../services/contacts/tags.js';
import * as conversations from '../../services/conversations/index.js';
import { db } from '../../db.js';

export const contactsRouter = Router();

// GET /api/contacts?search=&tag=&limit=&offset=
contactsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const result = await contacts.search({
      query: req.query.search || undefined,
      tag: req.query.tag || undefined,
      limit,
      offset,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/contacts/:id
contactsRouter.get('/:id', async (req, res, next) => {
  try {
    const c = await contacts.get(req.params.id);
    const [ids, tagList, convList] = await Promise.all([
      identities.listForContact(c.id),
      tags.listForContact(c.id),
      db().from('conversations').select('id, channel, status, last_inbound_at, unread_count')
        .eq('contact_id', c.id)
        .order('last_inbound_at', { ascending: false, nullsFirst: false })
        .limit(10),
    ]);
    res.json({
      ...c,
      identities: ids,
      tags: tagList,
      conversations: convList.data || [],
    });
  } catch (e) { next(e); }
});

// POST /api/contacts — create (or upsert via matcher)
contactsRouter.post('/', async (req, res, next) => {
  try {
    const result = await contacts.upsert(req.body || {});
    res.status(result.created ? 201 : 200).json(result);
  } catch (e) { next(e); }
});

// PATCH /api/contacts/:id — partial update
contactsRouter.patch('/:id', async (req, res, next) => {
  try {
    const c = await contacts.patch(req.params.id, req.body || {});
    res.json(c);
  } catch (e) { next(e); }
});

// DELETE /api/contacts/:id — soft delete
contactsRouter.delete('/:id', async (req, res, next) => {
  try {
    const c = await contacts.softDelete(req.params.id);
    res.json({ ok: true, id: c.id });
  } catch (e) { next(e); }
});

// POST /api/contacts/:id/tags  body: { name }
contactsRouter.post('/:id/tags', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const tag = await tags.addToContact(req.params.id, name, 'admin');
    res.json(tag);
  } catch (e) { next(e); }
});

// DELETE /api/contacts/:id/tags/:name
contactsRouter.delete('/:id/tags/:name', async (req, res, next) => {
  try {
    await tags.removeFromContact(req.params.id, decodeURIComponent(req.params.name));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

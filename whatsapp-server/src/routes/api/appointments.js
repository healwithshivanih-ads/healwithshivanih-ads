import { Router } from 'express';
import * as appointments from '../../services/appointments/index.js';
import * as reminders from '../../services/reminders/index.js';
import { ValidationError } from '../../errors.js';

export const appointmentsRouter = Router();

// GET /api/appointments?contactId=&status=&from=&to=&limit=&offset=
appointmentsRouter.get('/', async (req, res, next) => {
  try {
    const result = await appointments.list({
      contactId: req.query.contactId,
      status: req.query.status,
      fromDate: req.query.from,
      toDate: req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/appointments/:id  →  appointment + reminders
appointmentsRouter.get('/:id', async (req, res, next) => {
  try {
    const a = await appointments.get(req.params.id);
    const rems = await reminders.listForAppointment(a.id);
    res.json({ ...a, reminders: rems });
  } catch (e) { next(e); }
});

// POST /api/appointments  body: { contactId, startsAt, endsAt?, title?, notes?, location?, joinUrl? }
appointmentsRouter.post('/', async (req, res, next) => {
  try {
    const { contactId, startsAt, endsAt, title, notes, location, joinUrl, source, externalId } = req.body || {};
    if (!contactId) throw new ValidationError('contactId required');
    if (!startsAt) throw new ValidationError('startsAt required');
    const a = await appointments.create({
      contactId, startsAt, endsAt, title, notes, location, joinUrl,
      source: source || 'manual',
      externalId: externalId || undefined,
    });
    res.status(201).json(a);
  } catch (e) { next(e); }
});

// PATCH /api/appointments/:id
appointmentsRouter.patch('/:id', async (req, res, next) => {
  try {
    const a = await appointments.update(req.params.id, req.body || {});
    res.json(a);
  } catch (e) { next(e); }
});

// DELETE /api/appointments/:id?reason=...   (cancel = soft)
appointmentsRouter.delete('/:id', async (req, res, next) => {
  try {
    const a = await appointments.cancel(req.params.id, req.query.reason || req.body?.reason || null);
    res.json({ ok: true, appointment: a });
  } catch (e) { next(e); }
});

// Appointments service.
//
// Owns appointment CRUD + reminder scheduling side-effects. Source-aware
// de-dupe via the unique (workspace_id, source, external_id) constraint.
//
// On create:   schedules 4 reminders.
// On update:   if starts_at changed → reschedules the pending reminders.
// On cancel:   marks status='cancelled' + skips all pending reminders.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import { getDefault as getDefaultWorkspace } from '../workspaces.js';
import * as reminders from '../reminders/index.js';

const VALID_SOURCES = new Set(['calendly', 'wix', 'manual', 'other']);
const VALID_STATUSES = new Set([
  'scheduled', 'rescheduled', 'cancelled', 'completed', 'no_show',
]);

async function workspaceId(passed) {
  if (passed) return passed;
  const w = await getDefaultWorkspace();
  return w.id;
}

/**
 * Create (or de-dupe) an appointment + schedule its reminders.
 *
 * @param {object} input
 * @param {string} [input.workspaceId]
 * @param {string} input.contactId
 * @param {string} input.source              calendly|wix|manual|other
 * @param {string} [input.externalId]        for de-dupe within a source
 * @param {string} input.startsAt            ISO timestamp
 * @param {string} [input.endsAt]
 * @param {string} [input.title]
 * @param {string} [input.notes]
 * @param {string} [input.location]
 * @param {string} [input.joinUrl]
 * @param {object} [input.metadata]
 * @returns {Promise<object>} the appointment row
 */
export async function create(input) {
  const wsId = await workspaceId(input.workspaceId);
  const {
    contactId, source, externalId, startsAt, endsAt,
    title, notes, location, joinUrl, metadata,
    // Drives reminder kind selection in services/reminders.
    // Values: 'in_person' | 'distance' | 'zoom' | null (legacy fallback).
    classification,
  } = input;

  if (!contactId) throw new ValidationError('contactId required');
  if (!source || !VALID_SOURCES.has(source)) {
    throw new ValidationError(`source must be one of: ${[...VALID_SOURCES].join(',')}`);
  }
  if (!startsAt) throw new ValidationError('startsAt required');

  // De-dupe by (workspace, source, external_id) when external_id is set.
  if (externalId) {
    const existing = await findByExternal(wsId, source, externalId);
    if (existing) {
      // Patch whatever changed; reschedule reminders if startsAt shifted.
      const patch = stripUndef({
        starts_at: startsAt,
        ends_at: endsAt,
        title, notes, location,
        join_url: joinUrl,
        metadata,
      });
      const startsChanged = patch.starts_at && patch.starts_at !== existing.starts_at;
      const updated = Object.keys(patch).length
        ? await updateRow(existing.id, { ...patch, status: existing.status === 'cancelled' ? 'scheduled' : (startsChanged ? 'rescheduled' : existing.status) })
        : existing;
      if (startsChanged) {
        await reminders.rescheduleForAppointment(updated).catch((e) =>
          logger.warn({ err: e.message, appt: updated.id }, 'reschedule reminders failed'));
      }
      return updated;
    }
  }

  // Stash classification on metadata until a top-level column lands.
  // services/reminders.kindsFor() reads both places.
  const mergedMeta = { ...(metadata || {}) };
  if (classification) mergedMeta.classification = classification;

  const row = stripUndef({
    workspace_id: wsId,
    contact_id: contactId,
    source,
    external_id: externalId || null,
    starts_at: startsAt,
    ends_at: endsAt || null,
    title: title || null,
    notes: notes || null,
    location: location || null,
    join_url: joinUrl || null,
    metadata: mergedMeta,
    status: 'scheduled',
  });

  const { data, error } = await db().from('appointments').insert(row).select().single();
  if (error) {
    // Race: someone else inserted the same (workspace, source, external_id).
    if (externalId && error.code === '23505') {
      const existing = await findByExternal(wsId, source, externalId);
      if (existing) return existing;
    }
    throw error;
  }

  await reminders.scheduleForAppointment(data).catch((e) =>
    logger.warn({ err: e.message, appt: data.id }, 'schedule reminders failed'));

  return data;
}

/** Patch an appointment. If startsAt changes, reschedule reminders. */
export async function update(id, patch) {
  const current = await get(id);

  const clean = stripUndef({
    starts_at: patch.startsAt,
    ends_at: patch.endsAt,
    title: patch.title,
    notes: patch.notes,
    location: patch.location,
    join_url: patch.joinUrl,
    metadata: patch.metadata,
    status: patch.status,
  });

  if (clean.status && !VALID_STATUSES.has(clean.status)) {
    throw new ValidationError(`bad status: ${clean.status}`);
  }

  const startsChanged = clean.starts_at && clean.starts_at !== current.starts_at;
  if (startsChanged && !clean.status) clean.status = 'rescheduled';

  if (!Object.keys(clean).length) return current;

  const updated = await updateRow(id, clean);
  if (startsChanged) {
    await reminders.rescheduleForAppointment(updated).catch((e) =>
      logger.warn({ err: e.message, appt: id }, 'reschedule reminders failed'));
  }
  return updated;
}

/** Cancel an appointment. Skips all pending reminders. */
export async function cancel(id, reason) {
  const current = await get(id);
  if (current.status === 'cancelled') return current;

  const meta = { ...(current.metadata || {}) };
  if (reason) meta.cancel_reason = reason;

  const updated = await updateRow(id, { status: 'cancelled', metadata: meta });
  await reminders.skipAllPending(id, reason || 'appointment_cancelled').catch((e) =>
    logger.warn({ err: e.message, appt: id }, 'skip reminders failed'));
  return updated;
}

export async function get(id) {
  const { data, error } = await db().from('appointments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('appointment not found');
  return data;
}

/**
 * @param {object} q
 * @param {string} [q.contactId]
 * @param {string} [q.status]
 * @param {string} [q.fromDate]   ISO; starts_at >= fromDate
 * @param {string} [q.toDate]     ISO; starts_at <  toDate
 * @param {number} [q.limit=50]
 * @param {number} [q.offset=0]
 */
export async function list(q = {}) {
  const wsId = await workspaceId(q.workspaceId);
  const limit = Math.min(parseInt(q.limit || 50, 10), 200);
  const offset = parseInt(q.offset || 0, 10);

  let query = db().from('appointments')
    .select('*, contact:contacts(id, display_name, primary_phone, primary_email)', { count: 'exact' })
    .eq('workspace_id', wsId)
    .order('starts_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q.contactId) query = query.eq('contact_id', q.contactId);
  if (q.status) query = query.eq('status', q.status);
  if (q.fromDate) query = query.gte('starts_at', q.fromDate);
  if (q.toDate) query = query.lt('starts_at', q.toDate);

  const { data, error, count } = await query;
  if (error) throw error;
  return { items: data || [], total: count ?? 0 };
}

async function findByExternal(wsId, source, externalId) {
  const { data, error } = await db().from('appointments').select('*')
    .eq('workspace_id', wsId)
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateRow(id, patch) {
  const { data, error } = await db().from('appointments')
    .update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

function stripUndef(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

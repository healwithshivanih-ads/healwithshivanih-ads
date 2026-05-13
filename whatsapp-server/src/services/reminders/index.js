// Reminders service.
//
// 3 reminder kinds per appointment:
//   - confirmation   → scheduled_for = now() (sent immediately on create)
//   - t_minus_24h    → starts_at - 24h
//   - t_minus_2h     → starts_at - 2h
//
// Schema enforces unique(appointment_id, kind) so scheduleForAppointment is
// idempotent — re-running it on the same appointment doesn't double-insert.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { NotFoundError } from '../../errors.js';

const HOUR_MS = 3_600_000;

export const REMINDER_KINDS = ['confirmation', 't_minus_24h', 't_minus_2h'];

// Template names per reminder kind. Hindi variants are best-effort — if they
// don't exist in the Meta template registry the send will fail and we log it.
export const REMINDER_TEMPLATES = {
  confirmation:  'appt_confirmation',
  t_minus_24h:   'appt_reminder_24h',
  t_minus_2h:    'appt_reminder_2h',
};

/** Compute the scheduled timestamp (ms epoch) for a kind given starts_at ms. */
function scheduledMsFor(kind, startsMs, nowMs) {
  switch (kind) {
    case 'confirmation': return nowMs;
    case 't_minus_24h':  return startsMs - 24 * HOUR_MS;
    case 't_minus_2h':   return startsMs - 2 * HOUR_MS;
    default: return null;
  }
}

/** Insert the 4 reminder rows for an appointment. Idempotent. */
export async function scheduleForAppointment(appointment) {
  const startsMs = new Date(appointment.starts_at).getTime();
  const nowMs = Date.now();

  const rows = [];
  for (const kind of REMINDER_KINDS) {
    const ms = scheduledMsFor(kind, startsMs, nowMs);
    if (ms == null) continue;
    // Skip kinds whose ideal scheduled_for is in the past (e.g. booking happens
    // 1 hour before appointment → t_minus_24h is in the past, skip it).
    // Confirmation always fires (its ideal time is now).
    if (kind !== 'confirmation' && ms < nowMs - 60_000) continue;
    rows.push({
      workspace_id: appointment.workspace_id,
      appointment_id: appointment.id,
      kind,
      scheduled_for: new Date(ms).toISOString(),
      status: 'pending',
    });
  }

  if (!rows.length) return [];

  const { data, error } = await db()
    .from('reminders')
    .upsert(rows, { onConflict: 'appointment_id,kind', ignoreDuplicates: true })
    .select();
  if (error) {
    logger.warn({ err: error.message, appt: appointment.id }, 'reminders upsert failed');
    throw error;
  }
  return data || [];
}

/**
 * Recompute scheduled_for on every non-sent reminder for this appointment.
 * If the new time is in the past (>1m) and the row is still pending,
 * mark it skipped instead.
 */
export async function rescheduleForAppointment(appointment) {
  const startsMs = new Date(appointment.starts_at).getTime();
  const nowMs = Date.now();

  const { data: existing, error } = await db().from('reminders')
    .select('*').eq('appointment_id', appointment.id);
  if (error) throw error;

  for (const r of existing || []) {
    if (r.status === 'sent') continue;
    const newMs = scheduledMsFor(r.kind, startsMs, nowMs);
    if (newMs == null) continue;
    const patch = {};
    if (newMs < nowMs - 60_000 && r.kind !== 'confirmation' && r.status === 'pending') {
      patch.status = 'skipped';
      patch.error = { reason: 'scheduled_time_in_past_after_reschedule' };
    } else {
      patch.scheduled_for = new Date(newMs).toISOString();
      // Resurrect skipped/failed back to pending if its time is now in the future.
      if ((r.status === 'skipped' || r.status === 'failed') && newMs >= nowMs - 60_000) {
        patch.status = 'pending';
        patch.error = null;
      }
    }
    if (!Object.keys(patch).length) continue;
    await db().from('reminders').update(patch).eq('id', r.id);
  }

  // Add any kind rows that are missing entirely (e.g. appointment moved
  // forward and we never created t_minus_24h because it was already past).
  const haveKinds = new Set((existing || []).map((r) => r.kind));
  const missing = REMINDER_KINDS.filter((k) => !haveKinds.has(k));
  if (missing.length) {
    await scheduleForAppointment(appointment);
  }
}

/** Mark all pending reminders for an appointment as skipped. */
export async function skipAllPending(appointmentId, reason) {
  const { data, error } = await db().from('reminders')
    .update({ status: 'skipped', error: reason ? { reason } : null })
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')
    .select();
  if (error) throw error;
  return data || [];
}

/** Pending reminders due to fire (scheduled_for <= now). Optionally workspace-scoped. */
export async function listDue(workspaceId, limit = 50) {
  let q = db().from('reminders').select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listForAppointment(appointmentId) {
  const { data, error } = await db().from('reminders').select('*')
    .eq('appointment_id', appointmentId)
    .order('scheduled_for', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  const { data, error } = await db().from('reminders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('reminder not found');
  return data;
}

/**
 * Atomic claim of a pending reminder. Returns the row if we won the race,
 * null if someone else got there first.
 */
export async function claim(id) {
  const { data, error } = await db().from('reminders')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Mark sent. */
export async function markSent(id, messageId, attempts) {
  const { data, error } = await db().from('reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      message_id: messageId,
      attempts,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Send failed. If attempts < 3, push back to pending with a 5-minute delay;
 * else status='failed'.
 */
export async function markFailedOrRetry(id, attempts, error) {
  const willRetry = attempts < 3;
  const patch = willRetry
    ? {
        status: 'pending',
        attempts,
        scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(),
        error,
      }
    : { status: 'failed', attempts, error };
  const { data, error: dbErr } = await db().from('reminders')
    .update(patch).eq('id', id).select().single();
  if (dbErr) throw dbErr;
  return data;
}

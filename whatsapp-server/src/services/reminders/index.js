// Reminders service.
//
// Reminder kinds are classification-aware. Each appointment carries a
// `classification`:
//
//   - 'in_person'   → Wix Bookings, physical clinic (Mumbai/Delhi/Dubai)
//   - 'distance'    → Wix Bookings at the "IN" location (remote energy work)
//   - 'zoom'        → Cal.com bookings (FM coaching, all virtual)
//   - (null/legacy) → fall back to the original 3-kind generic schedule
//
// Each classification has its own kind set, and each kind maps 1:1 to an
// approved Meta template. See submit-templates.js for the template bodies.
//
// Naming pattern for new kinds:
//   <when>_<classification>_<audience>
//   where:
//     when           ∈ confirmation | t_minus_24h | t_minus_1h | t_minus_5min | t_plus_5min_noshow
//     classification ∈ inperson | distance | zoom
//     audience       ∈ client | coach
//
// Schema enforces unique(appointment_id, kind) so scheduleForAppointment is
// idempotent — re-running it on the same appointment doesn't double-insert.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { NotFoundError } from '../../errors.js';

const MIN_MS  = 60_000;
const HOUR_MS = 3_600_000;

// Legacy kinds (still emitted when appointment.classification is null/unset
// so any caller that doesn't classify yet keeps working).
export const REMINDER_KINDS = ['confirmation', 't_minus_24h', 't_minus_2h'];

// Classification → kinds. Each kind is a unique (when × audience) tuple so
// the runner can derive recipient from the kind suffix.
export const KINDS_BY_CLASSIFICATION = {
  in_person: [
    'confirmation_inperson',
    't_minus_24h_inperson_client',
    't_minus_24h_inperson_coach',
    't_minus_1h_inperson_client',
  ],
  // Distance: no confirmation, no coach reminder — per Shivani 2026-05-29.
  distance: [
    't_minus_5min_distance_client',
  ],
  // Zoom: includes no-show probe at T+5min. The probe is created at booking
  // time but cancelled (status='skipped') the moment the client joins the
  // Zoom call — see services/noshow or cal-com webhook handler.
  zoom: [
    'confirmation_zoom',
    't_minus_1h_zoom_client',
    't_minus_1h_zoom_coach',
    't_plus_5min_noshow_zoom_client',
  ],
};

// Kind → Meta template name. Includes the 3 legacy kinds for backward
// compatibility plus the 9 new ones.
export const REMINDER_TEMPLATES = {
  // Legacy
  confirmation:  'appt_confirmation',
  t_minus_24h:   'appt_reminder_24h',
  t_minus_2h:    'appt_reminder_2h',
  // Wix in-person (4)
  confirmation_inperson:           'appt_confirm_inperson_client',
  t_minus_24h_inperson_client:     'appt_reminder_24h_inperson_client',
  t_minus_24h_inperson_coach:      'appt_reminder_24h_inperson_coach',
  t_minus_1h_inperson_client:      'appt_reminder_1h_inperson_client',
  // Wix distance (1)
  t_minus_5min_distance_client:    'appt_reminder_5min_distance_client',
  // Cal.com Zoom (4)
  confirmation_zoom:               'appt_confirm_zoom_client',
  t_minus_1h_zoom_client:          'appt_reminder_1h_zoom_client',
  t_minus_1h_zoom_coach:           'appt_reminder_1h_zoom_coach',
  t_plus_5min_noshow_zoom_client:  'appt_noshow_probe_client',
};

/**
 * Recipient audience for a kind — 'client' or 'coach'. Used by the runner
 * to pick which phone to send to (contact.phone vs SHIVANI_WHATSAPP).
 *
 * Convention: kinds ending in `_coach` go to Shivani; everything else
 * (including bare legacy kinds) goes to the booked client.
 */
export function audienceForKind(kind) {
  return /_coach$/.test(kind) ? 'coach' : 'client';
}

/**
 * Compute the scheduled timestamp (ms epoch) for a kind given starts_at ms.
 * Exported for dry-run / test harnesses; the scheduler is the only caller
 * in production.
 */
export function scheduledMsFor(kind, startsMs, nowMs) {
  // Confirmation kinds always fire now.
  if (kind === 'confirmation' || kind.startsWith('confirmation_')) return nowMs;
  // T-minus kinds — offset BEFORE startsAt.
  if (kind === 't_minus_24h' || kind.includes('t_minus_24h_')) return startsMs - 24 * HOUR_MS;
  if (kind === 't_minus_2h'  || kind.includes('t_minus_2h_'))  return startsMs - 2  * HOUR_MS;
  if (kind.includes('t_minus_1h_'))                            return startsMs - 1  * HOUR_MS;
  if (kind.includes('t_minus_5min_'))                          return startsMs - 5  * MIN_MS;
  // T-plus (no-show probe) — offset AFTER startsAt.
  if (kind.includes('t_plus_5min_noshow_'))                    return startsMs + 5  * MIN_MS;
  return null;
}

/**
 * Pick the kinds to schedule for an appointment. Falls back to the legacy
 * 3-kind set when classification is missing — keeps any code that hasn't
 * been updated yet emitting the old generic templates.
 */
function kindsFor(appointment) {
  // Top-level column when a `classification` column gets added later;
  // metadata.classification for now (no migration needed). Either resolves
  // to one of 'in_person' | 'distance' | 'zoom'.
  const cls = appointment?.classification || appointment?.metadata?.classification;
  if (cls && KINDS_BY_CLASSIFICATION[cls]) return KINDS_BY_CLASSIFICATION[cls];
  return REMINDER_KINDS;
}

/** Insert the reminder rows for an appointment. Idempotent. */
export async function scheduleForAppointment(appointment) {
  const startsMs = new Date(appointment.starts_at).getTime();
  const nowMs = Date.now();

  const kinds = kindsFor(appointment);
  const rows = [];
  for (const kind of kinds) {
    const ms = scheduledMsFor(kind, startsMs, nowMs);
    if (ms == null) continue;
    // Skip kinds whose ideal scheduled_for is in the past (e.g. booking happens
    // 1 hour before appointment → t_minus_24h is in the past, skip it).
    // Confirmation kinds always fire (their ideal time is now); t_plus
    // (no-show probe) is in the future relative to startsAt, so always
    // valid if startsAt is in the future.
    const isImmediate = kind === 'confirmation' || kind.startsWith('confirmation_');
    if (!isImmediate && ms < nowMs - 60_000) continue;
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
    const isImmediate = r.kind === 'confirmation' || r.kind.startsWith('confirmation_');
    const patch = {};
    if (newMs < nowMs - 60_000 && !isImmediate && r.status === 'pending') {
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
  // forward and we never created t_minus_24h because it was already past;
  // or classification changed and a new kind set applies now).
  const haveKinds = new Set((existing || []).map((r) => r.kind));
  const expectedKinds = kindsFor(appointment);
  const missing = expectedKinds.filter((k) => !haveKinds.has(k));
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

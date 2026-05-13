import { db } from '../db.js';
import { logger } from '../logger.js';

const REMINDER_KINDS = [
  { kind: 'confirmation', offsetMs: 0 }, // send immediately
  { kind: 't_minus_24h', offsetMs: -24 * 60 * 60 * 1000 },
  { kind: 't_minus_2h', offsetMs: -2 * 60 * 60 * 1000 },
  { kind: 'post_session', offsetMs: 60 * 60 * 1000 },
];

export async function createAppointment({
  contactId,
  startsAt,
  endsAt = null,
  title = null,
  source = 'manual',
  externalId = null,
  notes = null,
  location = null,
  joinUrl = null,
  metadata = {},
}) {
  const supabase = db();
  // Idempotency: if externalId+source given, try to find first
  if (externalId) {
    const { data: existing } = await supabase
      .from('appointments')
      .select('*')
      .eq('source', source)
      .eq('external_id', externalId)
      .maybeSingle();
    if (existing) return existing;
  }
  const { data: appt, error } = await supabase
    .from('appointments')
    .insert({
      contact_id: contactId,
      starts_at: startsAt,
      ends_at: endsAt,
      title,
      source,
      external_id: externalId,
      notes,
      location,
      join_url: joinUrl,
      metadata,
      status: 'scheduled',
    })
    .select()
    .single();
  if (error) throw error;

  await scheduleReminders(appt);
  return appt;
}

export async function scheduleReminders(appt) {
  const supabase = db();
  const startMs = new Date(appt.starts_at).getTime();
  const now = Date.now();
  const rows = [];
  for (const { kind, offsetMs } of REMINDER_KINDS) {
    const scheduled = new Date(startMs + offsetMs);
    // For 'confirmation' (offset 0) we send immediately regardless.
    // For others: skip if scheduled time is already in the past.
    if (kind !== 'confirmation' && scheduled.getTime() < now - 60_000) continue;
    rows.push({
      appointment_id: appt.id,
      kind,
      scheduled_for: kind === 'confirmation' ? new Date().toISOString() : scheduled.toISOString(),
      status: 'pending',
    });
  }
  if (!rows.length) return;
  // Upsert with conflict on (appointment_id, kind) — duplicate calls are no-ops
  const { error } = await supabase
    .from('reminders')
    .upsert(rows, { onConflict: 'appointment_id,kind', ignoreDuplicates: true });
  if (error) {
    logger.error({ error, apptId: appt.id }, 'scheduleReminders failed');
  }
}

export async function cancelAppointment({ source, externalId }) {
  const supabase = db();
  const { data: appt } = await supabase
    .from('appointments')
    .select('*')
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle();
  if (!appt) return null;
  await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
  // Cancel pending reminders
  await supabase
    .from('reminders')
    .update({ status: 'skipped' })
    .eq('appointment_id', appt.id)
    .eq('status', 'pending');
  return appt;
}

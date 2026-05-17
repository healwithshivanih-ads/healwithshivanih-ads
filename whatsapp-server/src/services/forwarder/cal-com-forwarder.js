// Slice 2 of the cal.com integration: after the WA server processes a
// cal.com webhook (creates/updates an appointments row, queues reminders),
// forwards a resolved booking event to fm-coach so the dashboard can show
// upcoming sessions. Fire-and-forget; failures logged but never block
// reminder scheduling.
//
// Receiver: POST <fm-coach-base>/api/cal-com-webhook
// Auth:     X-Whatsapp-Signature-256 = HMAC-SHA256(rawBody, FM_COACH_WEBHOOK_SECRET)
// (Same secret + header name as the existing inbound forwarder.)
//
// URL handling: config.fmCoachWebhook.url historically holds the FULL inbound
// webhook URL (e.g. https://.../api/whatsapp-webhook). We strip to origin
// before appending /api/cal-com-webhook so the env var can stay untouched.

import { createHmac } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { db } from '../../db.js';

const TIMEOUT_MS = 5000;
const RECEIVER_PATH = '/api/cal-com-webhook';

function fmCoachBookingUrl() {
  const raw = config.fmCoachWebhook.url;
  if (!raw) return null;
  try {
    return new URL(raw).origin + RECEIVER_PATH;
  } catch {
    // Not a valid URL — fall back to trimmed trailing slash + path. Won't
    // be correct if the env var holds a non-URL string, but matches the
    // patch's literal behaviour.
    return raw.replace(/\/$/, '') + RECEIVER_PATH;
  }
}

/**
 * @param {object} args
 * @param {'booking_created'|'booking_rescheduled'|'booking_cancelled'} args.type
 * @param {object} args.payload  cal.com payload (post-handler)
 * @param {string} [args.appointmentId]  WA server appointments.id
 */
export async function forwardBookingToFmCoach({ type, payload, appointmentId }) {
  const url = fmCoachBookingUrl();
  const secret = config.fmCoachWebhook.secret;
  if (!url) return; // forwarder disabled

  const attendee = (payload.attendees && payload.attendees[0]) || {};
  const uid = String(payload.uid || payload.bookingId || payload.id || '');
  if (!uid) {
    logger.warn({ payload }, 'cal-com forwarder: no uid, skipping');
    return;
  }

  const body = {
    type,
    booking: {
      uid,
      external_id: `cal_com:${uid}`,
      appointment_id: appointmentId || null,
      event_slug: payload.type || payload.eventTypeSlug || null,
      event_title: payload.title || payload.eventTitle || null,
      start_time: payload.startTime || null,
      end_time: payload.endTime || null,
      status:
        type === 'booking_cancelled' ? 'cancelled' :
        type === 'booking_rescheduled' ? 'rescheduled' :
        'confirmed',
      title: payload.title || null,
    },
    attendee: {
      email: attendee.email || payload.responses?.email || null,
      phone: attendee.smsReminderNumber || attendee.phoneNumber || attendee.phone || null,
      name: attendee.name || payload.responses?.name || null,
    },
  };

  const bodyStr = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const sig = createHmac('sha256', secret).update(bodyStr).digest('hex');
    headers['X-Whatsapp-Signature-256'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, uid, body: text.slice(0, 200) },
        'fm-coach booking forward returned non-2xx',
      );
      return { ok: false, status: res.status };
    }
    if (appointmentId) {
      await markForwarded(appointmentId).catch((e) =>
        logger.warn({ err: e.message, appointmentId }, 'mark fm_coach_forwarded_at failed'));
    }
    logger.info({ uid, type }, 'fm-coach booking forwarded');
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err.message, uid }, 'fm-coach booking forward failed');
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mark an appointment as successfully forwarded to fm-coach by writing a
 * timestamp into its metadata JSON. Used both by the forwarder and by the
 * replay function to dedup across retries.
 */
async function markForwarded(appointmentId) {
  // Two-step read-modify-write to preserve existing metadata keys.
  const { data: row, error: readErr } = await db()
    .from('appointments')
    .select('metadata')
    .eq('id', appointmentId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return;
  const next = {
    ...(row.metadata || {}),
    fm_coach_forwarded_at: new Date().toISOString(),
  };
  const { error: writeErr } = await db()
    .from('appointments')
    .update({ metadata: next })
    .eq('id', appointmentId);
  if (writeErr) throw writeErr;
}

/**
 * Find recent cal.com appointments that have NOT yet been forwarded to
 * fm-coach and re-fire the forwarder for each. Catches:
 *   - Bookings that landed before the forwarder code shipped
 *   - Bookings that landed while the fm-coach receiver was unreachable
 *
 * @param {object} opts
 * @param {number} [opts.sinceDays=30] only consider appointments created in last N days
 * @param {number} [opts.limit=100]    safety cap to avoid mass-fire
 * @param {boolean} [opts.dryRun=false] if true, only report what would be sent
 * @returns {Promise<{considered:number, forwarded:number, failed:number, skipped:number, items:Array}>}
 */
export async function replayUnforwardedBookings({ sinceDays = 30, limit = 100, dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  // Fetch candidates. We can't filter on `metadata->>fm_coach_forwarded_at IS NULL`
  // directly via the supabase-js builder cleanly, so pull a broader set + filter in JS.
  const { data: rows, error } = await db()
    .from('appointments')
    .select('id, external_id, title, starts_at, ends_at, status, location, join_url, metadata, contact_id, created_at')
    .eq('source', 'calendly')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const candidates = (rows || []).filter((r) => !(r.metadata?.fm_coach_forwarded_at));

  const items = [];
  let forwarded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    const uid = (row.external_id || '').startsWith('cal_com:')
      ? row.external_id.slice('cal_com:'.length)
      : (row.external_id || null);
    if (!uid) {
      skipped++;
      items.push({ id: row.id, status: 'skipped', reason: 'no uid in external_id' });
      continue;
    }

    // Reconstruct the contact lookup so we can build attendee fields.
    let contact = null;
    if (row.contact_id) {
      const { data } = await db()
        .from('contacts')
        .select('display_name, primary_phone, primary_email')
        .eq('id', row.contact_id)
        .maybeSingle();
      contact = data;
    }

    // Reconstruct a cal-com-shaped payload. The forwarder only reads a
    // narrow set of fields, so this is enough.
    const payload = {
      uid,
      title: row.title || null,
      type: null, // event_slug not stored on appointments — receiver tolerates null
      eventTitle: row.title || null,
      startTime: row.starts_at,
      endTime: row.ends_at,
      location: row.location ? { type: row.location, link: row.join_url || null } : null,
      attendees: [{
        name: contact?.display_name || null,
        email: contact?.primary_email || null,
        phone: contact?.primary_phone || null,
        timeZone: row.metadata?.cal_com_attendee_timezone || null,
      }],
      eventTypeId: row.metadata?.cal_com_event_type_id || null,
    };

    const eventType =
      row.status === 'cancelled' ? 'booking_cancelled' :
      row.status === 'rescheduled' ? 'booking_rescheduled' :
      'booking_created';

    if (dryRun) {
      items.push({ id: row.id, uid, status: 'would_send', eventType });
      continue;
    }

    // Defensive re-check immediately before send. The candidate set was
    // pulled at the top of the function; if another tick on a sibling Fly
    // machine just marked this row as forwarded, skip it here. Not a full
    // atomic claim (genuine simultaneous ticks across machines can still
    // double-POST within the same millisecond) — but cuts the common case
    // where ticks are seconds apart. Defence in depth; the fm-coach
    // receiver should also dedupe by booking.external_id.
    const { data: fresh } = await db()
      .from('appointments')
      .select('metadata')
      .eq('id', row.id)
      .maybeSingle();
    if (fresh?.metadata?.fm_coach_forwarded_at) {
      skipped++;
      items.push({ id: row.id, uid, status: 'skipped', reason: 'already forwarded by another tick' });
      continue;
    }

    const res = await forwardBookingToFmCoach({
      type: eventType,
      payload,
      appointmentId: row.id,
    });
    if (res?.ok) {
      forwarded++;
      items.push({ id: row.id, uid, status: 'forwarded' });
    } else {
      failed++;
      items.push({ id: row.id, uid, status: 'failed', error: res?.error || `HTTP ${res?.status || '?'}` });
    }
  }

  return {
    considered: rows?.length || 0,
    forwarded,
    failed,
    skipped,
    items,
  };
}

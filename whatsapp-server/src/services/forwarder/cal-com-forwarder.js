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
    } else {
      logger.info({ uid, type }, 'fm-coach booking forwarded');
    }
  } catch (err) {
    logger.warn({ err: err.message, uid }, 'fm-coach booking forward failed');
  } finally {
    clearTimeout(timer);
  }
}

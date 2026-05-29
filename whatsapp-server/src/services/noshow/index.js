// No-show probe reply handler.
//
// When a client receives the `appt_noshow_probe_client` template at T+5min
// they get 3 quick-reply buttons:
//   - "Be there in 5"
//   - "Be there in 15"
//   - "Need to reschedule"
//
// Meta delivers the tap as an inbound `interactive_button` event. The
// parser at channels/whatsapp/parse.js normalises:
//   ev.type = 'interactive_button'
//   ev.body = '<button title>'
//   ev.payload.context.id = <external_message_id of the probe we sent>
//
// This service:
//   1. Validates the inbound is a reply to a probe we sent (template name
//      + origin matches).
//   2. Resolves which appointment the probe was about (via reminder.id
//      stored on the original outbound row's origin_ref).
//   3. Acts on the button title:
//        - 5 → ack the client
//        - 15 → ack the client + ping Shivani
//        - reschedule → reply with a Cal.com reschedule link
//
// Idempotency: nothing destructive. Repeat taps just resend the ack.

import process from 'node:process';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import * as wa from '../../channels/whatsapp/client.js';

const PROBE_TEMPLATE_NAME = 'appt_noshow_probe_client';

// Canonical button → action mapping. The titles MUST match the strings
// in scripts/submit-templates.js exactly (Meta's button text is the
// payload key for quick-reply buttons).
const BUTTON_ACTIONS = {
  'Be there in 5':       'late_5',
  'Be there in 15':      'late_15',
  'Need to reschedule':  'reschedule',
};

/**
 * Returns true if the inbound `interactive_button` event was a reply to
 * one of our no-show probes (and we acted on it). Returns false if it's
 * an unrelated button reply — caller should keep processing the message
 * normally.
 */
export async function handleProbeReply({ event, contact, conversation, message }) {
  if (event.type !== 'interactive_button') return false;

  const replyToMessageId = event.payload?.context?.id;
  if (!replyToMessageId) {
    logger.debug({ wa_id: event.wa_id }, 'noshow: button reply has no context.id');
    return false;
  }

  // Look up the original outbound message we're replying to. Must be a
  // template we sent AND specifically the probe template — otherwise this
  // is a tap on some other interactive message and we leave it alone.
  const { data: original, error } = await db().from('messages')
    .select('id, template_name, origin, origin_ref, contact_id, conversation_id, workspace_id, payload')
    .eq('external_message_id', replyToMessageId)
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'noshow: messages lookup failed');
    return false;
  }
  if (!original || original.template_name !== PROBE_TEMPLATE_NAME) {
    return false;
  }

  const buttonTitle = (event.body || '').trim();
  const action = BUTTON_ACTIONS[buttonTitle];
  if (!action) {
    logger.warn({ buttonTitle }, 'noshow: unrecognised button reply on probe');
    return false;
  }

  // Resolve appointment via the reminder row that originated the probe.
  // origin_ref on the message row is the reminder id (set in runner.js).
  let appointment = null;
  if (original.origin === 'reminder' && original.origin_ref) {
    const { data: reminder } = await db().from('reminders')
      .select('appointment_id').eq('id', original.origin_ref).maybeSingle();
    if (reminder?.appointment_id) {
      const { data: appt } = await db().from('appointments')
        .select('id, starts_at, title, metadata, contact_id, source, external_id')
        .eq('id', reminder.appointment_id)
        .maybeSingle();
      appointment = appt || null;
    }
  }

  logger.info(
    { wa_id: event.wa_id, action, appt: appointment?.id || null, button: buttonTitle },
    'noshow: probe reply received',
  );

  switch (action) {
    case 'late_5':
      await ackClient(event.wa_id, 'Great, see you in a few. 🌿');
      break;
    case 'late_15':
      await ackClient(event.wa_id, 'No problem at all. I\'ll wait for you. 🙏');
      await pingCoach(appointment, contact, '15 min late').catch((e) =>
        logger.warn({ err: e.message }, 'noshow: pingCoach failed'));
      break;
    case 'reschedule':
      await sendRescheduleLink(event.wa_id, appointment).catch((e) =>
        logger.warn({ err: e.message }, 'noshow: sendRescheduleLink failed'));
      break;
  }
  return true;
}

async function ackClient(toWaId, body) {
  try {
    await wa.sendText({ to: toWaId, body });
  } catch (e) {
    logger.warn({ err: e.message, to: toWaId }, 'noshow: ack send failed');
  }
}

async function pingCoach(appointment, clientContact, lateLabel) {
  const coachPhone = process.env.SHIVANI_WHATSAPP;
  if (!coachPhone) return;
  const clientName = clientContact?.display_name || clientContact?.primary_phone || 'A client';
  const timeStr = appointment?.starts_at
    ? new Date(appointment.starts_at).toLocaleTimeString('en-IN', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
      })
    : 'now';
  const title = appointment?.title || 'session';
  const body = `Heads up — ${clientName} just tapped "${lateLabel}" on your ${title} probe. Original start: ${timeStr}.`;
  await wa.sendText({ to: coachPhone, body });
}

/**
 * Cal.com reschedule URLs aren't on the booking payload itself — they're
 * derived from the booking uid + event type slug:
 *   https://app.cal.com/reschedule/{uid}
 *
 * For Cal.com bookings we stash the uid on appointments.metadata.cal_com_uid.
 * For Wix bookings (which can't no-show, since the probe is Zoom-only), this
 * path isn't reachable.
 */
async function sendRescheduleLink(toWaId, appointment) {
  const uid = appointment?.metadata?.cal_com_uid;
  const url = uid
    ? `https://app.cal.com/reschedule/${uid}`
    : (process.env.CAL_DEFAULT_RESCHEDULE_URL
        || 'https://cal.com/shivani-hariharan-0xyy3l');
  const body = `No problem at all. You can pick a new time here:\n\n${url}\n\nWarmly,\n— Shivani`;
  try {
    await wa.sendText({ to: toWaId, body });
  } catch (e) {
    logger.warn({ err: e.message, to: toWaId }, 'noshow: reschedule send failed');
  }
}

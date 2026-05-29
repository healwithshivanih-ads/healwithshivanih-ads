// Reminders runner — drains due reminders.
//
// Per tick:
//   1. listDue() up to N
//   2. for each: claim atomically (loser skips)
//   3. load appointment + contact + identity
//   4. resolve template variables
//   5. messages.send(template, origin='reminder', originRef=reminder.id)
//   6. on success: markSent. on failure: markFailedOrRetry (5min back, max 3 attempts).

import process from 'node:process';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import * as reminders from './index.js';
import * as messages from '../messages/index.js';
import { getOrCreate as getOrCreateConversation } from '../conversations/index.js';
import { matchContact } from '../contacts/matcher.js';
import { buildTemplateComponents } from './template-params.js';

const BATCH_LIMIT = 50;

/** Run once. Resolves to {processed, sent, failed, skipped}. */
export async function tick() {
  const due = await reminders.listDue(undefined, BATCH_LIMIT);
  let sent = 0, failed = 0, skipped = 0, processed = 0;

  for (const r of due) {
    processed++;
    try {
      const claimed = await reminders.claim(r.id);
      if (!claimed) { skipped++; continue; } // someone else won the race

      const attempts = (claimed.attempts || 0) + 1;
      try {
        await sendOne(claimed, attempts);
        sent++;
      } catch (err) {
        failed++;
        await reminders.markFailedOrRetry(claimed.id, attempts, {
          message: err.message,
          status: err.status,
          body: err.body,
        }).catch((e) => logger.warn({ err: e.message }, 'markFailedOrRetry persistence failed'));
        logger.warn(
          { reminder_id: claimed.id, kind: claimed.kind, attempts, err: err.message },
          'reminder send failed',
        );
      }
    } catch (e) {
      logger.error({ err: e.message, reminder_id: r.id }, 'reminder loop error');
    }
  }
  return { processed, sent, failed, skipped };
}

async function sendOne(reminder, attempts) {
  // Load appointment + contact in one round trip.
  const { data: appt, error: aErr } = await db().from('appointments')
    .select('*, contact:contacts(*)')
    .eq('id', reminder.appointment_id)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!appt) throw new Error('appointment not found for reminder');

  // Skip if appointment got cancelled between scheduling and now.
  if (appt.status === 'cancelled') {
    await db().from('reminders').update({
      status: 'skipped',
      error: { reason: 'appointment_cancelled_after_scheduling' },
    }).eq('id', reminder.id);
    return;
  }
  // Defensive: old rows from before post_session was dropped may still exist
  // in the table. Skip them silently — the schema CHECK still allows the value.
  if (reminder.kind === 'post_session') {
    await db().from('reminders').update({
      status: 'skipped',
      error: { reason: 'post_session_kind_deprecated' },
    }).eq('id', reminder.id);
    return;
  }

  const clientContact = appt.contact;
  if (!clientContact || !clientContact.primary_phone) {
    throw new Error('contact has no primary_phone');
  }

  // Audience routing: '_coach'-suffixed kinds go to Shivani; everything
  // else goes to the booked client. The template-params builder still
  // reads the CLIENT contact for first-name / phone, regardless of who
  // the message gets DELIVERED to — coach templates reference the
  // client's name + phone in their body.
  const audience = reminders.audienceForKind(reminder.kind);
  let recipientContact = clientContact;
  if (audience === 'coach') {
    recipientContact = await resolveCoachContact(appt.workspace_id);
    if (!recipientContact) {
      throw new Error('coach contact not resolvable — set SHIVANI_WHATSAPP env var');
    }
  }

  const conv = await getOrCreateConversation(appt.workspace_id, recipientContact.id, 'whatsapp');

  // Locale → en | hi (only suffix swap for now). Anything else falls back to en.
  // Use the RECIPIENT's locale, not the client's, so coach reminders are
  // in whichever language Shivani prefers.
  const lang = inferLanguage(recipientContact.locale);
  const baseTemplate = reminders.REMINDER_TEMPLATES[reminder.kind];
  const templateName = lang === 'hi' ? `${baseTemplate}_hi` : baseTemplate;

  // Build params from the booked client + appointment context.
  const { components, resolved } = buildTemplateComponents(reminder.kind, appt, clientContact);

  const sent = await messages.send({
    workspaceId: appt.workspace_id,
    conversationId: conv.id,
    contactId: recipientContact.id,
    channel: 'whatsapp',
    type: 'template',
    templateName,
    templateLanguage: lang,
    templateVariables: { components, resolved },
    origin: 'reminder',
    originRef: reminder.id,
  });

  await reminders.markSent(reminder.id, sent.id, attempts);
}

// Lazy per-process cache so we don't matchContact on every reminder.
let _coachContactCache = null;

async function resolveCoachContact(workspaceId) {
  if (_coachContactCache && _coachContactCache.workspace_id === workspaceId) {
    return _coachContactCache;
  }
  const phone = process.env.SHIVANI_WHATSAPP;
  if (!phone) return null;
  const { contact } = await matchContact(workspaceId, {
    phone,
    display_name: process.env.SHIVANI_DISPLAY_NAME || 'Shivani Hari',
  });
  _coachContactCache = contact;
  return contact;
}

/** Best-effort locale → WA language code. */
function inferLanguage(locale) {
  if (typeof locale === 'string' && locale.toLowerCase().startsWith('hi')) return 'hi';
  return 'en';
}

/** Build the template variable bag. Conservative defaults; templates can ignore. */
function templateVariables(appt, contact) {
  const tz = contact.timezone || 'Asia/Kolkata';
  const startsAt = new Date(appt.starts_at);
  const dateStr = formatDate(startsAt, tz);
  const timeStr = formatTime(startsAt, tz);
  const name = (contact.display_name || '').split(/\s+/)[0] || 'there';
  return {
    bodyParams: [name, dateStr, timeStr, appt.title || 'session'],
    name, date: dateStr, time: timeStr, title: appt.title || 'session',
    join_url: appt.join_url || '',
  };
}

function formatDate(d, tz) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}
function formatTime(d, tz) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
  } catch { return d.toISOString().slice(11, 16); }
}

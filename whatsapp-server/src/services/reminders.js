import { db } from '../db.js';
import { logger } from '../logger.js';
import { sendTemplate } from '../whatsapp/client.js';
import { getOrCreateConversation } from './conversations.js';

const TEMPLATE_BY_KIND = {
  confirmation: 'appt_confirmation',
  t_minus_24h: 'appt_reminder_24h',
  t_minus_2h: 'appt_reminder_2h',
  post_session: 'appt_post_session',
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

async function sendReminder(reminder, appt, contact) {
  const templateName = TEMPLATE_BY_KIND[reminder.kind];
  if (!templateName) {
    logger.warn({ kind: reminder.kind }, 'no template mapped for reminder kind');
    return { ok: false, error: 'no_template' };
  }
  const conv = await getOrCreateConversation(contact.id);
  // Build template components with variables — header param 1 = name, body params 1 = name, 2 = time
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: contact.name || 'there' },
        { type: 'text', text: fmtTime(appt.starts_at) },
        { type: 'text', text: appt.title || 'your session' },
      ],
    },
  ];
  try {
    await sendTemplate({
      to: contact.wa_id,
      templateName,
      languageCode: 'en',
      components,
      conversationId: conv.id,
      contactId: contact.id,
    });
    return { ok: true };
  } catch (err) {
    logger.error({ err: err.message, reminderId: reminder.id, templateName }, 'sendReminder failed');
    return { ok: false, error: err.message };
  }
}

// Idempotency: a reminder is only sent if status='pending'. After send we flip
// to 'sent' (or 'failed' after MAX_ATTEMPTS). Unique (appointment_id, kind)
// prevents duplicate rows being inserted. So even if this loop runs twice
// simultaneously, the second .update() with .eq('status','pending') will affect 0 rows.
const MAX_ATTEMPTS = 3;

export async function runDueReminders() {
  const supabase = db();
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('reminders')
    .select('*, appointments!inner(*, contacts(*))')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .limit(50);
  if (error) {
    logger.error({ error }, 'runDueReminders query failed');
    return { processed: 0 };
  }
  if (!due || !due.length) return { processed: 0 };

  let sent = 0, failed = 0;
  for (const r of due) {
    const appt = r.appointments;
    if (!appt || appt.status === 'cancelled') {
      await supabase.from('reminders').update({ status: 'skipped' }).eq('id', r.id);
      continue;
    }
    const contact = appt.contacts;
    if (!contact) {
      await supabase.from('reminders').update({ status: 'skipped', error: { reason: 'no_contact' } }).eq('id', r.id);
      continue;
    }
    // Claim the reminder atomically — only the first runner to flip from pending wins
    const { data: claimed, error: claimErr } = await supabase
      .from('reminders')
      .update({ status: 'sending', attempts: (r.attempts || 0) + 1 })
      .eq('id', r.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const result = await sendReminder(r, appt, contact);
    if (result.ok) {
      await supabase
        .from('reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', r.id);
      sent++;
    } else {
      const nextStatus = (r.attempts + 1 >= MAX_ATTEMPTS) ? 'failed' : 'pending';
      await supabase
        .from('reminders')
        .update({ status: nextStatus, error: { message: result.error } })
        .eq('id', r.id);
      failed++;
    }
  }
  if (sent || failed) logger.info({ sent, failed, total: due.length }, 'reminders processed');
  return { processed: due.length, sent, failed };
}

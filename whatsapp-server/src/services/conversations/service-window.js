// 24-hour service window check for free-text WhatsApp messages.
// (Templates are always allowed; only free-form needs an inbound within 24h.)
import { db } from '../../db.js';
import { HOURS } from '../../util/time.js';

export async function canSendFreeText(conversationId) {
  if (!conversationId) return false;
  const { data, error } = await db()
    .from('conversations').select('last_inbound_at').eq('id', conversationId).maybeSingle();
  if (error) throw error;
  if (!data?.last_inbound_at) return false;
  const last = new Date(data.last_inbound_at).getTime();
  return Date.now() - last <= HOURS(24);
}

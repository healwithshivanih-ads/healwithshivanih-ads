import { db } from '../db.js';

export async function getOrCreateConversation(contactId) {
  const supabase = db();
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from('conversations')
    .insert({ contact_id: contactId, status: 'open' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function touchInbound(conversationId, when) {
  const supabase = db();
  await supabase
    .from('conversations')
    .update({
      last_inbound_at: when || new Date().toISOString(),
      last_message_at: when || new Date().toISOString(),
    })
    .eq('id', conversationId);
}

export function isInServiceWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  const t = typeof lastInboundAt === 'string' ? new Date(lastInboundAt).getTime() : lastInboundAt.getTime();
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

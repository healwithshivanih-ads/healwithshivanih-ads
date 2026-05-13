import { db } from '../db.js';
import { logger } from '../logger.js';

export async function logInbound({
  conversationId,
  contactId,
  waMessageId,
  type,
  body,
  payload,
}) {
  const supabase = db();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      contact_id: contactId,
      direction: 'inbound',
      wa_message_id: waMessageId,
      type,
      body,
      payload,
      status: 'received',
    })
    .select()
    .single();
  if (error) {
    // Likely a duplicate wa_message_id (Meta sometimes retries) — not fatal
    if (error.code === '23505') {
      logger.debug({ waMessageId }, 'inbound message already logged');
      return null;
    }
    logger.error({ error }, 'logInbound failed');
    throw error;
  }
  return data;
}

export async function markStatus({ waMessageId, status, errors }) {
  const supabase = db();
  const patch = { status };
  if (errors) patch.error = errors;
  const { data, error } = await supabase
    .from('messages')
    .update(patch)
    .eq('wa_message_id', waMessageId)
    .select();
  if (error) logger.warn({ error, waMessageId }, 'markStatus failed');
  return data;
}

// Conversations: one row per (contact, channel). The unique constraint in the
// schema (workspace_id, contact_id, channel) makes getOrCreate safe.
import { db } from '../../db.js';
import { NotFoundError, ValidationError } from '../../errors.js';

const VALID_CHANNELS = new Set(['whatsapp', 'instagram', 'sms', 'email']);
const VALID_STATUSES = new Set(['open', 'closed', 'blocked', 'archived']);

export async function getOrCreate(workspaceId, contactId, channel) {
  if (!VALID_CHANNELS.has(channel)) {
    throw new ValidationError(`unknown channel: ${channel}`);
  }
  const supabase = db();
  const { data: existing, error: e1 } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      { workspace_id: workspaceId, contact_id: contactId, channel, status: 'open' },
      { onConflict: 'workspace_id,contact_id,channel' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function get(id) {
  const { data, error } = await db().from('conversations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('conversation not found');
  return data;
}

export async function list({ status, limit = 50, offset = 0, search } = {}) {
  let q = db().from('conversations')
    .select('*, contact:contacts(id, display_name, primary_phone, primary_email)', { count: 'exact' })
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  // Search filters by joined contact name/phone — small lists make this cheap.
  if (search) {
    const like = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    // Need a server-side join filter; do client-side for round 1 since admin
    // contact lists are < 5k rows.
    const { data: ids } = await db().from('contacts')
      .select('id')
      .or(`display_name.ilike.${like},primary_phone.ilike.${like},primary_email.ilike.${like}`);
    const idArr = (ids || []).map((r) => r.id);
    if (!idArr.length) return { items: [], total: 0 };
    q = q.in('contact_id', idArr);
  }
  const { data, error, count } = await q;
  if (error) throw error;
  return { items: data || [], total: count ?? 0 };
}

export async function markRead(id) {
  const { data, error } = await db().from('conversations')
    .update({ unread_count: 0 }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function setStatus(id, status) {
  if (!VALID_STATUSES.has(status)) throw new ValidationError(`bad status: ${status}`);
  const { data, error } = await db().from('conversations')
    .update({ status }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function patch(id, fields) {
  const allowed = ['status', 'ai_policy', 'notes', 'assigned_to'];
  const clean = {};
  for (const k of allowed) if (fields[k] !== undefined) clean[k] = fields[k];
  if (clean.status && !VALID_STATUSES.has(clean.status)) {
    throw new ValidationError(`bad status: ${clean.status}`);
  }
  const { data, error } = await db().from('conversations')
    .update(clean).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Bump last_inbound_at + unread_count on a conversation. */
export async function touchInbound(id, atIso) {
  const ts = atIso || new Date().toISOString();
  // Get current unread count and increment in-process; small inbox makes this fine.
  const { data: cur } = await db().from('conversations').select('unread_count').eq('id', id).maybeSingle();
  const next = (cur?.unread_count ?? 0) + 1;
  const { error } = await db().from('conversations')
    .update({ last_inbound_at: ts, unread_count: next }).eq('id', id);
  if (error) throw error;
}

/** Bump last_outbound_at on a conversation. */
export async function touchOutbound(id, atIso) {
  const ts = atIso || new Date().toISOString();
  const { error } = await db().from('conversations')
    .update({ last_outbound_at: ts }).eq('id', id);
  if (error) throw error;
}

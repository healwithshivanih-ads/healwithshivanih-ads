// contact_identities — per-channel reachability rows.
// One contact can have many identities (whatsapp, email, wix_id, ig handle).

import { db } from '../../db.js';
import { NotFoundError, ValidationError } from '../../errors.js';

const VALID_CHANNELS = new Set(['whatsapp', 'instagram', 'wix', 'email', 'sms']);
const VALID_SUB = new Set(['unknown', 'subscribed', 'unsubscribed', 'never_subscribed']);

export async function add(contactId, channel, externalId, opts = {}) {
  if (!VALID_CHANNELS.has(channel)) {
    throw new ValidationError(`unknown channel: ${channel}`);
  }
  if (!externalId) throw new ValidationError('external_id required');

  // Resolve workspace_id from the contact (FK chain is workspace_id-scoped).
  const { data: contact, error: cErr } = await db()
    .from('contacts').select('workspace_id').eq('id', contactId).maybeSingle();
  if (cErr) throw cErr;
  if (!contact) throw new NotFoundError('contact not found');

  const row = {
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    channel,
    external_id: externalId,
    is_primary: opts.is_primary ?? false,
    verified: opts.verified ?? false,
    subscription_status: opts.subscription_status ?? 'unknown',
    last_seen_at: opts.last_seen_at ?? null,
    metadata: opts.metadata ?? {},
  };

  // upsert on (workspace_id, channel, external_id)
  const { data, error } = await db()
    .from('contact_identities')
    .upsert(row, { onConflict: 'workspace_id,channel,external_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  const { error } = await db().from('contact_identities').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function setPrimary(id) {
  const { data: row, error: e1 } = await db()
    .from('contact_identities').select('contact_id, channel').eq('id', id).maybeSingle();
  if (e1) throw e1;
  if (!row) throw new NotFoundError('identity not found');

  // Demote siblings on the same channel, then promote this one.
  const { error: e2 } = await db()
    .from('contact_identities')
    .update({ is_primary: false })
    .eq('contact_id', row.contact_id)
    .eq('channel', row.channel);
  if (e2) throw e2;

  const { data, error: e3 } = await db()
    .from('contact_identities').update({ is_primary: true }).eq('id', id).select().single();
  if (e3) throw e3;
  return data;
}

export async function updateSubscription(id, status) {
  if (!VALID_SUB.has(status)) throw new ValidationError(`unknown subscription_status: ${status}`);
  const { data, error } = await db()
    .from('contact_identities').update({ subscription_status: status }).eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function listForContact(contactId) {
  const { data, error } = await db()
    .from('contact_identities')
    .select('*')
    .eq('contact_id', contactId)
    .order('is_primary', { ascending: false })
    .order('channel');
  if (error) throw error;
  return data || [];
}

export async function getByExternal(workspaceId, channel, externalId) {
  const { data, error } = await db()
    .from('contact_identities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

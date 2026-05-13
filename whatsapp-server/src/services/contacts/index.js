// Contact CRUD on top of the matcher and identity helpers.
import { db } from '../../db.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import { getDefault as getDefaultWorkspace } from '../workspaces.js';
import { matchContact } from './matcher.js';
import * as identities from './identities.js';
import * as tagsSvc from './tags.js';
import { normalizePhone } from '../../util/phone.js';

async function workspaceId() {
  const w = await getDefaultWorkspace();
  return w.id;
}

/**
 * Idempotent upsert. Uses the matcher to find an existing person; either
 * patches them with the candidate fields or creates a new row.
 *
 * Input shape (all optional except at least one identity):
 *   {
 *     display_name, primary_phone, primary_email, locale, city, country,
 *     timezone, opt_in_status, opt_in_source, consent_text, consent_method,
 *     metadata,
 *     identities: [{ channel, external_id, is_primary, subscription_status }],
 *     tags: ['name', ...]
 *   }
 */
export async function upsert(input) {
  const wsId = await workspaceId();

  const candidate = {
    wix_id: pickIdentity(input.identities, 'wix'),
    phone: input.primary_phone || pickIdentity(input.identities, 'whatsapp'),
    email: input.primary_email || pickIdentity(input.identities, 'email'),
    display_name: input.display_name,
    locale: input.locale,
    city: input.city,
    country: input.country,
    timezone: input.timezone,
    opt_in_status: input.opt_in_status,
    opt_in_source: input.opt_in_source,
    metadata: input.metadata,
  };

  // Need at least one identity to do anything useful.
  if (!candidate.wix_id && !candidate.phone && !candidate.email) {
    throw new ValidationError('contact upsert requires at least one of: wix_id, phone, email');
  }

  const { contact, created } = await matchContact(wsId, candidate);

  // Patch fields the matcher didn't fill (e.g. for an existing match we still
  // want to update display_name, opt_in, etc. when newer info arrives).
  const patch = {};
  for (const k of ['display_name', 'locale', 'city', 'country', 'timezone',
                   'opt_in_status', 'opt_in_source', 'consent_text', 'consent_method']) {
    if (input[k] != null && input[k] !== contact[k]) patch[k] = input[k];
  }
  // Keep primary_phone / primary_email up to date if we got better data.
  const newPhone = candidate.phone ? normalizePhone(candidate.phone) : null;
  if (newPhone && newPhone !== contact.primary_phone) patch.primary_phone = newPhone;
  const newEmail = candidate.email ? candidate.email.toLowerCase() : null;
  if (newEmail && newEmail !== contact.primary_email) patch.primary_email = newEmail;
  if (input.metadata) {
    patch.metadata = { ...(contact.metadata || {}), ...input.metadata };
  }

  let row = contact;
  if (Object.keys(patch).length) {
    const { data, error } = await db().from('contacts')
      .update(patch).eq('id', contact.id).select().single();
    if (error) throw error;
    row = data;
  }

  // Add additional explicit identities the matcher didn't touch.
  if (Array.isArray(input.identities)) {
    for (const ident of input.identities) {
      if (!ident?.channel || !ident?.external_id) continue;
      // Matcher already wrote the primary wix/whatsapp/email rows; this
      // handles secondary numbers (ExtraPhone, OtherPhone) etc.
      const ext = ident.channel === 'whatsapp'
        ? normalizePhone(ident.external_id)
        : ident.channel === 'email'
          ? String(ident.external_id).toLowerCase()
          : ident.external_id;
      if (!ext) continue;
      await identities.add(row.id, ident.channel, ext, {
        is_primary: !!ident.is_primary,
        subscription_status: ident.subscription_status,
      });
    }
  }

  // Apply tags.
  if (Array.isArray(input.tags)) {
    for (const t of input.tags) {
      if (typeof t === 'string' && t.trim()) await tagsSvc.addToContact(row.id, t.trim());
    }
  }

  return { contact: row, created };
}

function pickIdentity(arr, channel) {
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((i) => i?.channel === channel && i.external_id);
  return hit ? hit.external_id : null;
}

export async function get(id) {
  const { data, error } = await db().from('contacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) throw new NotFoundError('contact not found');
  return data;
}

export async function getByExternalId(channel, externalId) {
  const wsId = await workspaceId();
  const id = await identities.getByExternal(wsId, channel, externalId);
  if (!id) return null;
  return get(id.contact_id);
}

export async function search({ query, tag, limit = 50, offset = 0 } = {}) {
  const wsId = await workspaceId();
  let q = db().from('contacts')
    .select('*', { count: 'exact' })
    .eq('workspace_id', wsId)
    .is('deleted_at', null)
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (query) {
    const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.or(
      `display_name.ilike.${like},primary_phone.ilike.${like},primary_email.ilike.${like}`,
    );
  }

  // Tag filter via subquery on contact_tags.
  if (tag) {
    const { data: tagRow } = await db()
      .from('tags').select('id').eq('workspace_id', wsId).eq('name', tag).maybeSingle();
    if (!tagRow) return { items: [], total: 0 };
    const { data: taggedIds } = await db()
      .from('contact_tags').select('contact_id').eq('tag_id', tagRow.id);
    const ids = (taggedIds || []).map((r) => r.contact_id);
    if (!ids.length) return { items: [], total: 0 };
    q = q.in('id', ids);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { items: data || [], total: count ?? (data?.length || 0) };
}

export async function softDelete(id) {
  const { data, error } = await db().from('contacts')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Patch raw fields on a contact (no identity/tag side-effects). */
export async function patch(id, fields) {
  const allowed = [
    'display_name', 'primary_phone', 'primary_email', 'locale', 'city',
    'country', 'timezone', 'opt_in_status', 'opt_in_source', 'consent_text',
    'consent_method', 'metadata',
  ];
  const clean = {};
  for (const k of allowed) if (fields[k] !== undefined) clean[k] = fields[k];
  if (clean.primary_phone) clean.primary_phone = normalizePhone(clean.primary_phone);
  if (clean.primary_email) clean.primary_email = String(clean.primary_email).toLowerCase();
  const { data, error } = await db().from('contacts')
    .update(clean).eq('id', id).select().single();
  if (error) throw error;
  if (!data) throw new NotFoundError('contact not found');
  return data;
}

// Identity matcher (Wix mapping doc §4).
//
//   1. wix_id  → channel='wix'      , exact
//   2. phone   → channel='whatsapp'  , E.164-without-plus
//   3. email   → channel='email'     , lowercase exact
//   4. else    → create new contact + identities
//
// Returns { contact, created }.

import { db } from '../../db.js';
import { normalizePhone } from '../../util/phone.js';
import * as identities from './identities.js';

export async function matchContact(workspaceId, candidate) {
  const supabase = db();

  // 1. wix_id
  if (candidate.wix_id) {
    const id = await identities.getByExternal(workspaceId, 'wix', candidate.wix_id);
    if (id) {
      const c = await getContact(id.contact_id);
      if (c) return { contact: c, created: false };
    }
  }

  // 2. phone
  let phone = null;
  if (candidate.phone) {
    phone = normalizePhone(candidate.phone);
    if (phone) {
      const id = await identities.getByExternal(workspaceId, 'whatsapp', phone);
      if (id) {
        const c = await getContact(id.contact_id);
        if (c) return { contact: c, created: false };
      }
    }
  }

  // 3. email
  const email = candidate.email ? String(candidate.email).trim().toLowerCase() : null;
  if (email) {
    const id = await identities.getByExternal(workspaceId, 'email', email);
    if (id) {
      const c = await getContact(id.contact_id);
      if (c) return { contact: c, created: false };
    }
  }

  // 4. create new
  const insertRow = {
    workspace_id: workspaceId,
    display_name: candidate.display_name || candidate.name || null,
    primary_phone: phone || null,
    primary_email: email || null,
    locale: candidate.locale || null,
    city: candidate.city || null,
    country: candidate.country || null,
    timezone: candidate.timezone || null,
    opt_in_status: candidate.opt_in_status || 'unknown',
    opt_in_source: candidate.opt_in_source || null,
    metadata: candidate.metadata || {},
  };
  const { data: created, error } = await supabase
    .from('contacts').insert(insertRow).select().single();
  if (error) throw error;

  // Mirror identities so future lookups are O(1).
  if (candidate.wix_id) {
    await identities.add(created.id, 'wix', candidate.wix_id, { is_primary: true });
  }
  if (phone) {
    await identities.add(created.id, 'whatsapp', phone, { is_primary: true });
  }
  if (email) {
    await identities.add(created.id, 'email', email, { is_primary: true });
  }

  return { contact: created, created: true };
}

async function getContact(id) {
  const { data, error } = await db().from('contacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

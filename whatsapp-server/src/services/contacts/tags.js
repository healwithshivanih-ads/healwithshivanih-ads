// Tag CRUD + contact ↔ tag join. Workspace-scoped.
import { db } from '../../db.js';
import { getDefault as getDefaultWorkspace } from '../workspaces.js';
import { NotFoundError } from '../../errors.js';

async function workspaceId() {
  const w = await getDefaultWorkspace();
  return w.id;
}

export async function list({ withCounts = false } = {}) {
  const wsId = await workspaceId();
  const { data: tags, error } = await db()
    .from('tags').select('*').eq('workspace_id', wsId).order('name');
  if (error) throw error;
  if (!withCounts) return tags || [];

  // Cheap aggregate: count contact_tags per tag.
  const ids = (tags || []).map((t) => t.id);
  if (!ids.length) return [];
  const { data: counts, error: cErr } = await db()
    .from('contact_tags').select('tag_id, contact_id').in('tag_id', ids);
  if (cErr) throw cErr;
  const tally = new Map();
  for (const r of counts || []) tally.set(r.tag_id, (tally.get(r.tag_id) || 0) + 1);
  return tags.map((t) => ({ ...t, contact_count: tally.get(t.id) || 0 }));
}

export async function ensure(name, opts = {}) {
  const wsId = await workspaceId();
  const { data: existing, error: e1 } = await db()
    .from('tags').select('*').eq('workspace_id', wsId).eq('name', name).maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;

  const { data, error } = await db().from('tags').insert({
    workspace_id: wsId,
    name,
    color: opts.color || null,
    description: opts.description || null,
    kind: opts.kind || 'manual',
  }).select().single();
  if (error) throw error;
  return data;
}

export async function addToContact(contactId, tagName, addedBy = null) {
  const tag = await ensure(tagName);
  const { error } = await db().from('contact_tags').upsert(
    { contact_id: contactId, tag_id: tag.id, added_by: addedBy },
    { onConflict: 'contact_id,tag_id' },
  );
  if (error) throw error;
  return tag;
}

export async function removeFromContact(contactId, tagName) {
  const wsId = await workspaceId();
  const { data: tag, error: e1 } = await db()
    .from('tags').select('id').eq('workspace_id', wsId).eq('name', tagName).maybeSingle();
  if (e1) throw e1;
  if (!tag) throw new NotFoundError(`tag not found: ${tagName}`);
  const { error } = await db().from('contact_tags')
    .delete().eq('contact_id', contactId).eq('tag_id', tag.id);
  if (error) throw error;
  return { ok: true };
}

export async function listForContact(contactId) {
  const { data, error } = await db()
    .from('contact_tags')
    .select('added_at, tags(id, name, color, kind)')
    .eq('contact_id', contactId);
  if (error) throw error;
  return (data || []).map((r) => ({ ...r.tags, added_at: r.added_at }));
}

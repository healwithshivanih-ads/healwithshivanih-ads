import { db } from '../db.js';
import { logger } from '../logger.js';

// Upsert by wa_id (E.164 without leading +)
export async function upsertContact({ waId, phone, name, source, metadata = {} }) {
  const supabase = db();
  // Try select first
  const { data: existing } = await supabase
    .from('contacts')
    .select('*')
    .eq('wa_id', waId)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const patch = { last_seen_at: now };
    if (name && !existing.name) patch.name = name;
    if (source && !existing.opt_in_source) {
      patch.opt_in_source = source;
      patch.opt_in_at = now;
    }
    if (Object.keys(metadata).length) {
      patch.metadata = { ...(existing.metadata || {}), ...metadata };
    }
    const { data, error } = await supabase
      .from('contacts')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) {
      logger.error({ error }, 'contact update failed');
      return existing;
    }
    return data;
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      wa_id: waId,
      phone: phone || `+${waId}`,
      name: name || null,
      opt_in_source: source || 'whatsapp',
      opt_in_at: now,
      last_seen_at: now,
      metadata,
    })
    .select()
    .single();
  if (error) {
    logger.error({ error }, 'contact insert failed');
    throw error;
  }
  return data;
}

export async function addTag(contactId, tagName) {
  const supabase = db();
  let { data: tag } = await supabase.from('tags').select('*').eq('name', tagName).maybeSingle();
  if (!tag) {
    const { data: newTag, error } = await supabase
      .from('tags')
      .insert({ name: tagName })
      .select()
      .single();
    if (error) throw error;
    tag = newTag;
  }
  const { error: linkErr } = await supabase
    .from('contact_tags')
    .upsert({ contact_id: contactId, tag_id: tag.id });
  if (linkErr) throw linkErr;
  return tag;
}

export async function removeTag(contactId, tagName) {
  const supabase = db();
  const { data: tag } = await supabase.from('tags').select('id').eq('name', tagName).maybeSingle();
  if (!tag) return;
  await supabase
    .from('contact_tags')
    .delete()
    .eq('contact_id', contactId)
    .eq('tag_id', tag.id);
}

export async function listTags(contactId) {
  const supabase = db();
  const { data } = await supabase
    .from('contact_tags')
    .select('tags(name, color)')
    .eq('contact_id', contactId);
  return (data || []).map((r) => r.tags).filter(Boolean);
}

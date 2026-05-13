// Workspace service. We're single-tenant in practice but keep the multi-tenant
// shape so the rest of the codebase always passes workspace_id.
import { db } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { NotFoundError } from '../errors.js';

let _cachedDefault = null;

/**
 * Get the default workspace. Resolution order:
 *   1. config.workspaceId (if set in env)
 *   2. first workspace in the table
 *   3. create a new one with config.workspaceName
 *
 * Result is cached for the process lifetime. Restart to pick up renames.
 */
export async function getDefault() {
  if (_cachedDefault) return _cachedDefault;
  const supabase = db();

  if (config.workspaceId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', config.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      _cachedDefault = data;
      return data;
    }
    logger.warn({ workspaceId: config.workspaceId }, 'WORKSPACE_ID set but no row found; falling back');
  }

  const { data: existing, error: listErr } = await supabase
    .from('workspaces')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1);
  if (listErr) throw listErr;
  if (existing && existing.length) {
    _cachedDefault = existing[0];
    return existing[0];
  }

  // None present: create one.
  const { data: created, error: createErr } = await supabase
    .from('workspaces')
    .insert({
      name: config.workspaceName,
      wa_phone_number_id: config.whatsapp.phoneNumberId || null,
      wa_business_account_id: config.whatsapp.businessAccountId || null,
    })
    .select()
    .single();
  if (createErr) throw createErr;
  logger.info({ id: created.id, name: created.name }, 'created default workspace');
  _cachedDefault = created;
  return created;
}

export async function get(id) {
  const { data, error } = await db().from('workspaces').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('workspace not found');
  return data;
}

export async function updateSettings(id, patch) {
  // patch is a partial of {name, wa_*, suppression_policy, settings}
  const { data, error } = await db()
    .from('workspaces')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if (_cachedDefault && _cachedDefault.id === id) _cachedDefault = data;
  return data;
}

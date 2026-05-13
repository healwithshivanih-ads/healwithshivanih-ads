// Wix → us inbound processing.
//
// processContactEvent(payload) — webhook entry. Inspects the change type and
// either fetches+upserts the contact, or soft-deletes locally on contacts/deleted.
//
// syncOneContact(wixContact, integrationId) — the workhorse. Maps the Wix
// record, runs through matchContact, upserts contact + identities + tags,
// records a sync_event row.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import * as contacts from '../../services/contacts/index.js';
import * as tagsSvc from '../../services/contacts/tags.js';
import { wixContactToCandidate } from './mapping.js';
import * as wixClient from './client.js';
import { getApiKey } from './credentials.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';

/**
 * Entry point from the webhook handler. Payload shape varies; we accept both
 * the raw envelope and the already-parsed event content.
 */
export async function processContactEvent(payload) {
  const eventType = payload?.eventType || payload?.slug || payload?.event || null;
  const data = payload?.data || payload;
  const wixId = data?.contactId || data?._id || data?.id || data?.contact?._id || null;

  if (!wixId) {
    logger.warn({ payload }, 'wix webhook: no contact id in payload');
    return { ok: false, reason: 'no_contact_id' };
  }

  // Resolve the wix integration row for this workspace (single-workspace today).
  const integration = await getWixIntegration();
  if (!integration) {
    logger.warn('wix webhook: no wix integration configured');
    return { ok: false, reason: 'no_integration' };
  }

  // contacts/deleted → soft-delete locally
  if (eventType && /delete/i.test(eventType)) {
    return softDeleteByWixId(integration.workspace_id, wixId);
  }

  // labeled / unlabeled → re-fetch full record then sync (label diff is in webhook
  // but the contact fetch is the cheapest source of truth).
  // created / updated → fetch full record and sync.
  let full;
  try {
    const apiKey = await getApiKey(integration.id);
    full = await wixClient.getContact(apiKey, wixId);
  } catch (e) {
    // If we can't fetch (e.g. 404 because deleted between webhook and fetch),
    // attempt to soft-delete; otherwise log + bail.
    if (e.status === 404) return softDeleteByWixId(integration.workspace_id, wixId);
    logger.error({ err: e.message, wixId }, 'wix webhook: getContact failed');
    return { ok: false, reason: 'fetch_failed', error: e.message };
  }
  return syncOneContact(full, integration.id);
}

/** Run the inbound sync for a single Wix contact. Returns the upserted contact row. */
export async function syncOneContact(wixContact, integrationId) {
  const integration = integrationId
    ? await loadIntegration(integrationId)
    : await getWixIntegration();
  if (!integration) throw new Error('wix integration not found');

  const mapped = wixContactToCandidate(wixContact);
  let result, errorPayload;
  try {
    // Matcher + upsert.
    const upsert = await contacts.upsert({
      display_name: mapped.candidate.display_name,
      primary_phone: mapped.candidate.phone,
      primary_email: mapped.candidate.email,
      locale: mapped.candidate.locale,
      city: mapped.candidate.city,
      country: mapped.candidate.country,
      opt_in_source: mapped.candidate.opt_in_source,
      metadata: mapped.candidate.metadata,
      identities: mapped.identities,
      tags: mapped.labels,
    });
    result = upsert.contact;

    // Apply tag union (mapping.labels are the desired set; we don't remove on inbound).
    for (const label of mapped.labels) {
      await tagsSvc.addToContact(result.id, label, 'wix_sync').catch((e) =>
        logger.warn({ err: e.message, label }, 'wix tag apply failed'));
    }

    await recordSyncEvent(integration.id, {
      direction: 'in',
      entity_type: 'contact',
      entity_id: result.id,
      external_id: mapped.candidate.wix_id,
      operation: upsert.created ? 'create' : 'update',
      status: 'done',
      payload: { wix_updated_at: mapped.wix_updated_at, label_count: mapped.labels.length },
    });
    return result;
  } catch (e) {
    errorPayload = { message: e.message, status: e.status };
    await recordSyncEvent(integration.id, {
      direction: 'in',
      entity_type: 'contact',
      entity_id: null,
      external_id: mapped.candidate.wix_id,
      operation: 'update',
      status: 'failed',
      error: errorPayload,
      payload: { wix_updated_at: mapped.wix_updated_at },
    });
    throw e;
  }
}

async function softDeleteByWixId(workspaceId, wixId) {
  // Look up by identity first (cheap join).
  const { data: idRow } = await db().from('contact_identities')
    .select('contact_id').eq('workspace_id', workspaceId).eq('channel', 'wix').eq('external_id', wixId).maybeSingle();
  if (!idRow) return { ok: true, reason: 'no_match' };
  const { error } = await db().from('contacts')
    .update({ deleted_at: new Date().toISOString() }).eq('id', idRow.contact_id);
  if (error) throw error;
  const integration = await getWixIntegration();
  if (integration) {
    await recordSyncEvent(integration.id, {
      direction: 'in',
      entity_type: 'contact',
      entity_id: idRow.contact_id,
      external_id: wixId,
      operation: 'delete',
      status: 'done',
    });
  }
  return { ok: true, deleted: true };
}

async function recordSyncEvent(integrationId, evt) {
  const row = {
    integration_id: integrationId,
    direction: evt.direction,
    entity_type: evt.entity_type,
    entity_id: evt.entity_id || null,
    external_id: evt.external_id || null,
    operation: evt.operation,
    payload: evt.payload || null,
    status: evt.status || 'pending',
    error: evt.error || null,
    attempted_at: evt.status === 'pending' ? null : new Date().toISOString(),
    attempts: 1,
  };
  const { error } = await db().from('sync_events').insert(row);
  if (error) logger.warn({ err: error.message }, 'sync_events insert failed');
}

async function getWixIntegration() {
  const ws = await getDefaultWorkspace();
  const { data, error } = await db().from('integrations')
    .select('*').eq('workspace_id', ws.id).eq('type', 'wix').maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadIntegration(id) {
  const { data, error } = await db().from('integrations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

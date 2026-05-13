// Wix reconciler — periodic catch-up scan.
//
// tick(integrationId)     incremental: page through contacts updated since
//                         last_incremental_sync_at; bump on success.
// fullResync(integrationId)  same but since=null; updates last_full_sync_at.
//
// Errors during a single contact sync are logged into sync_events but don't
// abort the tick — the next page can still proceed.

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import * as wixClient from './client.js';
import { getApiKey } from './credentials.js';
import { syncOneContact } from './inbound.js';

const PAGE_SIZE = 100;
const MAX_PAGES_PER_TICK = 50; // safety cap

export async function tick(integrationId) {
  return _run(integrationId, { mode: 'incremental' });
}

export async function fullResync(integrationId) {
  return _run(integrationId, { mode: 'full' });
}

async function _run(integrationId, { mode }) {
  const integration = await loadIntegration(integrationId);
  if (!integration) throw new Error('integration not found: ' + integrationId);
  if (integration.status !== 'connected') {
    logger.info({ integrationId, status: integration.status }, 'wix reconciler: skipped (not connected)');
    return { ok: false, reason: 'not_connected' };
  }

  const apiKey = await getApiKey(integrationId);
  if (!apiKey) {
    logger.warn({ integrationId }, 'wix reconciler: no api key');
    return { ok: false, reason: 'no_api_key' };
  }

  const since = mode === 'incremental' ? integration.last_incremental_sync_at : null;
  let cursor = null;
  let totalSeen = 0, succeeded = 0, failed = 0, pages = 0;
  const startedAt = new Date().toISOString();

  try {
    while (pages < MAX_PAGES_PER_TICK) {
      const { items, next_cursor } = await wixClient.listContacts(apiKey, {
        since, limit: PAGE_SIZE, cursor,
      });
      pages++;
      if (!items || !items.length) break;
      for (const wixContact of items) {
        totalSeen++;
        try {
          await syncOneContact(wixContact, integrationId);
          succeeded++;
        } catch (e) {
          failed++;
          logger.warn({ err: e.message, wixId: wixContact?._id }, 'wix sync one failed');
        }
      }
      if (!next_cursor) break;
      cursor = next_cursor;
    }
  } catch (e) {
    // Page-level failure (creds expired, network, etc) — record + bail.
    await db().from('integrations').update({
      last_error: { message: e.message, status: e.status, at: new Date().toISOString() },
    }).eq('id', integrationId);
    logger.error({ err: e.message }, 'wix reconciler tick failed');
    return { ok: false, reason: 'page_error', error: e.message, totalSeen, succeeded, failed };
  }

  // Success — update sync timestamps + clear last_error.
  const patch = { last_error: null, status: 'connected' };
  if (mode === 'full') {
    patch.last_full_sync_at = startedAt;
    patch.last_incremental_sync_at = startedAt;
  } else {
    patch.last_incremental_sync_at = startedAt;
  }
  await db().from('integrations').update(patch).eq('id', integrationId);
  logger.info({ integrationId, mode, totalSeen, succeeded, failed, pages }, 'wix reconciler tick done');
  return { ok: true, mode, totalSeen, succeeded, failed, pages };
}

async function loadIntegration(id) {
  const { data, error } = await db().from('integrations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Convenience: list all connected Wix integrations across workspaces. */
export async function listConnected() {
  const { data, error } = await db().from('integrations').select('*')
    .eq('type', 'wix').eq('status', 'connected');
  if (error) throw error;
  return data || [];
}

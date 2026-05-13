// Wix REST API wrapper. Pure HTTP — no DB writes.
//
// Auth: Bearer token from `integrations.credentials_encrypted.api_key_enc`,
// decrypted at call time. Caller passes the decrypted key in `apiKey`.
//
// Base URL: https://www.wixapis.com/contacts/v4
//
// 429 handling: respect Retry-After header (or back off 2/4/8s) up to 3 tries.

import fetch from 'node-fetch';

const BASE = 'https://www.wixapis.com/contacts/v4';

class WixApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'WixApiError';
    this.status = status;
    this.body = body;
  }
}

async function _req(apiKey, method, pathAndQuery, body) {
  if (!apiKey) throw new WixApiError('Wix API key not provided', { status: 401 });
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : BASE + pathAndQuery;

  let attempt = 0;
  let lastErr;
  while (attempt < 3) {
    attempt++;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: apiKey, // Wix accepts the API key directly as the Authorization header value
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      lastErr = new WixApiError(`Wix network error: ${e.message}`, { status: 0 });
      await sleep(1000 * attempt);
      continue;
    }
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || (2 ** attempt);
      lastErr = new WixApiError('Wix 429 rate limited', { status: 429, body: parsed });
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      throw new WixApiError(`Wix API ${res.status}`, { status: res.status, body: parsed });
    }
    return parsed;
  }
  throw lastErr || new WixApiError('Wix API: exhausted retries', { status: 0 });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * List contacts. Wix v4 uses cursor pagination via `paging.cursor`.
 * `since` is an ISO timestamp; we pass it as a filter on _updatedDate.
 */
export async function listContacts(apiKey, { since, limit = 100, cursor } = {}) {
  const body = {
    paging: { limit: Math.min(limit, 1000) },
  };
  if (cursor) body.paging.cursor = cursor;
  if (since) {
    body.filter = {
      'info.extendedFields._updatedDate': { $gte: since },
    };
  }
  // POST /query is the documented page endpoint for v4.
  const res = await _req(apiKey, 'POST', '/contacts/query', body);
  return {
    items: res?.contacts || res?.items || [],
    next_cursor: res?.metadata?.cursors?.next || res?.pagingMetadata?.cursors?.next || null,
    total: res?.metadata?.totalCount ?? null,
  };
}

export async function getContact(apiKey, wixId) {
  if (!wixId) throw new WixApiError('getContact: wixId required', { status: 400 });
  const res = await _req(apiKey, 'GET', `/contacts/${encodeURIComponent(wixId)}`);
  return res?.contact || res;
}

/** Sanity-check creds: minimal call. */
export async function ping(apiKey) {
  return listContacts(apiKey, { limit: 1 });
}

export { WixApiError };

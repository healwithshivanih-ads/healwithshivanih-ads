// CSV contact import.
//
// Supports a column-mapping config: { csv_col: target_field }, plus default tags
// and a default opt_in_source applied to every row that lacks one.
//
// Streams in batches of 100. Records counters (matched_existing, created_new,
// skipped, failed) and writes them onto an `imports` row.

import { parse as parseCsv } from 'csv-parse/sync';
import { db } from '../../db.js';
import { logger } from '../../logger.js';
import * as contacts from './index.js';
import { getDefault as getDefaultWorkspace } from '../workspaces.js';
import { ValidationError } from '../../errors.js';

const ALLOWED_TARGETS = new Set([
  'primary_phone', 'primary_email', 'display_name', 'city', 'country',
  'locale', 'timezone', 'opt_in_source', 'wix_id', 'tags',
]);

/**
 * Process a CSV. `content` is the file as a Buffer or string.
 *
 * @param {object} input
 * @param {string} [input.workspaceId]
 * @param {string} [input.filename]
 * @param {Buffer|string} input.content
 * @param {object} input.config
 *   - column_mapping: { csv_col: target_field }   (optional; auto-mapped from header otherwise)
 *   - default_tags: string[]
 *   - default_opt_in_source: string
 *   - dedupe_key: 'phone' | 'email' | 'auto'      (informational; matcher always runs)
 */
export async function processCsv({ workspaceId, filename, content, config: cfg }) {
  const ws = workspaceId
    ? { id: workspaceId }
    : await getDefaultWorkspace();
  if (!cfg) cfg = {};

  // Insert the imports row up-front so the UI can surface progress / status.
  const { data: importRow, error: e1 } = await db().from('imports').insert({
    workspace_id: ws.id,
    source: 'csv',
    filename: filename || null,
    status: 'processing',
    config: cfg,
  }).select().single();
  if (e1) throw e1;

  const counters = {
    total_rows: 0, matched_existing: 0, created_new: 0, skipped: 0, failed: 0,
  };
  const errorSamples = [];

  try {
    const records = parseCsv(content, {
      columns: true, skip_empty_lines: true, trim: true,
      bom: true, relax_column_count: true,
    });
    counters.total_rows = records.length;

    const mapping = cfg.column_mapping || autoMapping(Object.keys(records[0] || {}));
    const tagsDefault = Array.isArray(cfg.default_tags) ? cfg.default_tags.filter(Boolean) : [];
    const optInSource = cfg.default_opt_in_source || 'csv_import';

    // Dedupe within file by phone+email signature.
    const seen = new Set();

    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      const slice = records.slice(i, i + BATCH);
      for (const row of slice) {
        const candidate = mapRow(row, mapping);

        if (!candidate.primary_phone && !candidate.primary_email && !candidate.wix_id) {
          counters.skipped++;
          if (errorSamples.length < 25) {
            errorSamples.push({ row_index: i + slice.indexOf(row), reason: 'no_identity', data: row });
          }
          continue;
        }
        const sig = `${candidate.primary_phone || ''}|${candidate.primary_email || ''}|${candidate.wix_id || ''}`;
        if (seen.has(sig)) { counters.skipped++; continue; }
        seen.add(sig);

        try {
          // Build identities from primary fields + optional wix_id.
          const identities = [];
          if (candidate.wix_id) identities.push({ channel: 'wix', external_id: candidate.wix_id, is_primary: true });

          const tags = [...tagsDefault];
          if (Array.isArray(candidate._row_tags)) tags.push(...candidate._row_tags);

          const upsert = await contacts.upsert({
            display_name: candidate.display_name,
            primary_phone: candidate.primary_phone,
            primary_email: candidate.primary_email,
            city: candidate.city,
            country: candidate.country,
            locale: candidate.locale,
            timezone: candidate.timezone,
            opt_in_source: candidate.opt_in_source || optInSource,
            identities,
            tags,
          });
          if (upsert.created) counters.created_new++; else counters.matched_existing++;
        } catch (e) {
          counters.failed++;
          if (errorSamples.length < 25) {
            errorSamples.push({ row_index: i + slice.indexOf(row), reason: e.message, data: row });
          }
          logger.warn({ err: e.message }, 'csv import row failed');
        }
      }
    }

    const status = counters.failed > 0
      ? (counters.created_new + counters.matched_existing > 0 ? 'partial' : 'failed')
      : 'done';

    const { data: updated, error: uErr } = await db().from('imports').update({
      status,
      total_rows: counters.total_rows,
      matched_existing: counters.matched_existing,
      created_new: counters.created_new,
      skipped: counters.skipped,
      failed: counters.failed,
      errors: errorSamples.length ? errorSamples : null,
      processed_at: new Date().toISOString(),
    }).eq('id', importRow.id).select().single();
    if (uErr) throw uErr;
    return updated;
  } catch (e) {
    await db().from('imports').update({
      status: 'failed',
      errors: [{ reason: e.message }],
      processed_at: new Date().toISOString(),
    }).eq('id', importRow.id);
    throw e;
  }
}

/** Auto-map header names to target fields when no explicit mapping was given. */
function autoMapping(headers) {
  const out = {};
  for (const h of headers) {
    const k = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    if (k === 'phone' || k === 'mobile' || k === 'phone_number' || k === 'primary_phone') out[h] = 'primary_phone';
    else if (k === 'email' || k === 'email_address' || k === 'primary_email') out[h] = 'primary_email';
    else if (k === 'name' || k === 'display_name' || k === 'full_name') out[h] = 'display_name';
    else if (k === 'first_name') out[h] = '_first_name';
    else if (k === 'last_name') out[h] = '_last_name';
    else if (k === 'city') out[h] = 'city';
    else if (k === 'country') out[h] = 'country';
    else if (k === 'locale' || k === 'language') out[h] = 'locale';
    else if (k === 'tags') out[h] = 'tags';
    else if (k === 'wix_id' || k === 'wix_contact_id') out[h] = 'wix_id';
    else if (k === 'opt_in_source' || k === 'source') out[h] = 'opt_in_source';
  }
  return out;
}

function mapRow(row, mapping) {
  const out = {};
  let firstName = null, lastName = null;
  for (const [csvCol, target] of Object.entries(mapping)) {
    if (!ALLOWED_TARGETS.has(target) && !['_first_name', '_last_name'].includes(target)) continue;
    const val = row[csvCol];
    if (val == null || val === '') continue;
    if (target === '_first_name') { firstName = String(val).trim(); continue; }
    if (target === '_last_name') { lastName = String(val).trim(); continue; }
    if (target === 'tags') {
      out._row_tags = String(val).split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    out[target] = String(val).trim();
  }
  if (!out.display_name && (firstName || lastName)) {
    out.display_name = [firstName, lastName].filter(Boolean).join(' ');
  }
  return out;
}

export async function get(id) {
  const { data, error } = await db().from('imports').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function list({ limit = 50, offset = 0 } = {}) {
  const ws = await getDefaultWorkspace();
  const { data, error, count } = await db().from('imports')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ws.id)
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { items: data || [], total: count || 0 };
}

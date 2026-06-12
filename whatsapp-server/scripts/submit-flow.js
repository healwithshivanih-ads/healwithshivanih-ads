#!/usr/bin/env node
// scripts/submit-flow.js
//
// Submit a WhatsApp Flow to Meta. Three steps Meta wants us to do in
// sequence:
//
//   1. POST /<waba-id>/flows                  → create the Flow record
//                                               (name, categories, endpoint?)
//   2. POST /<flow-id>/assets (multipart)     → upload the flow.json file
//   3. POST /<flow-id>                        → toggle DRAFT → PUBLISHED
//      (skip step 3 to keep it DRAFT for previewing in the Flow Builder)
//
// Reads `flow.json` from scripts/flows/<slug>.json. Flow metadata is
// declared inline in this file's FLOWS array.
//
// Usage:
//   node scripts/submit-flow.js                       # submit all flows
//   node scripts/submit-flow.js 40s-decade-jun11      # submit one by slug
//   node scripts/submit-flow.js --list                # show local flow defs
//   node scripts/submit-flow.js --check               # query live flows
//   node scripts/submit-flow.js --publish <slug>      # promote DRAFT → PUBLISHED
//
// Reads WHATSAPP_TOKEN + WHATSAPP_BUSINESS_ACCOUNT_ID from .env (or process.env
// if running inside the Fly container).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GRAPH_VERSION = 'v21.0';

// ---------------------------------------------------------------------------
// Flow definitions. One entry per flow. The `slug` matches the JSON file
// under scripts/flows/<slug>.json — keep them in sync.
// ---------------------------------------------------------------------------
const FLOWS = [
  {
    slug: '40s-decade-jun11',
    // Human-friendly name shown in Meta's Flow Builder + Ads UI.
    name: '40s decade · lead capture · Jun 11',
    // Meta categories: SIGN_UP / SIGN_IN / APPOINTMENT_BOOKING /
    // LEAD_GENERATION / SHOPPING / CONTACT_US / CUSTOMER_SUPPORT / SURVEY / OTHER.
    categories: ['LEAD_GENERATION'],
    // target: which WABA to register against. 'default' = WHATSAPP_BUSINESS_ACCOUNT_ID
    // (Ochre Tree, 89765). 'marketing' = MKT_WHATSAPP_BUSINESS_ACCOUNT_ID
    // (HealwithshivaniH, 88501).
    target: 'default',
    // No endpoint_uri — this is a "client-only" Flow. Completion fires the
    // standard WhatsApp inbound webhook with the form payload; we handle it
    // there. (Endpoint-style flows are for mid-flow server data exchange,
    // which we don't need.)
  },
  {
    slug: 'webinar-register-v1',
    // Human-friendly name shown in Meta's Flow Builder + Ads UI.
    name: 'Webinar registration · generic v1',
    categories: ['LEAD_GENERATION'],
    // Lives on the MARKETING WABA so it can be referenced by the
    // webinar_invite_v2 template's FLOW button. Same WHATSAPP_TOKEN
    // covers both WABAs (single System User), so just the WABA id
    // changes when target='marketing'.
    target: 'marketing',
    // Meta now requires endpoint_uri on every publishable Flow, even
    // client-only ones. Our generic flow endpoint just handles the
    // "ping" health check Meta sends — never serves real data exchange.
    endpoint_uri: 'https://whatsapp-server-shivani.fly.dev/whatsapp-flow-endpoint',
    // No endpoint_uri — same client-only pattern as 40s-decade. Workshop
    // info comes through flow_action_payload.data at send time and renders
    // on the WELCOME screen. Completion fires standard inbound webhook +
    // services/flow-completion routes by flow_token = 'webinar:{slug}'.
  },
  {
    // Sister to webinar-register-v1, published on the DEFAULT (Ochre Tree)
    // WABA. Same JSON content (the file is a literal copy). Needed because
    // Flows are scoped per-WABA — webinar_invite_v2_default's FLOW button
    // can only reference flows on its own WABA. JSON file lives at
    // scripts/flows/webinar-register-v1-default.json so the script reads
    // the right one.
    slug: 'webinar-register-v1-default',
    name: 'Webinar registration · generic v1 (Ochre Tree)',
    categories: ['LEAD_GENERATION'],
    target: 'default',
    endpoint_uri: 'https://whatsapp-server-shivani.fly.dev/whatsapp-flow-endpoint',
  },
];

// ---------------------------------------------------------------------------
// .env loader (no dep on dotenv).
// ---------------------------------------------------------------------------
function loadEnv() {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    return { ...process.env };
  }
  const envPath = resolve(ROOT, '.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    fail(`could not read ${envPath}`);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Graph API calls
// ---------------------------------------------------------------------------
async function createFlow(wabaId, token, def) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/flows`;
  const payload = {
    name: def.name,
    categories: def.categories,
    ...(def.endpoint_uri ? { endpoint_uri: def.endpoint_uri } : {}),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function uploadFlowJson(flowId, token, jsonContent) {
  // Meta wants this as multipart/form-data with `file` (the JSON blob),
  // `name` ("flow.json"), and `asset_type` ("FLOW_JSON").
  const form = new FormData();
  form.append('file', new Blob([jsonContent], { type: 'application/json' }), 'flow.json');
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${flowId}/assets`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function getFlow(flowId, token, fields = 'id,name,status,categories,validation_errors,preview') {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${flowId}?fields=${encodeURIComponent(fields)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function publishFlow(flowId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${flowId}/publish`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function listFlows(wabaId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/flows?fields=id,name,status,categories&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Meta returned ${res.status}: ${JSON.stringify(body)}`);
  return body.data || [];
}

function readFlowJson(slug) {
  const p = resolve(__dirname, 'flows', `${slug}.json`);
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    fail(`could not read scripts/flows/${slug}.json — ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log(`Local flow definitions (${FLOWS.length}):\n`);
  for (const f of FLOWS) {
    console.log(`  ${f.slug}`);
    console.log(`    name:       ${f.name}`);
    console.log(`    categories: ${f.categories.join(', ')}\n`);
  }
  process.exit(0);
}

const env = loadEnv();

/**
 * Per-target {WABA_ID, TOKEN} resolver. Honours the `target` field on each
 * FLOWS entry (default | marketing). Both targets share the same System User
 * token unless MKT_WHATSAPP_TOKEN is explicitly set.
 */
function resolveTarget(target) {
  if (!target || target === 'default') {
    return {
      wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      token: env.WHATSAPP_TOKEN,
      label: 'default (Ochre Tree / 89765)',
    };
  }
  if (target === 'marketing') {
    return {
      wabaId: env.MKT_WHATSAPP_BUSINESS_ACCOUNT_ID,
      token: env.MKT_WHATSAPP_TOKEN || env.WHATSAPP_TOKEN,
      label: 'marketing (HealwithshivaniH / 88501)',
    };
  }
  throw new Error(`Unknown flow target: ${target}`);
}

// Validate at startup that every target referenced by a FLOWS entry resolves.
const seenTargets = new Set(FLOWS.map((f) => f.target || 'default'));
for (const t of seenTargets) {
  const r = resolveTarget(t);
  if (!r.token) fail(`token missing for target "${t}" — set WHATSAPP_TOKEN${t === 'marketing' ? ' or MKT_WHATSAPP_TOKEN' : ''}`);
  if (!r.wabaId) fail(`WABA id missing for target "${t}" — set ${t === 'default' ? 'WHATSAPP_BUSINESS_ACCOUNT_ID' : 'MKT_WHATSAPP_BUSINESS_ACCOUNT_ID'}`);
}

// Legacy globals — kept for the --check / --publish paths which still
// operate on the default WABA. Per-flow ops use resolveTarget(def.target).
const TOKEN = env.WHATSAPP_TOKEN;
const WABA_ID = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
if (!TOKEN) fail('WHATSAPP_TOKEN missing from .env');
if (!WABA_ID) fail('WHATSAPP_BUSINESS_ACCOUNT_ID missing from .env');

if (args.includes('--check')) {
  const live = await listFlows(WABA_ID, TOKEN);
  const localSlugs = new Set(FLOWS.map((f) => f.name));
  const interesting = live
    .filter((f) => localSlugs.has(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (interesting.length === 0) {
    console.log('No matching flows live yet.');
  } else {
    console.log(`Live status for ${interesting.length} flow(s):\n`);
    for (const f of interesting) {
      console.log(`  ${f.name} [${f.id}] → ${f.status} (${(f.categories || []).join(', ')})`);
    }
  }
  process.exit(0);
}

if (args.includes('--publish')) {
  const slug = args[args.indexOf('--publish') + 1];
  if (!slug) fail('--publish needs a slug');
  const def = FLOWS.find((f) => f.slug === slug);
  if (!def) fail(`no local flow with slug ${slug}`);
  const t = resolveTarget(def.target);
  const live = await listFlows(t.wabaId, t.token);
  const match = live.find((f) => f.name === def.name);
  if (!match) fail(`flow "${def.name}" not found on Meta (${t.label}) — submit first`);
  console.log(`Publishing ${match.name} (${match.id}) on ${t.label} …`);
  const r = await publishFlow(match.id, t.token);
  if (r.ok) {
    console.log(`✓ published.`);
  } else {
    fail(`publish failed: ${JSON.stringify(r.body)}`);
  }
  process.exit(0);
}

// Default action: submit (create + upload) all listed flows or the named one.
const requested = args.filter((a) => !a.startsWith('-'));
const targets = requested.length
  ? FLOWS.filter((f) => requested.includes(f.slug))
  : FLOWS;
if (targets.length === 0) fail(`no flows matched: ${requested.join(', ')}`);

console.log(`Submitting ${targets.length} flow(s) …\n`);

// Cache per-WABA live-flow lists so we don't re-fetch for each entry.
const liveByWaba = new Map();
async function liveFor(t) {
  if (!liveByWaba.has(t.wabaId)) {
    liveByWaba.set(t.wabaId, await listFlows(t.wabaId, t.token));
  }
  return liveByWaba.get(t.wabaId);
}

for (const def of targets) {
  const t = resolveTarget(def.target);
  process.stdout.write(`  ${def.slug} → ${t.label} ... `);

  const live = await liveFor(t);
  let flowId;
  const existing = live.find((f) => f.name === def.name);
  if (existing) {
    flowId = existing.id;
    process.stdout.write(`(exists ${flowId}) `);
  } else {
    const created = await createFlow(t.wabaId, t.token, def);
    if (!created.ok) {
      console.log(`✗ create failed: ${JSON.stringify(created.body)}`);
      continue;
    }
    flowId = created.body.id;
    process.stdout.write(`(created ${flowId}) `);
  }

  const json = readFlowJson(def.slug);
  const uploaded = await uploadFlowJson(flowId, t.token, json);
  if (!uploaded.ok) {
    console.log(`✗ asset upload failed: ${JSON.stringify(uploaded.body)}`);
    continue;
  }

  // Fetch the validation errors + preview URL so the operator can verify
  // before flipping DRAFT → PUBLISHED.
  const info = await getFlow(flowId, TOKEN);
  const errs = info.body?.validation_errors || [];
  if (errs.length) {
    console.log(`✗ validation errors:\n    ${errs.map((e) => e.message || JSON.stringify(e)).join('\n    ')}`);
    continue;
  }
  const previewUrl = info.body?.preview?.preview_url;
  console.log(`✓ status=${info.body?.status} preview=${previewUrl || '(none)'}`);
}

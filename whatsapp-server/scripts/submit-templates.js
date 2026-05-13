#!/usr/bin/env node
// scripts/submit-templates.js
//
// Submit WhatsApp Cloud API message templates to Meta for review.
//
// Usage:
//   node scripts/submit-templates.js                    # submit all templates
//   node scripts/submit-templates.js appt_confirmation  # submit specific ones by name
//   node scripts/submit-templates.js --list             # list local template definitions
//   node scripts/submit-templates.js --check            # fetch live status from Meta
//
// Reads WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID from .env.
//
// To add a template: append to the TEMPLATES array below. Re-run the script.
// Already-submitted names skip with a notice (Meta rejects duplicates).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GRAPH_VERSION = 'v21.0';

// ---------------------------------------------------------------------------
// Template definitions. Edit/add here.
// ---------------------------------------------------------------------------
const TEMPLATES = [
  {
    name: 'appt_confirmation',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}! Your {{4}} session is confirmed for {{2}} at {{3}}. Looking forward to our session. — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },
  {
    name: 'appt_reminder_24h',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, just a quick reminder — your {{4}} session is tomorrow ({{2}}) at {{3}}. See you then! — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },
  {
    name: 'appt_reminder_2h',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, your {{4}} session is in 2 hours — at {{3}} today. See you soon! — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },
];

// ---------------------------------------------------------------------------
// .env loader (no dep on dotenv — keeps the script self-contained)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    fail(`could not read ${envPath} — is the project root correct?`);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
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
async function submitOne(wabaId, token, tpl) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`;
  const payload = {
    name: tpl.name,
    category: tpl.category,
    language: tpl.language,
    components: [
      {
        type: 'BODY',
        text: tpl.body,
        ...(tpl.example ? { example: { body_text: tpl.example } } : {}),
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function listLive(wabaId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=100&fields=name,language,status,category,components`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Meta returned ${res.status}: ${JSON.stringify(body)}`);
  return body.data || [];
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log(`Local template definitions (${TEMPLATES.length}):\n`);
  for (const t of TEMPLATES) {
    console.log(`  ${t.name}  [${t.category}, ${t.language}]`);
    console.log(`    ${t.body}\n`);
  }
  process.exit(0);
}

const env = loadEnv();
const TOKEN = env.WHATSAPP_TOKEN;
const WABA_ID = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
if (!TOKEN) fail('WHATSAPP_TOKEN missing from .env');
if (!WABA_ID) fail('WHATSAPP_BUSINESS_ACCOUNT_ID missing from .env');

if (args.includes('--check')) {
  const live = await listLive(WABA_ID, TOKEN);
  const localNames = new Set(TEMPLATES.map((t) => t.name));
  const interesting = live
    .filter((t) => localNames.has(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (interesting.length === 0) {
    console.log('No matching templates found on Meta yet.');
  } else {
    console.log(`Live status for ${interesting.length} template(s):\n`);
    for (const t of interesting) {
      console.log(`  ${t.name}  [${t.language}]  →  ${t.status}`);
    }
  }
  process.exit(0);
}

// Selection: any non-flag args become a name filter
const requested = args.filter((a) => !a.startsWith('-'));
const targets = requested.length
  ? TEMPLATES.filter((t) => requested.includes(t.name))
  : TEMPLATES;

if (targets.length === 0) {
  fail(`no templates matched: ${requested.join(', ')}`);
}

console.log(`Submitting ${targets.length} template(s) to WABA ${WABA_ID}...\n`);

const results = [];
for (const tpl of targets) {
  process.stdout.write(`  ${tpl.name} ... `);
  try {
    const r = await submitOne(WABA_ID, TOKEN, tpl);
    if (r.ok) {
      console.log(`✓ ${r.body.id || ''} (${r.body.status || 'queued'})`);
      results.push({ name: tpl.name, ok: true, id: r.body.id, status: r.body.status });
    } else {
      const errMsg = r.body?.error?.message || JSON.stringify(r.body);
      console.log(`✗ ${r.status} — ${errMsg}`);
      results.push({ name: tpl.name, ok: false, status: r.status, error: errMsg });
    }
  } catch (e) {
    console.log(`✗ network error — ${e.message}`);
    results.push({ name: tpl.name, ok: false, error: e.message });
  }
}

const okCount = results.filter((r) => r.ok).length;
const failCount = results.length - okCount;
console.log(`\n${okCount} submitted, ${failCount} failed.`);
if (failCount > 0) {
  console.log('\nCommon errors:');
  console.log('  • "Template name already exists" → already submitted; check with --check');
  console.log('  • "Invalid parameter" → body variable count mismatch with example array');
  console.log('  • "Permission denied" → token lacks whatsapp_business_management scope');
  process.exit(1);
}

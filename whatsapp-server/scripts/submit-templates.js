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
  // ── Appointment templates (existing on WABA) ───────────────────────────────
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

  // ── FM coach manual templates (Message Templates panel on client page) ─────
  {
    name: 'fm_lab_reminder',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{2}}. Please share the report at least 2 days before our appointment. 🙏',
    example: [['Priya', 'TSH, Vitamin D, Ferritin']],
  },
  {
    name: 'fm_supplement_instructions',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, here are your supplement instructions for this week: {{2}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊',
    example: [['Priya', 'Magnesium glycinate 200mg before bed; B-complex with breakfast']],
  },
  {
    name: 'fm_session_confirm',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, confirming our session on {{2}} at {{3}}. Please come prepared with your food journal and any new lab reports. See you then! 📋',
    example: [['Priya', '15 May 2026', '5:00 PM']],
  },
  {
    name: 'fm_encouragement',
    category: 'UTILITY',
    language: 'en',
    body: "Hi {{1}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{2}}. Rooting for you! 💚",
    example: [['Priya', 'your morning routine and consistent sleep']],
  },
  {
    name: 'fm_checkin_nudge',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, just checking in! How are you feeling on the protocol? Any changes in {{2}}? Would love to hear how things are going. 🌿',
    example: [['Priya', 'energy or digestion']],
  },

  // ── FM coach automated templates (cron / dashboard) ────────────────────────
  {
    name: 'fm_start_date_check_v1',
    category: 'UTILITY',
    language: 'en',
    body: "Hi {{1}} 👋 Quick check-in from Shivani — have you started your plan yet? If yes, just reply with the date you began (e.g. 'Started 19 May'). If you'd like more time, no rush!",
    example: [['Priya']],
  },

  // Weekly poll templates — each has 3 quick-reply buttons. Button labels
  // MUST match POLL_BUTTON_LABELS in src/lib/server-actions/weekly-poll.ts
  // so the webhook parser can map a button click back to a structured score.
  {
    name: 'fm_weekly_check_in_v1',
    category: 'UTILITY',
    language: 'en',
    body: "Hi {{1}} 👋 Quick weekly check-in from Shivani. How's it going overall this week?",
    example: [['Priya']],
    // Meta rejects emojis / variables / newlines / formatting in button text.
    // The parser in `lib/poll-labels.ts` uses .includes("all good") so dropping
    // the 🌿 doesn't break webhook classification.
    buttons: ['All good', 'Some struggles', 'Need help'],
  },
  {
    name: 'fm_weekly_supplement_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, how are the supplements going this week?',
    example: [['Priya']],
    buttons: ['All taken', 'Missed 1-2 days', 'Stopped'],
  },
  {
    name: 'fm_weekly_meals_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, sticking to the meal plan this week?',
    example: [['Priya']],
    buttons: ['Yes mostly', 'Half the time', 'Struggling'],
  },
  {
    name: 'fm_weekly_movement_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, movement this week?',
    example: [['Priya']],
    buttons: ['Most days', 'A few times', 'None'],
  },
];

// ---------------------------------------------------------------------------
// .env loader (no dep on dotenv — keeps the script self-contained)
// ---------------------------------------------------------------------------
function loadEnv() {
  // If the required vars are already in process.env (e.g. running inside the
  // Fly container where they're injected as secrets), skip the .env file.
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    return { ...process.env };
  }
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
  const components = [
    {
      type: 'BODY',
      text: tpl.body,
      ...(tpl.example ? { example: { body_text: tpl.example } } : {}),
    },
  ];
  // Quick-reply buttons (max 3 per template per Meta spec).
  if (Array.isArray(tpl.buttons) && tpl.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: tpl.buttons.slice(0, 3).map((label) => ({
        type: 'QUICK_REPLY',
        text: String(label).slice(0, 25), // Meta hard limit
      })),
    });
  }
  const payload = {
    name: tpl.name,
    category: tpl.category,
    language: tpl.language,
    components,
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
    console.log(`    ${t.body}`);
    if (t.buttons) console.log(`    buttons: ${t.buttons.join(' | ')}`);
    console.log();
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

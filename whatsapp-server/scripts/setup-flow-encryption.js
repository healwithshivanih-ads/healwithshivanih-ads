#!/usr/bin/env node
// scripts/setup-flow-encryption.js
//
// One-time setup: register a public encryption key with Meta so we can
// publish WhatsApp Flows. Meta encrypts Flow data with this public key
// in transit; the matching private key would be needed if we ever build
// "endpoint-style" Flows (server data exchange mid-flow). Our 40s-decade
// flow is client-only — we'll never need to decrypt — but Meta requires
// the key to exist before any Flow can be published.
//
// What this script does:
//   1. Generate RSA-2048 key pair locally
//   2. Print the private key + passphrase (operator copies them into Fly
//      secrets WHATSAPP_FLOWS_PRIVATE_KEY + WHATSAPP_FLOWS_PASSPHRASE so
//      they survive process restarts)
//   3. POST the public key to /<phone_number_id>/whatsapp_business_encryption
//   4. GET the same endpoint to verify the public key was accepted
//
// Idempotent: re-running uploads a fresh key. Existing flows continue
// using whatever key was active when they were created (Meta rotates
// gracefully).
//
// Usage:
//   node scripts/setup-flow-encryption.js

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GRAPH_VERSION = 'v21.0';

function loadEnv() {
  if (process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID) return { ...process.env };
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

const env = loadEnv();
// Allow --target=marketing to register the key against the MKT phone
// (88501 / HealwithshivaniH) instead of the default 89765. Each phone
// number on the WABA needs its own public key registered before Flows
// can publish through it.
const args = process.argv.slice(2);
const targetArg = (args.find((a) => a.startsWith('--target=')) || '').slice('--target='.length);
const target = targetArg || 'default';
const TOKEN = env.WHATSAPP_TOKEN;
const PHONE = target === 'marketing'
  ? env.MKT_PHONE_NUMBER_ID
  : env.PHONE_NUMBER_ID;
if (!TOKEN || !PHONE) {
  console.error(`✗ need WHATSAPP_TOKEN + ${target === 'marketing' ? 'MKT_PHONE_NUMBER_ID' : 'PHONE_NUMBER_ID'} in .env`);
  process.exit(1);
}
console.log(`Registering Flow encryption key against ${target} phone (${PHONE})…\n`);

// 1. Generate fresh RSA-2048 key pair. Private key is encrypted with a
//    random passphrase — Meta requires PKCS#8 encrypted PEM format.
const passphrase = env.WHATSAPP_FLOWS_PASSPHRASE || randomBytes(24).toString('hex');
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
});

console.log('\n=== KEY PAIR GENERATED ===\n');
console.log('Add these to Fly secrets:\n');
console.log('flyctl secrets set -a whatsapp-server-shivani \\');
console.log(`  WHATSAPP_FLOWS_PASSPHRASE='${passphrase}' \\`);
console.log("  WHATSAPP_FLOWS_PRIVATE_KEY='" + privateKey.replace(/\n/g, '\\n') + "'\n");
console.log('(The private key is only needed if we add endpoint-style Flows later.\n' +
  ' Client-only flows like 40s-decade-jun11 never use it. Keep it safe anyway.)\n');

// 2. Upload public key to Meta.
console.log('Uploading public key to Meta…');
const form = new URLSearchParams();
form.append('business_public_key', publicKey);

const res = await fetch(
  `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE}/whatsapp_business_encryption`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  },
);
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('✗ upload failed:', JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log('✓ accepted:', JSON.stringify(body));

// 3. Verify
const verify = await fetch(
  `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE}/whatsapp_business_encryption`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
const vbody = await verify.json().catch(() => ({}));
console.log('\n=== VERIFY ===\n');
console.log(JSON.stringify(vbody, null, 2));

#!/usr/bin/env node
// Add an IMAGE header to an existing approved WhatsApp template.
//
// Meta's IMAGE-header templates need a "sample" media handle at approval
// time — a real image stays in the preview Meta shows reviewers. Real
// broadcasts upload their own media per-send at the messaging layer
// (via image.link or media.id). The sample image is one-time setup.
//
// The 3-step dance:
//   1. POST /<APP_ID>/uploads?file_length=N&file_type=image/jpeg
//      → returns `{id: "upload:..."}`
//   2. POST that upload session with the file bytes
//      Authorization: OAuth <ACCESS_TOKEN>     (NOT Bearer — OAuth scheme)
//      → returns `{h: "<media handle>"}`
//   3. PATCH /<TEMPLATE_ID> with components including HEADER format=IMAGE
//      and example.header_handle = [h]
//
// Re-running this script with the same image just uploads a fresh handle
// and overrides the template header — Meta is happy with that.
//
// Usage:
//   node scripts/add-image-header.mjs \
//     --template-id <id> \
//     --image-url https://... \
//     --app-id <id> \
//     [--mime image/jpeg]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GRAPH_VERSION = 'v21.0';

function loadEnv() {
  if (process.env.WHATSAPP_TOKEN) return { ...process.env };
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : [],
  ),
);
if (!args['template-id'] || !args['image-url'] || !args['app-id']) {
  console.error('usage: add-image-header.mjs --template-id <id> --image-url <url> --app-id <id> [--mime image/jpeg]');
  process.exit(1);
}

const env = loadEnv();
const TOKEN = env.WHATSAPP_TOKEN;
const MIME = args.mime || 'image/jpeg';

// 1. Fetch the image bytes from a URL.
console.log(`Fetching ${args['image-url']}…`);
const imgRes = await fetch(args['image-url']);
if (!imgRes.ok) {
  console.error(`✗ image fetch failed: HTTP ${imgRes.status}`);
  process.exit(1);
}
const imgBuf = Buffer.from(await imgRes.arrayBuffer());
console.log(`✓ got ${imgBuf.length} bytes`);

// 2. Open an upload session.
const sessionUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${args['app-id']}/uploads`
  + `?file_length=${imgBuf.length}&file_type=${encodeURIComponent(MIME)}`;
console.log(`Opening upload session…`);
const sessionRes = await fetch(sessionUrl, {
  method: 'POST',
  headers: { Authorization: `OAuth ${TOKEN}` },
});
const sessionBody = await sessionRes.json();
if (!sessionRes.ok) {
  console.error('✗ open session failed:', JSON.stringify(sessionBody, null, 2));
  process.exit(1);
}
const uploadId = sessionBody.id;
console.log(`✓ session ${uploadId}`);

// 3. Upload the bytes. Meta uses the funny `OAuth` scheme (NOT Bearer)
//    and file_offset=0 (header on first chunk only).
console.log(`Uploading ${imgBuf.length} bytes…`);
const upRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${uploadId}`, {
  method: 'POST',
  headers: {
    Authorization: `OAuth ${TOKEN}`,
    file_offset: '0',
  },
  body: imgBuf,
});
const upBody = await upRes.json();
if (!upRes.ok || !upBody.h) {
  console.error('✗ upload failed:', JSON.stringify(upBody, null, 2));
  process.exit(1);
}
const handle = upBody.h;
console.log(`✓ media handle: ${handle.slice(0, 40)}…`);

// 4. Fetch the template's current components so we can PATCH back the
//    HEADER component alongside the existing BODY/FOOTER/BUTTONS.
console.log(`Fetching current template components…`);
const tplRes = await fetch(
  `https://graph.facebook.com/${GRAPH_VERSION}/${args['template-id']}`
  + `?fields=name,status,components`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
const tplBody = await tplRes.json();
if (!tplRes.ok) {
  console.error('✗ fetch template failed:', JSON.stringify(tplBody, null, 2));
  process.exit(1);
}
console.log(`✓ template "${tplBody.name}" (${tplBody.status}) — ${tplBody.components.length} components`);

// Drop any existing HEADER (we're replacing it) and prepend a fresh
// IMAGE one. Order matters: HEADER → BODY → FOOTER → BUTTONS.
const nonHeader = tplBody.components.filter((c) => c.type !== 'HEADER');
const components = [
  { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
  ...nonHeader,
];

// 5. PATCH the template with the new components array.
console.log(`Patching template ${args['template-id']}…`);
const patchRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${args['template-id']}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ components }),
});
const patchBody = await patchRes.json();
if (!patchRes.ok) {
  console.error('✗ patch failed:', JSON.stringify(patchBody, null, 2));
  process.exit(1);
}
console.log(`✓ patched. Result: ${JSON.stringify(patchBody)}`);
console.log(`\nTemplate will move to PENDING for re-review (~1-24h for IMAGE-header MARKETING).`);

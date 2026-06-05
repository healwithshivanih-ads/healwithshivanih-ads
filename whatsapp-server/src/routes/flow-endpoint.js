// POST /whatsapp-flow-endpoint
//
// Meta WhatsApp Flow data-exchange endpoint. Required for any published
// Flow regardless of whether it actually does mid-flow data exchange. For
// our use case (client-only flows that just collect form data + fire
// completion), Meta only ever pings this endpoint as a health check
// before allowing publish, and again periodically thereafter.
//
// Protocol (hybrid encryption per Meta's spec):
//   1. Meta sends POST with body
//        { encrypted_flow_data, encrypted_aes_key, initial_vector }
//      all base64.
//   2. We decrypt encrypted_aes_key with our RSA private key
//      (WHATSAPP_FLOWS_PRIVATE_KEY, passphrase WHATSAPP_FLOWS_PASSPHRASE)
//      → 16-byte AES session key.
//   3. We decrypt encrypted_flow_data with AES-128-GCM using that key
//      + initial_vector → JSON { action, screen?, data?, flow_token, version }.
//   4. Compute response based on `action`:
//        - "ping" → { data: { status: "active" } }
//        - anything else → return version-only ack (we don't do mid-flow
//          data exchange so there's nothing meaningful to compute).
//   5. Encrypt the response with the same AES key but INVERTED initial
//      vector (Meta's spec — each byte XOR'd with 0xFF). Return as
//      base64 in the response body.
//   6. Status code: 200 always (Meta retries on 4xx/5xx).
//
// Public route: NOT under /api/* so it bypasses adminAuth. Meta sends
// the request with no auth header — verification is by signature
// (X-Hub-Signature-256) but for Flow endpoints we additionally rely on
// the encryption itself (only Meta has our public key, only we have
// our private key).

import { Router } from 'express';
import express from 'express';
import {
  createPrivateKey,
  privateDecrypt,
  createDecipheriv,
  createCipheriv,
  constants as cryptoConstants,
} from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const flowEndpointRouter = Router();
flowEndpointRouter.use(express.json({ limit: '256kb' }));

/**
 * Load all configured private keys, newest/preferred first. Each entry is
 * a (suffix, pem, passphrase) tuple. We try them in order when decrypting
 * — handles the multi-WABA case where each phone number has its own
 * registered public key (e.g. main 89765 + marketing 88501).
 *
 * Env var pattern (suffix _MKT etc. added per new phone):
 *   WHATSAPP_FLOWS_PRIVATE_KEY      / WHATSAPP_FLOWS_PASSPHRASE      (default)
 *   WHATSAPP_FLOWS_PRIVATE_KEY_MKT  / WHATSAPP_FLOWS_PASSPHRASE_MKT  (marketing)
 */
function loadPrivateKeys() {
  const keys = [];
  // Try marketing key FIRST — most recent registration, so a new Flow
  // publish health-check will encrypt with this key.
  const mktPem = process.env.WHATSAPP_FLOWS_PRIVATE_KEY_MKT;
  const mktPass = process.env.WHATSAPP_FLOWS_PASSPHRASE_MKT;
  if (mktPem && mktPass) {
    const normalised = mktPem.includes('\\n') ? mktPem.replace(/\\n/g, '\n') : mktPem;
    try {
      keys.push({
        label: 'mkt',
        privateKey: createPrivateKey({ key: normalised, format: 'pem', passphrase: mktPass }),
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'mkt private key parse failed');
    }
  }
  // Fall back to legacy/default key.
  const pem = process.env.WHATSAPP_FLOWS_PRIVATE_KEY;
  const passphrase = process.env.WHATSAPP_FLOWS_PASSPHRASE;
  if (pem && passphrase) {
    const normalised = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
    try {
      keys.push({
        label: 'default',
        privateKey: createPrivateKey({ key: normalised, format: 'pem', passphrase }),
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'default private key parse failed');
    }
  }
  if (keys.length === 0) throw new Error('no Flow private keys configured');
  return keys;
}

function decryptRequest(body) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    throw new Error('missing encrypted fields');
  }

  // 1. Decrypt the AES session key with whichever RSA private key matches
  //    the public key Meta encrypted under. Try all configured keys in
  //    priority order; first one that decrypts wins. OAEP+SHA256 is Meta's
  //    default padding.
  const keys = loadPrivateKeys();
  let aesKey = null;
  let lastErr = null;
  for (const { label, privateKey } of keys) {
    try {
      aesKey = privateDecrypt(
        {
          key: privateKey,
          padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(encrypted_aes_key, 'base64'),
      );
      logger.debug({ keyLabel: label }, 'flow-endpoint: decrypted with key');
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!aesKey) throw lastErr || new Error('all private keys failed to decrypt');

  // 2. Decrypt the flow data with AES-128-GCM. Meta appends the 16-byte
  //    auth tag to the ciphertext, so split it off.
  const fullBuf = Buffer.from(encrypted_flow_data, 'base64');
  const TAG_LEN = 16;
  const encrypted = fullBuf.subarray(0, fullBuf.length - TAG_LEN);
  const authTag = fullBuf.subarray(fullBuf.length - TAG_LEN);

  const iv = Buffer.from(initial_vector, 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return { plaintext: JSON.parse(decrypted.toString('utf8')), aesKey, iv };
}

function encryptResponse(responseJson, aesKey, iv) {
  // Invert the IV per Meta's spec: each byte XOR'd with 0xFF.
  const flippedIv = Buffer.from(iv.map((b) => b ^ 0xff));
  const cipher = createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responseJson), 'utf8'),
    cipher.final(),
  ]);
  // Meta wants base64(ciphertext || authTag).
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
}

flowEndpointRouter.post('/', async (req, res) => {
  try {
    const { plaintext, aesKey, iv } = decryptRequest(req.body || {});
    const action = plaintext?.action;
    logger.info({ action, screen: plaintext?.screen }, 'flow endpoint hit');

    // For our client-only flow (40s-decade-jun11), only `ping` is expected
    // from Meta — they health-check before publish + periodically. Future
    // endpoint-style flows would handle INIT / data_exchange / BACK here.
    let response;
    if (action === 'ping') {
      response = { data: { status: 'active' } };
    } else {
      // Minimal version-only ack — keeps Meta happy without us actually
      // doing anything mid-flow.
      response = { version: plaintext?.version || '3.0', data: {} };
    }

    const encrypted = encryptResponse(response, aesKey, iv);
    // Meta wants the encrypted base64 string as the entire response body
    // (NOT JSON-wrapped). Content-Type can be text/plain.
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(encrypted);
  } catch (e) {
    logger.error({ err: e.message }, 'flow endpoint decrypt/encrypt failed');
    // 421 tells Meta the request couldn't be processed (often a key
    // rotation issue). 4xx triggers a retry from Meta's side.
    return res.status(421).send('');
  }
});

// GET for sanity check. Returns a small status JSON so the operator can
// verify the route is mounted + the keys load without errors.
flowEndpointRouter.get('/', (_req, res) => {
  try {
    loadPrivateKey();
    res.json({ ok: true, status: 'ready', note: 'POST encrypted Flow data to this URL' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

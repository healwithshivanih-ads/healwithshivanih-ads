// AES-256-GCM helpers for encrypting integration credentials at rest
// (Wix OAuth tokens in Round 2). The key lives in INTEGRATION_ENCRYPTION_KEY,
// 32 raw bytes encoded as base64.
//
// Storage format (stringified): "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>"

import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function getKey() {
  if (!config.integrationEncryptionKey) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY not set — required for encrypt/decrypt');
  }
  const raw = Buffer.from(config.integrationEncryptionKey, 'base64');
  if (raw.length !== 32) {
    throw new Error(`INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes, got ${raw.length}`);
  }
  return raw;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const parts = String(ciphertext).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('decrypt: bad ciphertext format');
  }
  const [, ivB64, tagB64, encB64] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/** Encrypt an object to a string (JSON → AES-GCM). */
export function encryptJSON(obj) {
  return encrypt(JSON.stringify(obj));
}

/** Decrypt a string (produced by encryptJSON) back to an object. */
export function decryptJSON(ciphertext) {
  const s = decrypt(ciphertext);
  return s == null ? null : JSON.parse(s);
}

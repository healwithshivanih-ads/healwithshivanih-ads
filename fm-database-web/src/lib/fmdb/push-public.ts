/**
 * Web-push VAPID PUBLIC key + client-safe helpers.
 *
 * The public key is, by design, public — it ships to every browser as the
 * `applicationServerKey`. Keeping it as a code constant (rather than a
 * NEXT_PUBLIC_* env var) sidesteps the Fly remote-build problem where
 * NEXT_PUBLIC vars must be present at *build* time. The matching PRIVATE key
 * lives only in VAPID_PRIVATE_KEY (server env / Fly secret) — never here.
 *
 * This module is import-safe from client components (no node imports).
 */
export const VAPID_PUBLIC_KEY =
  "BH5tlyyug1yZBp8z95izbj-JmsvYZvbX5fMGcU6zeU9GIz-V9Ow6cvaoHgYqS5TWvaqV0MiFZ6v5g_VGpQzxsdU";

/** VAPID base64url public key → Uint8Array for PushManager.subscribe(). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

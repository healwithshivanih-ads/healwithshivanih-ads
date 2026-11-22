"use client";

/**
 * "Save for offline" for course tracks.
 *
 * The file is fetched once through a short-lived link and kept in Cache
 * Storage on the phone under a stable, origin-local key that carries the
 * audio revision (`/course-offline/calm-gut/d1/s3-music.m4a`), so a
 * re-recorded track is a new key and the old copy is simply not used.
 *
 * Playback reads the cached file back as a Blob and plays an object URL.
 * Why not have the service worker answer the request (with Range slicing)?
 * The worker is registered at /ochre-app/ for push, and a worker only sees
 * requests from pages inside its scope; /app/<token> is outside it. Widening
 * the scope means a new registration, which would drop every existing push
 * subscription. A blob: URL is served from memory in one piece, so iOS has
 * no range requests to make and plays it as is.
 *
 * Nothing here is shared: Cache Storage is per phone, per site.
 */

import type { CourseVersion, PlayerTrack } from "./course-player";

const CACHE = "ochre-course-audio-v1";

export function offlineKey(t: Pick<PlayerTrack, "courseSlug" | "id" | "rev">, v: CourseVersion): string {
  return `/course-offline/${t.courseSlug}/${t.rev}/${t.id}-${v}.m4a`;
}

export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

async function open(): Promise<Cache | null> {
  if (!offlineSupported()) return null;
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // private mode / storage blocked
  }
}

export async function isSavedOffline(t: PlayerTrack, v: CourseVersion): Promise<boolean> {
  const c = await open();
  if (!c) return false;
  return !!(await c.match(offlineKey(t, v)));
}

/** An object URL for the saved copy, or null when there is none. */
export async function offlineBlobUrl(t: PlayerTrack, v: CourseVersion): Promise<string | null> {
  const c = await open();
  if (!c) return null;
  const res = await c.match(offlineKey(t, v));
  if (!res) return null;
  try {
    const blob = await res.blob();
    if (!blob.size) return null;
    // Some browsers drop the type from a cached body; audio needs it.
    const typed = blob.type ? blob : new Blob([blob], { type: "audio/mp4" });
    return URL.createObjectURL(typed);
  } catch {
    return null;
  }
}

/**
 * Download and keep one track version. `getLink` returns a fresh short-lived
 * URL. Reports progress 0–1 when the server sends a length.
 */
export async function saveOffline(
  t: PlayerTrack,
  v: CourseVersion,
  getLink: () => Promise<string>,
  onProgress?: (f: number) => void,
): Promise<void> {
  const c = await open();
  if (!c) throw new Error("This phone can't keep audio offline.");
  // Ask the browser not to clear our storage under pressure (best-effort).
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not granted — still works, may be evicted */
  }
  const url = await getLink();
  const res = await fetch(url);
  if (!res.ok || res.type === "opaque") throw new Error("Download failed. Try again on Wi-Fi.");
  const total = Number(res.headers.get("content-length")) || 0;
  let body: Blob;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    body = new Blob(chunks as BlobPart[], { type: "audio/mp4" });
  } else {
    body = await res.blob();
  }
  await c.put(
    offlineKey(t, v),
    new Response(body, { headers: { "Content-Type": "audio/mp4", "Content-Length": String(body.size) } }),
  );
  onProgress?.(1);
}

export async function removeOffline(t: PlayerTrack, v: CourseVersion): Promise<void> {
  const c = await open();
  await c?.delete(offlineKey(t, v));
}

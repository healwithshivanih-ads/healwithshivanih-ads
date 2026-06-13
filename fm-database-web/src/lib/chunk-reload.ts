/**
 * Stale-chunk recovery, shared by the render error boundary (global-error.tsx)
 * and the window-level guard (app/[token] ChunkGuard).
 *
 * Why this exists: the client app is a long-lived installed PWA (home-screen
 * icon, no service worker). When we deploy while a client has it open, the
 * App Router lazy-loads a chunk by the OLD build's manifest; the asset has
 * been swapped underneath the open tab, so the load throws "Failed to load
 * chunk …". The HTML itself is `no-store`, so a single reload always pulls the
 * current build and fixes it.
 *
 * The render boundary only catches errors thrown DURING render. Background
 * prefetch / dynamic-import failures surface as window 'error' / promise
 * 'unhandledrejection' instead — the guard covers those. Both funnel through
 * maybeReloadForChunkError so a single shared cooldown prevents reload loops
 * and double-reloads across the two mechanisms.
 */

const CHUNK_RE =
  /Failed to load chunk|Loading chunk [\w-]+ failed|ChunkLoadError|fetch(?:ing)? dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(input: unknown): boolean {
  if (!input) return false;
  const msg =
    typeof input === "string"
      ? input
      : (input as { message?: string })?.message || String(input);
  return CHUNK_RE.test(msg);
}

const KEY = "fm-chunk-reload-at";
const COOLDOWN_MS = 10_000;

/**
 * Reload once to pick up the new build. Returns "suppressed" when a reload
 * happened within the cooldown — i.e. we already reloaded and the chunk is
 * STILL failing, which means a genuinely broken build, not just a stale tab.
 * In that case the caller should show its error UI instead of looping.
 */
export function maybeReloadForChunkError(): "reloading" | "suppressed" {
  if (typeof window === "undefined") return "suppressed";
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(KEY) || 0);
  } catch {
    /* sessionStorage may be unavailable (private mode) — fall through */
  }
  const now = Date.now();
  if (last && now - last < COOLDOWN_MS) return "suppressed";
  try {
    window.sessionStorage.setItem(KEY, String(now));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return "reloading";
}

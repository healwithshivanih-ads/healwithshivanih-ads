import "server-only";

/**
 * Retry transient filesystem errors on ~/fm-plans reads.
 *
 * ~/fm-plans resolves through iCloud Drive, whose FileProvider intermittently
 * returns EAGAIN (errno -11) — and serves reads slowly (~1s/file) — under sync
 * contention. A single such error would otherwise throw straight out of a server
 * component and 500 the page. We retry the transient codes with capped
 * exponential backoff long enough to ride out a contention spike (~6s total per
 * call); genuine errors (ENOENT etc.) are NOT retried — the caller handles them.
 *
 * This is a band-aid for the iCloud dependency; the durable fix is moving
 * ~/fm-plans onto a local disk (see reference-fm-plans-icloud-eagain memory).
 */
const TRANSIENT_FS = new Set(["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "EWOULDBLOCK", "ETIMEDOUT", "EINTR"]);

export async function withFsRetry<T>(op: () => Promise<T>, attempts = 10): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_FS.has(code) || i === attempts - 1) throw err;
      lastErr = err;
      // 80,160,320,640,800,800,… ms — capped; ~6s total across 10 attempts.
      const delay = Math.min(800, 80 * 2 ** i) + Math.floor(Math.random() * 40);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

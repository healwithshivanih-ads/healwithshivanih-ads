/**
 * Persisted per-token daily rate limiter for the public client-app write APIs.
 *
 * Replaces the per-route in-memory `Map` counters that reset on every process
 * restart (and would not survive a redeploy). State is held in-process for
 * speed AND mirrored to a single JSON sidecar under the plans root so the
 * count survives a restart of the single coach/Fly instance.
 *
 * Scope note: this app runs as ONE instance per surface (PM2 on the Mac, one
 * Fly machine), so a file sidecar is sufficient — no cross-instance store is
 * needed. The in-memory map is authoritative during a process's lifetime; the
 * file is the durability backup, loaded once on cold start.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { getPlansRoot } from "./paths";

type Entry = { day: string; count: number };

// bucket -> token -> { day, count }
const mem = new Map<string, Map<string, Entry>>();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function sidecarPath(): string {
  return path.join(getPlansRoot(), "_rate_limits.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fs.readFile(sidecarPath(), "utf-8");
        const parsed = JSON.parse(raw) as Record<string, Record<string, Entry>>;
        const day = today();
        for (const [bucket, tokens] of Object.entries(parsed)) {
          const m = new Map<string, Entry>();
          for (const [tok, e] of Object.entries(tokens)) {
            // Drop entries from previous days on load — they're irrelevant.
            if (e && typeof e.count === "number" && e.day === day) m.set(tok, e);
          }
          if (m.size) mem.set(bucket, m);
        }
      } catch {
        // No sidecar yet, or unreadable/corrupt — start from an empty slate.
        // Fail-open here is correct: a missing counter file must not lock
        // legitimate clients out of their own app.
      }
      loaded = true;
    })();
  }
  await loadPromise;
}

function snapshot(): Record<string, Record<string, Entry>> {
  const out: Record<string, Record<string, Entry>> = {};
  for (const [bucket, m] of mem) {
    const tokens: Record<string, Entry> = {};
    for (const [tok, e] of m) tokens[tok] = e;
    out[bucket] = tokens;
  }
  return out;
}

async function persist(): Promise<void> {
  const data = JSON.stringify(snapshot());
  // Serialize writes so concurrent requests can't interleave a half-written
  // sidecar; each write is atomic (tmp + rename).
  writeChain = writeChain
    .then(async () => {
      const p = sidecarPath();
      const tmp = `${p}.tmp-${process.pid}`;
      try {
        await fs.writeFile(tmp, data, "utf-8");
        await fs.rename(tmp, p);
      } catch (err) {
        console.error("[rate-limit] persist failed:", err);
        try {
          await fs.unlink(tmp);
        } catch {
          /* tmp may not exist */
        }
      }
    })
    .catch(() => {
      /* never let a persist failure reject the chain */
    });
  return writeChain;
}

/**
 * Record one hit for `token` in `bucket` and report whether it is within the
 * daily `limit`. The first `limit` calls in a day return `ok: true`; call
 * number `limit + 1` is the first to return `ok: false`.
 *
 * The in-memory increment is synchronous (no await between read and write of
 * the map), so the decision is race-free within a process. The durable write
 * is awaited so the count is on disk before the route responds.
 */
export async function allowDaily(
  bucket: string,
  token: string,
  limit: number,
): Promise<{ ok: boolean; count: number }> {
  await ensureLoaded();
  const day = today();
  let m = mem.get(bucket);
  if (!m) {
    m = new Map<string, Entry>();
    mem.set(bucket, m);
  }
  const cur = m.get(token);
  let count: number;
  if (!cur || cur.day !== day) {
    count = 1;
    m.set(token, { day, count });
  } else {
    count = cur.count + 1;
    cur.count = count;
  }
  await persist();
  return { ok: count <= limit, count };
}

/** Test-only: clear in-memory state so a fresh sidecar path is re-read. */
export function __resetForTests(): void {
  mem.clear();
  loaded = false;
  loadPromise = null;
  writeChain = Promise.resolve();
}

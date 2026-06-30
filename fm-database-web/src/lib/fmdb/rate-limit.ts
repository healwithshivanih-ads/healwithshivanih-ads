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
 *
 * Abuse hardening (2026): the public app routes call this with their bearer
 * token, sometimes BEFORE the token is validated. Two safeguards keep that
 * from being a lever:
 *   1. Keys are HASHED (sha256) before storing — the raw bearer token never
 *      lands in the sidecar, so a leaked/dumped file exposes no secrets and an
 *      attacker can't seed recognisable keys.
 *   2. Each bucket is capped at FMDB_RATE_LIMIT_MAX_KEYS distinct keys/day
 *      (default 2000). Past the cap we fail OPEN — a flood of distinct
 *      attacker-supplied tokens can't grow the file without bound, and can't
 *      lock real clients out either. snapshot() also prunes to the current day
 *      so the persisted file is bounded by (#buckets × cap).
 */
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
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

/** Distinct-keys-per-bucket-per-day cap. Read lazily so it stays tunable
 *  (and testable) via env without a code change. */
function maxKeysPerBucket(): number {
  const n = Number(process.env.FMDB_RATE_LIMIT_MAX_KEYS);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

/** Hash the caller-supplied key (token or client id) before it touches memory
 *  or disk. The raw bearer token must never be persisted. 22 base64url chars
 *  of sha256 ≈ 128 bits — ample to distinguish callers without collisions. */
function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("base64url").slice(0, 22);
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
  // Persist ONLY the current day's entries. Previous-day counts are irrelevant
  // (dropped on load too) — pruning here keeps the on-disk file bounded by
  // (#buckets × cap) instead of growing across day boundaries in a long-lived
  // process.
  const day = today();
  const out: Record<string, Record<string, Entry>> = {};
  for (const [bucket, m] of mem) {
    const tokens: Record<string, Entry> = {};
    for (const [tok, e] of m) if (e.day === day) tokens[tok] = e;
    if (Object.keys(tokens).length) out[bucket] = tokens;
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
  const key = hashKey(token);
  let m = mem.get(bucket);
  if (!m) {
    m = new Map<string, Entry>();
    mem.set(bucket, m);
  }
  const cur = m.get(key);
  let count: number;
  if (!cur || cur.day !== day) {
    // Brand-new key for today. Bound the bucket so a flood of distinct
    // (e.g. attacker-supplied) tokens can't grow the sidecar without limit.
    // Past the cap, fail OPEN (allow, count 0) without storing the key —
    // denying would let an attacker lock real clients out, and these routes
    // are token-gated regardless.
    if (!cur && m.size >= maxKeysPerBucket()) {
      return { ok: true, count: 0 };
    }
    count = 1;
    m.set(key, { day, count });
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

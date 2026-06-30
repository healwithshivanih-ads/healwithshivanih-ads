/**
 * Tests for the persisted daily rate limiter (rate-limit.ts).
 *
 * Verifies the count semantics (first `limit` allowed, limit+1 blocked),
 * per-bucket / per-token isolation, and — the whole point of replacing the
 * in-memory Maps — that the count survives a process restart by reloading
 * from the on-disk sidecar.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { allowDaily, __resetForTests } from "./rate-limit";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fm-rate-"));
  process.env.FMDB_PLANS_DIR = dir;
  __resetForTests();
});

afterEach(async () => {
  delete process.env.FMDB_PLANS_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("allowDaily", () => {
  it("allows the first `limit` calls and blocks the next", async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await allowDaily("b", "tok", 3);
      expect(r.ok).toBe(true);
      expect(r.count).toBe(i);
    }
    const over = await allowDaily("b", "tok", 3);
    expect(over.ok).toBe(false);
    expect(over.count).toBe(4);
  });

  it("counts buckets and tokens independently", async () => {
    await allowDaily("b1", "tok", 1); // b1/tok now at limit
    const otherBucket = await allowDaily("b2", "tok", 1);
    const otherToken = await allowDaily("b1", "tok2", 1);
    expect(otherBucket.ok).toBe(true); // different bucket — fresh
    expect(otherToken.ok).toBe(true); // different token — fresh
    expect((await allowDaily("b1", "tok", 1)).ok).toBe(false); // same → blocked
  });

  it("persists the count across a process restart (sidecar reload)", async () => {
    await allowDaily("b", "tok", 5);
    await allowDaily("b", "tok", 5); // count now 2, written to disk

    // Simulate a fresh process: clear in-memory state, keep the same dir.
    __resetForTests();

    const r = await allowDaily("b", "tok", 5);
    expect(r.count).toBe(3); // resumed from the persisted 2, not reset to 1

    // The sidecar file actually exists. Keys are hashed now, so assert by
    // value rather than by the raw token name.
    const raw = await fs.readFile(path.join(dir, "_rate_limits.json"), "utf-8");
    const entries = Object.values(
      (JSON.parse(raw) as Record<string, Record<string, { count: number }>>).b,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
  });

  it("fails open when the sidecar is missing/corrupt", async () => {
    await fs.writeFile(path.join(dir, "_rate_limits.json"), "{ not json", "utf-8");
    __resetForTests();
    const r = await allowDaily("b", "tok", 2);
    expect(r.ok).toBe(true); // corrupt file → start fresh, don't lock out
    expect(r.count).toBe(1);
  });

  it("never writes the raw token into the sidecar (keys are hashed)", async () => {
    // A dumped/leaked sidecar must not expose bearer tokens.
    await allowDaily("b", "super-secret-bearer-token", 5);
    const raw = await fs.readFile(path.join(dir, "_rate_limits.json"), "utf-8");
    expect(raw).not.toContain("super-secret-bearer-token");
  });

  it("bounds distinct keys per bucket and fails open past the cap", async () => {
    // A flood of distinct (attacker-supplied) tokens must not grow the file
    // without limit, nor lock out real clients.
    process.env.FMDB_RATE_LIMIT_MAX_KEYS = "50";
    try {
      let failedOpen = 0;
      for (let i = 0; i < 60; i++) {
        const r = await allowDaily("flood", `tok-${i}`, 1);
        if (r.ok && r.count === 0) failedOpen++; // cap sentinel: allowed, not stored
      }
      const raw = await fs.readFile(path.join(dir, "_rate_limits.json"), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      expect(Object.keys(parsed.flood).length).toBeLessThanOrEqual(50);
      expect(failedOpen).toBeGreaterThan(0); // some requests hit the cap
    } finally {
      delete process.env.FMDB_RATE_LIMIT_MAX_KEYS;
    }
  });
});

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

    // The sidecar file actually exists.
    const raw = await fs.readFile(path.join(dir, "_rate_limits.json"), "utf-8");
    expect(JSON.parse(raw).b.tok.count).toBe(3);
  });

  it("fails open when the sidecar is missing/corrupt", async () => {
    await fs.writeFile(path.join(dir, "_rate_limits.json"), "{ not json", "utf-8");
    __resetForTests();
    const r = await allowDaily("b", "tok", 2);
    expect(r.ok).toBe(true); // corrupt file → start fresh, don't lock out
    expect(r.count).toBe(1);
  });
});

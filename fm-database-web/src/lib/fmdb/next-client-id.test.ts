/**
 * A new client id must never be one a parked prospect already holds.
 *
 * `fmdb prospects-sweep` MOVES quiet people from `clients/` to `prospects/`.
 * The allocators counted `clients/` alone, so on 21 Nov 2026 (highest active
 * id cl-906, with cl-907 to cl-910 parked) the next new client would have been
 * created as cl-907 — two people answering to one id.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allocateNextClientId, nextIdAfter } from "./next-client-id";

let root: string;

function mk(bucket: string, ...ids: string[]) {
  for (const id of ids) fs.mkdirSync(path.join(root, bucket, id), { recursive: true });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "next-client-id-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("nextIdAfter", () => {
  it("starts at cl-001 when nothing exists", () => {
    expect(nextIdAfter([])).toBe("cl-001");
  });

  it("ignores names that are not cl-NNN", () => {
    expect(nextIdAfter(["nidhi-jain", "cl-004", ".DS_Store", "cl-9x"])).toBe("cl-005");
  });

  it("counts the legacy flat cl-NNN.yaml layout", () => {
    expect(nextIdAfter(["cl-012.yaml", "cl-003"])).toBe("cl-013");
  });
});

describe("allocateNextClientId", () => {
  it("skips ids held by parked prospects (the 21 Nov 2026 layout)", async () => {
    mk("clients", "cl-025", "cl-900", "cl-906", "nidhi-jain");
    mk("prospects", "cl-020", "cl-907", "cl-910");
    expect(await allocateNextClientId(root)).toBe("cl-911");
  });

  it("still counts active clients when they hold the highest id", async () => {
    mk("clients", "cl-911");
    mk("prospects", "cl-910");
    expect(await allocateNextClientId(root)).toBe("cl-912");
  });

  it("works before prospects/ exists", async () => {
    mk("clients", "cl-002");
    expect(await allocateNextClientId(root)).toBe("cl-003");
  });

  it("works on an empty plans root", async () => {
    expect(await allocateNextClientId(root)).toBe("cl-001");
  });
});

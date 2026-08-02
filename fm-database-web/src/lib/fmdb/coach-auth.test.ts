/**
 * Tests for the /m password store (coach-auth.ts).
 *
 * Each test runs against a real temp file — the point of this module is its
 * filesystem behaviour (bootstrap, atomic write, corrupt-file recovery), so
 * mocking fs would test nothing that matters.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as coachAuth from "./coach-auth";
import { createSessionToken, verifySessionToken } from "./coach-session";

let dir: string;
let file: string;

// coach-auth holds no module-level state — every call re-reads the file and
// re-reads process.env — so one static import is safe across tests.
async function auth() {
  return coachAuth;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-auth-"));
  file = path.join(dir, "_coach_mobile_auth.json");
  process.env.COACH_MOBILE_AUTH_FILE = file;
  delete process.env.COACH_MOBILE_PASSWORD;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.COACH_MOBILE_AUTH_FILE;
  delete process.env.COACH_MOBILE_PASSWORD;
});

describe("bootstrap", () => {
  it("returns null when neither a file nor the env var exists (/m must not exist)", async () => {
    const a = await auth();
    expect(a.loadAuth()).toBeNull();
    expect(a.sessionSigningKey()).toBeNull();
    expect(a.verifyPassword("anything")).toBe(false);
  });

  it("seeds the store from COACH_MOBILE_PASSWORD on first use", async () => {
    process.env.COACH_MOBILE_PASSWORD = "bootstrap-pw";
    const a = await auth();
    expect(a.loadAuth()).not.toBeNull();
    expect(fs.existsSync(file)).toBe(true);
    expect(a.verifyPassword("bootstrap-pw")).toBe(true);
    expect(a.verifyPassword("wrong")).toBe(false);
  });

  it("never writes the password in clear text", async () => {
    process.env.COACH_MOBILE_PASSWORD = "fmcoach123";
    const a = await auth();
    a.loadAuth();
    expect(fs.readFileSync(file, "utf8")).not.toContain("fmcoach123");
  });

  it("writes the store 0600 — the hash is not world-readable", async () => {
    process.env.COACH_MOBILE_PASSWORD = "bootstrap-pw";
    (await auth()).loadAuth();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("recovers from a corrupt file instead of locking the coach out", async () => {
    fs.writeFileSync(file, "{ not json");
    process.env.COACH_MOBILE_PASSWORD = "bootstrap-pw";
    const a = await auth();
    expect(a.verifyPassword("bootstrap-pw")).toBe(true);
  });

  it("the FILE wins over the env var once it exists", async () => {
    process.env.COACH_MOBILE_PASSWORD = "original";
    const a = await auth();
    a.loadAuth();
    // Simulate the coach changing it in-app, then the old env var lingering.
    expect(a.changePassword("original", "changed-in-app").ok).toBe(true);
    process.env.COACH_MOBILE_PASSWORD = "original";
    const b = await auth();
    expect(b.verifyPassword("changed-in-app")).toBe(true);
    expect(b.verifyPassword("original")).toBe(false);
  });
});

describe("changePassword", () => {
  beforeEach(async () => {
    process.env.COACH_MOBILE_PASSWORD = "start-pw";
    (await auth()).loadAuth();
  });

  it("changes the password when the current one is right", async () => {
    const a = await auth();
    expect(a.changePassword("start-pw", "a-new-password").ok).toBe(true);
    expect(a.verifyPassword("a-new-password")).toBe(true);
    expect(a.verifyPassword("start-pw")).toBe(false);
  });

  it("refuses without the correct current password", async () => {
    const a = await auth();
    const res = a.changePassword("not-it", "a-new-password");
    expect(res).toEqual({ ok: false, error: "wrong_password" });
    expect(a.verifyPassword("start-pw")).toBe(true); // unchanged
  });

  it("refuses a too-short or unchanged password", async () => {
    const a = await auth();
    expect(a.changePassword("start-pw", "short")).toEqual({
      ok: false,
      error: "too_short",
    });
    expect(a.changePassword("start-pw", "start-pw")).toEqual({
      ok: false,
      error: "unchanged",
    });
  });

  it("rotates the signing secret, logging other devices out", async () => {
    const a = await auth();
    const before = a.sessionSigningKey();
    const res = a.changePassword("start-pw", "a-new-password");
    expect(res.ok).toBe(true);
    const after = a.sessionSigningKey();
    expect(after).not.toBe(before);
    if (res.ok) expect(res.signingSecret).toBe(after);
  });

  it("a session signed with the old secret stops verifying", async () => {
    const a = await auth();
    const oldToken = createSessionToken(a.sessionSigningKey()!);
    expect(verifySessionToken(oldToken, a.sessionSigningKey())).toBe(true);
    a.changePassword("start-pw", "a-new-password");
    expect(verifySessionToken(oldToken, a.sessionSigningKey())).toBe(false);
  });
});

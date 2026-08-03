/**
 * Two tokens open a client's app, and the client-level one wins.
 *
 * Kamla (cl-021) uses her app every day on a client-level `app_token`. Her
 * plan has no `letter_token`, so the weekly generators — which read only the
 * plan — refused with "Plan has no app token yet, share the app first" and
 * her grocery list and recipe pack quietly stopped regenerating for weeks.
 * Nidhi hit the same split in June. These pin the precedence so a third
 * caller cannot re-introduce it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../app-token");
}
const TOKEN_A = "clientlevel-token-0001";
const TOKEN_B = "planletter-token-0002";

function writeClient(id: string, body: string) {
  const d = path.join(root, "clients", id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "client.yaml"), body);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("app token resolution", () => {
  it("prefers the client-level token over the plan's", async () => {
    writeClient("cl-021", `app_token: ${TOKEN_A}\n`);
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-021", TOKEN_B)).toBe(TOKEN_A);
  });

  it("KAMLA'S CASE: client has a token, plan has none — must resolve", async () => {
    writeClient("cl-021", `display_name: Kamla Bhutani\napp_token: ${TOKEN_A}\n`);
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-021", null)).toBe(TOKEN_A);
  });

  it("falls back to the plan token when the client has none", async () => {
    writeClient("cl-030", "display_name: No Token\n");
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-030", TOKEN_B)).toBe(TOKEN_B);
  });

  it("returns null only when the app truly has not been shared", async () => {
    writeClient("cl-031", "display_name: Nobody\n");
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-031", null)).toBeNull();
  });

  it("ignores a stub token too short to be real", async () => {
    writeClient("cl-032", "app_token: short\n");
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-032", TOKEN_B)).toBe(TOKEN_B);
  });

  it("refuses a traversal-shaped client id", async () => {
    const m = await mod();
    expect(await m.clientAppToken("../../etc")).toBeNull();
  });

  it("a missing client file is not an error, just no token", async () => {
    const m = await mod();
    expect(await m.resolveClientAppToken("cl-none", null)).toBeNull();
  });
});

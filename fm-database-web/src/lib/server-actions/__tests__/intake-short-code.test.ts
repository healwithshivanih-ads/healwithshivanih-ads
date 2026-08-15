/**
 * `/s/<code>` must resolve for parked people, not just active clients.
 *
 * The short code IS the intake link — `sendIntakeInviteViaApi` and the
 * WhatsApp share button both prefer `/s/<code>` over the long
 * `/intake/<token>` URL. But `lookupIntakeShortCode` scanned `clients/`
 * alone, while the Python resolver behind `/intake/<token>`
 * (`_find_client_by_token` → `_person_dirs()`) scans `clients/` AND
 * `prospects/`.
 *
 * So the moment `fmdb prospects-sweep` parked someone — which is the normal
 * fate of anyone who hasn't signed up after 15 quiet days, and intake forms
 * are sent to people BEFORE they sign up — the link the coach had just sent
 * them 404'd with a bare "Not found", while the coach UI showed a perfectly
 * healthy unexpired token and the long-form URL still worked.
 *
 * These pin both halves: parked people resolve, and a genuinely dead code
 * still doesn't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;

async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  // Never let a test touch the real Fly staging tree.
  delete process.env.FMDB_STAGING_DIR;
  return import("../letter-token");
}

const TOKEN = "ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg"; // 32 chars, as minted in prod
const CODE = "k3Xm9qP"; // 7-char base62, as minted by _generate_short_code_unique

function writePerson(bucket: string, id: string, body: string) {
  const d = path.join(root, bucket, id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "client.yaml"), body);
}

function person(id: string, code: string, token: string, extra = "") {
  return (
    `client_id: ${id}\ndisplay_name: Test Person\n` +
    `intake_short_code: ${code}\nintake_token: ${token}\n${extra}`
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "intakecode-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("lookupIntakeShortCode — parked people keep their link", () => {
  it("THE BUG: resolves a code held by someone parked in prospects/", async () => {
    writePerson("prospects", "cl-023", person("cl-023", CODE, TOKEN));

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({
      ok: true,
      intake_token: TOKEN,
    });
  });

  it("still resolves a code held by an active client", async () => {
    writePerson("clients", "cl-005", person("cl-005", CODE, TOKEN));

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({
      ok: true,
      intake_token: TOKEN,
    });
  });

  it("finds the parked person even when active clients exist and don't match", async () => {
    // Ordering guard: clients/ is scanned first, so a non-empty clients/ must
    // not short-circuit the prospects/ pass.
    writePerson("clients", "cl-005", person("cl-005", "aaaaaaa", "othertoken-aaaaaaaaaaaaaaaaaaaaa"));
    writePerson("clients", "cl-006", person("cl-006", "bbbbbbb", "othertoken-bbbbbbbbbbbbbbbbbbbbb"));
    writePerson("prospects", "cl-023", person("cl-023", CODE, TOKEN));

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({
      ok: true,
      intake_token: TOKEN,
    });
  });

  it("survives a missing prospects/ directory", async () => {
    // Brand-new install: nobody has been parked yet, so the bucket is absent.
    writePerson("clients", "cl-005", person("cl-005", CODE, TOKEN));
    expect(fs.existsSync(path.join(root, "prospects"))).toBe(false);

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({
      ok: true,
      intake_token: TOKEN,
    });
  });

  it("refuses a revoked link — code present, token cleared", async () => {
    // Revoking clears intake_token. Widening the scan must not resurrect it.
    writePerson("prospects", "cl-023", `client_id: cl-023\nintake_short_code: ${CODE}\nintake_token: null\n`);

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({ ok: false });
  });

  it("refuses an unknown code, and anything that isn't 7 chars", async () => {
    writePerson("prospects", "cl-023", person("cl-023", CODE, TOKEN));

    const m = await mod();
    expect(await m.lookupIntakeShortCode("zzzzzzz")).toEqual({ ok: false });
    expect(await m.lookupIntakeShortCode("")).toEqual({ ok: false });
    expect(await m.lookupIntakeShortCode(CODE.slice(0, 6))).toEqual({ ok: false });
  });

  it("skips unreadable records rather than aborting the scan", async () => {
    // A half-written client.yaml mid-Mutagen-sync must not strand a valid
    // code that sits later in the walk.
    writePerson("clients", "cl-bad", ": : not yaml : :\n  - [");
    writePerson("prospects", "cl-023", person("cl-023", CODE, TOKEN));

    const m = await mod();
    expect(await m.lookupIntakeShortCode(CODE)).toEqual({
      ok: true,
      intake_token: TOKEN,
    });
  });
});

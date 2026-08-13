/**
 * A renewal must keep the letter link the client already has.
 *
 * Geetika (cl-006) renewed on 2026-08-12. Publishing plan-3 auto-superseded
 * plan-2, and ensureLetterToken minted a BRAND-NEW token for plan-3. Every
 * resolver scans published/ only, so the link she was already holding — the
 * one in her WhatsApp history — pointed at a plan that was no longer in
 * published/, and her app showed "this link isn't active any more". Meanwhile
 * the freshly minted token sat on a plan nobody had been given.
 *
 * These pin the contract: renewals inherit, first plans mint.
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

const OLD_TOKEN = "HHI5DOuG0be8Vj_WGf6W3-8m9iBHctCG"; // 32 chars, as minted in prod
const OLD_CODE = "gFuDwJ5";

function writePlan(bucket: string, file: string, body: string) {
  const d = path.join(root, bucket);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), body);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lettertok-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ensureLetterToken — renewal link continuity", () => {
  it("GEETIKA'S CASE: a renewal inherits the superseded plan's token + short code", async () => {
    writePlan(
      "superseded",
      "geetika-plan-2-2026-05-22-cl-006-v1.yaml",
      `slug: geetika-plan-2-2026-05-22-cl-006\nclient_id: cl-006\nplan_period_start: '2026-05-22'\n` +
        `letter_token: ${OLD_TOKEN}\nletter_token_created_at: '2026-06-13T08:56:37.870000Z'\n` +
        `letter_short_code: ${OLD_CODE}\nstatus: superseded\n`,
    );
    writePlan(
      "published",
      "geetika-plan-3-2026-08-14-cl-006-v1.yaml",
      `slug: geetika-plan-3-2026-08-14-cl-006\nclient_id: cl-006\nplan_period_start: '2026-08-14'\n` +
        `letter_token: null\nletter_short_code: null\nstatus: published\n`,
    );

    const m = await mod();
    const res = await m.ensureLetterToken("geetika-plan-3-2026-08-14-cl-006");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).toBe(OLD_TOKEN);
    expect(res.short_code).toBe(OLD_CODE);

    // and it is persisted, so the resolver finds plan-3 for the old link
    const written = fs.readFileSync(
      path.join(root, "published", "geetika-plan-3-2026-08-14-cl-006-v1.yaml"),
      "utf-8",
    );
    expect(written).toContain(OLD_TOKEN);
    expect(written).toContain(OLD_CODE);
    // the inherited token keeps its original issue date
    expect(written).toContain("2026-06-13");
  });

  it("the old link now resolves to the NEW plan", async () => {
    writePlan(
      "superseded",
      "geetika-plan-2-2026-05-22-cl-006-v1.yaml",
      `slug: geetika-plan-2-2026-05-22-cl-006\nclient_id: cl-006\n` +
        `letter_token: ${OLD_TOKEN}\nletter_short_code: ${OLD_CODE}\nstatus: superseded\n`,
    );
    writePlan(
      "published",
      "geetika-plan-3-2026-08-14-cl-006-v1.yaml",
      `slug: geetika-plan-3-2026-08-14-cl-006\nclient_id: cl-006\nstatus: published\n`,
    );

    const m = await mod();
    await m.ensureLetterToken("geetika-plan-3-2026-08-14-cl-006");

    const viaToken = await m.lookupLetterToken(OLD_TOKEN);
    expect(viaToken.ok).toBe(true);
    if (viaToken.ok) expect(viaToken.plan_slug).toBe("geetika-plan-3-2026-08-14-cl-006");

    const viaCode = await m.lookupLetterShortCode(OLD_CODE);
    expect(viaCode.ok).toBe(true);
    if (viaCode.ok) expect(viaCode.letter_token).toBe(OLD_TOKEN);
  });

  it("a client's FIRST plan still mints a fresh token", async () => {
    writePlan(
      "published",
      "kamla-plan-1-2026-07-12-cl-021-v1.yaml",
      `slug: kamla-plan-1-2026-07-12-cl-021\nclient_id: cl-021\nstatus: published\n`,
    );

    const m = await mod();
    const res = await m.ensureLetterToken("kamla-plan-1-2026-07-12-cl-021");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).not.toBe(OLD_TOKEN);
    expect(res.token.length).toBeGreaterThanOrEqual(16);
    expect(res.short_code).toHaveLength(7);
  });

  it("never inherits ACROSS clients", async () => {
    writePlan(
      "superseded",
      "geetika-plan-2-2026-05-22-cl-006-v1.yaml",
      `slug: geetika-plan-2-2026-05-22-cl-006\nclient_id: cl-006\n` +
        `letter_token: ${OLD_TOKEN}\nletter_short_code: ${OLD_CODE}\nstatus: superseded\n`,
    );
    writePlan(
      "published",
      "niti-plan-2-2026-08-01-cl-014-v1.yaml",
      `slug: niti-plan-2-2026-08-01-cl-014\nclient_id: cl-014\nstatus: published\n`,
    );

    const m = await mod();
    const res = await m.ensureLetterToken("niti-plan-2-2026-08-01-cl-014");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).not.toBe(OLD_TOKEN);
    expect(res.short_code).not.toBe(OLD_CODE);
  });

  it("refuses to inherit a token another PUBLISHED plan still holds", async () => {
    // Pathological: the previous plan was never superseded, so it is still live.
    writePlan(
      "published",
      "geetika-plan-2-2026-05-22-cl-006-v1.yaml",
      `slug: geetika-plan-2-2026-05-22-cl-006\nclient_id: cl-006\n` +
        `letter_token: ${OLD_TOKEN}\nletter_short_code: ${OLD_CODE}\nstatus: published\n`,
    );
    writePlan(
      "published",
      "geetika-plan-3-2026-08-14-cl-006-v1.yaml",
      `slug: geetika-plan-3-2026-08-14-cl-006\nclient_id: cl-006\nstatus: published\n`,
    );

    const m = await mod();
    const res = await m.ensureLetterToken("geetika-plan-3-2026-08-14-cl-006");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // must NOT duplicate a live token — resolution would depend on readdir order
    expect(res.token).not.toBe(OLD_TOKEN);
    expect(res.short_code).not.toBe(OLD_CODE);
  });

  it("is idempotent — a plan that already has both is untouched", async () => {
    writePlan(
      "published",
      "geetika-plan-3-2026-08-14-cl-006-v1.yaml",
      `slug: geetika-plan-3-2026-08-14-cl-006\nclient_id: cl-006\n` +
        `letter_token: ${OLD_TOKEN}\nletter_short_code: ${OLD_CODE}\nstatus: published\n`,
    );
    const m = await mod();
    const a = await m.ensureLetterToken("geetika-plan-3-2026-08-14-cl-006");
    const b = await m.ensureLetterToken("geetika-plan-3-2026-08-14-cl-006");
    expect(a).toEqual(b);
    if (a.ok) expect(a.token).toBe(OLD_TOKEN);
  });
});

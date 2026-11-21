/**
 * Sending a body age report, end to end over a temp plans root, with the mailer mocked. Nothing is ever emailed
 * by this test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mail = { to: string; purpose?: string; clientId?: string; subject: string; htmlBody: string; attachments?: { filename: string; cid?: string; mimeType?: string }[] };
const outbox: Mail[] = [];
let failNext = false;

vi.mock("@/app/api/email/actions", () => ({
  sendClientEmailAction: async (m: Mail) => {
    if (failNext) return { ok: false, error: "mailbox said no" };
    outbox.push(m);
    return { ok: true };
  },
}));
vi.mock("@/lib/fmdb/mail-from", () => ({ clientMailer: () => ({ user: "coach@example.com", pass: "x", from: "Coach <coach@example.com>", personal: true }) }));

const calls: string[] = [];
let shimOutcome = "foundation";
let stageOk = true;
vi.mock("@/lib/fmdb/shim", () => ({
  runShim: async (_s: string, p: { client_id: string; record: boolean }) => {
    calls.push(`build:${p.record}`);
    return { ok: true, ready: true, blockers: [], warnings: [], report: { outcome: shimOutcome }, files: { html: `/x/files/body-age/${"BA-S-900-260704"}/report.html` }, recorded: p.record };
  },
}));
vi.mock("./app-token", () => ({
  ensureClientAppToken: async () => {
    calls.push("token");
    return { ok: true, token: "t".repeat(20) };
  },
}));
vi.mock("./foundation-session", () => ({
  startFoundationSession: async () => {
    calls.push("stage");
    return stageOk ? { ok: true } : { ok: false, error: "x" };
  },
}));

import { buildBodyAgeReport, latestBodyAgeReport, sendBodyAgeReport } from "./body-age-report";
import { EMBARGO_UNTIL_MS } from "@/lib/fmdb/body-age-send";

const NO = "BA-S-900-260704";
const PDF = "Body age report, Ochre, 4 July 2026.pdf";
let root: string;
let prev: string | undefined;

function person(id: string, extra: Record<string, unknown> = {}, ready = true) {
  const dir = path.join(root, "clients", id);
  const rep = path.join(dir, "files", "body-age", NO);
  fs.mkdirSync(rep, { recursive: true });
  fs.writeFileSync(path.join(dir, "client.yaml"), yaml.dump({ client_id: id, display_name: "Ochre Test", email: "buyer@example.com", ...extra }));
  fs.writeFileSync(
    path.join(rep, "report.json"),
    JSON.stringify({ report_no: NO, kind: "standard", outcome: "foundation", subject: "Your body age report is ready", attachment: PDF, ready, blockers: [], pages: 18 }),
  );
  fs.writeFileSync(path.join(rep, "email.html"), '<html><img src="cid:ring"><img src="cid:mark"></html>');
  for (const n of [PDF, "ring.png", "mark.png"]) fs.writeFileSync(path.join(rep, n), "bytes");
  return rep;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "body-age-send-"));
  prev = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
  outbox.length = 0;
  failNext = false;
  calls.length = 0;
  shimOutcome = "foundation";
  stageOk = true;
});
afterEach(() => {
  vi.useRealTimers();
  if (prev === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prev;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("sending a body age report", () => {
  it("the test profile's report goes to the coach, with the PDF attached and both images inline, and reads Sent after", async () => {
    const rep = person("cl-900");
    const out = await sendBodyAgeReport("cl-900", NO);
    expect(out.ok).toBe(true);
    expect(outbox).toHaveLength(1);
    const m = outbox[0];
    expect(m.to).toBe("coach@example.com"); // never the address on the record
    expect(m.purpose).toBe("transactional");
    expect(m.clientId).toBe("cl-900");
    expect(m.subject).toBe("Your body age report is ready");
    expect(m.attachments?.map((a) => [a.filename, a.cid ?? null])).toEqual([["ring.png", "ring"], ["mark.png", "mark"], [PDF, null]]);
    const log = JSON.parse(fs.readFileSync(path.join(rep, "sent.json"), "utf8"));
    expect(log).toHaveLength(1);
    expect(log[0].test).toBe(true);
    const again = await latestBodyAgeReport("cl-900");
    expect(again?.sentTo).toBe("coach@example.com");
    expect(again?.reportNo).toBe(NO);
  });

  it("before the launch nobody else's report is sent, whatever is on the record", async () => {
    person("cl-123", { body_age_reports: [{ report_no: NO }] });
    const out = await sendBodyAgeReport("cl-123", NO);
    expect(out.ok).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  it("after the launch a saved report goes to the buyer's own email; an unsaved one does not", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(EMBARGO_UNTIL_MS + 60_000));
    person("cl-124");
    expect((await sendBodyAgeReport("cl-124", NO)).ok).toBe(false);
    person("cl-125", { body_age_reports: [{ report_no: NO }] });
    expect((await sendBodyAgeReport("cl-125", NO)).ok).toBe(true);
    expect(outbox.map((m) => m.to)).toEqual(["buyer@example.com"]);
  });

  it("a report that was not ready, a missing file, or a failed send leaves no Sent mark", async () => {
    const notReady = person("cl-900", {}, false);
    expect((await sendBodyAgeReport("cl-900", NO)).ok).toBe(false);
    fs.rmSync(notReady, { recursive: true });
    const rep = person("cl-900");
    fs.rmSync(path.join(rep, PDF));
    expect((await sendBodyAgeReport("cl-900", NO)).ok).toBe(false);
    fs.writeFileSync(path.join(rep, PDF), "bytes");
    failNext = true;
    expect((await sendBodyAgeReport("cl-900", NO)).ok).toBe(false);
    expect(outbox).toHaveLength(0);
    expect(fs.existsSync(path.join(rep, "sent.json"))).toBe(false);
    expect((await sendBodyAgeReport("cl-900", "../../x")).ok).toBe(false);
  });
});

describe("building the report that goes out", () => {
  it("a look (not saved) touches nothing but the build", async () => {
    person("cl-300");
    await buildBodyAgeReport("cl-300", "standard", false);
    expect(calls).toEqual(["build:false"]);
  });

  it("saving makes the personal link first, builds, then prepares the pay page, in that order", async () => {
    person("cl-300");
    const v = await buildBodyAgeReport("cl-300", "standard", true);
    expect(calls).toEqual(["token", "build:true", "stage"]);
    expect(v.ok && v.warnings).toEqual([]);
  });

  it("no pay page is prepared when the report offers no session, or for someone already in care", async () => {
    person("cl-300");
    shimOutcome = "nothing";
    await buildBodyAgeReport("cl-300", "standard", true);
    person("cl-301", { engagement_status: "signed_up" });
    shimOutcome = "foundation";
    await buildBodyAgeReport("cl-301", "standard", true);
    expect(calls.filter((c) => c === "stage")).toEqual([]);
  });

  it("tells the coach when the pay page could not be prepared", async () => {
    person("cl-300");
    stageOk = false;
    const v = await buildBodyAgeReport("cl-300", "standard", true);
    expect(v.ok && v.warnings.join(" ")).toMatch(/pay page could not be prepared/);
  });
});

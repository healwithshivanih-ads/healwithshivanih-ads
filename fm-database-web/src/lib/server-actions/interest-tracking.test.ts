/**
 * The "thought of you" note scan and the panel read, end to end over a temp
 * plans root and a temp content library.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; subject: string; textBody?: string }> = [];
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/api/whatsapp/actions", () => ({
  loadCommunicationThreadAction: async () => [],
  recordOutboundMessageAction: async () => ({ ok: true }),
}));
vi.mock("@/app/api/email/actions", () => ({
  sendClientEmailAction: async (i: { to: string; subject: string; textBody?: string }) => {
    sent.push(i);
    return { ok: true };
  },
}));
vi.mock("@/lib/fmdb/foundation-orders", () => ({ foundationSessionPaid: async () => ({ paid: false }) }));
vi.mock("@/lib/fmdb/founding", () => ({ giftedSessionOf: () => null }));
vi.mock("@/lib/fmdb/content-library-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/fmdb/content-library-store")>()),
  // No network in tests: every library link counts as public.
  linkIsPublic: async () => true,
}));

import {
  approveInterestNoteAction,
  loadInterestedPeopleAction,
  scanInterestNotesAction,
  setNotesOptOutAction,
} from "./interest-tracking";

let root: string;
let cat: string;
const prev: Record<string, string | undefined> = {};

function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}
function daysAgo(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const NEW_VIDEO = {
  id: "belly",
  kind: "video",
  title: "Belly Fat After 40",
  url: "https://youtu.be/BELLY000001",
  concerns: ["weight"],
  stage: "first",
  line: "Why belly fat changes after 40.",
};

function setup(opts: { followup?: unknown; extra?: Dict; liveDaysAgo?: number } = {}) {
  const lib = [{ ...NEW_VIDEO, live_from: daysAgo(opts.liveDaysAgo ?? 3) }];
  fs.writeFileSync(path.join(cat, "_content_library.yaml"), yaml.dump({ items: lib }));
  writeStatus(root, lib);
  const dir = path.join(root, "prospects", "cl-960");
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "client.yaml"),
    yaml.dump({
      client_id: "cl-960",
      display_name: "Meera Test",
      email: "meera@example.com",
      engagement_status: "pending",
      interests: [{ concern: "weight", source: "booking_form", at: daysAgo(60), detail: "Belly weight" }],
      ...(opts.extra ?? {}),
    }),
  );
  if (opts.followup) fs.writeFileSync(path.join(dir, "_discovery_followup.yaml"), yaml.dump(opts.followup));
}
type Dict = Record<string, unknown>;

/** What the content-status job would have written for these items today. */
function writeStatus(plansRoot: string, items: Array<{ url: string; live_from: string }>) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  const videos: Record<string, unknown> = {};
  for (const i of items) {
    const id = i.url.match(/youtu\.be\/(.+)$/)?.[1];
    if (!id) continue;
    const isPublic = i.live_from <= today;
    videos[id] = { state: isPublic ? "public" : "private", published_on: isPublic ? i.live_from : null, checked_at: new Date().toISOString() };
  }
  fs.writeFileSync(path.join(plansRoot, "_content_status.yaml"), yaml.dump({ videos }));
}

const FINISHED_FOLLOWUP = {
  client_id: "cl-960",
  track: "free",
  call_date: daysAgo(60),
  exited: false,
  touches: [1, 2, 3, 4].map((n) => ({ track: "free", touch: n, status: "sent", sent_at: `${daysAgo(60 - n * 5)}T05:00:00Z` })),
};

beforeEach(() => {
  sent.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
  cat = fs.mkdtempSync(path.join(os.tmpdir(), "notes-cat-"));
  for (const b of ["clients", "prospects", "drafts", "ready", "published"]) fs.mkdirSync(path.join(root, b));
  for (const k of ["FMDB_PLANS_DIR", "FMDB_CATALOGUE_DIR"]) prev[k] = process.env[k];
  process.env.FMDB_PLANS_DIR = root;
  process.env.FMDB_CATALOGUE_DIR = cat;
});
afterEach(() => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cat, { recursive: true, force: true });
});

function notesFile() {
  const f = path.join(root, "prospects", "cl-960", "_interest_notes.yaml");
  return fs.existsSync(f) ? (yaml.load(fs.readFileSync(f, "utf-8")) as { notes: Array<Dict> }) : null;
}

describe("scanInterestNotesAction", () => {
  it("drafts one note when a new matching video is live and the follow-up is over", async () => {
    setup({ followup: FINISHED_FOLLOWUP });
    const r = await scanInterestNotesAction();
    expect(r.drafted).toBe(1);
    const n = notesFile()!.notes[0];
    expect(n.status).toBe("pending");
    expect(n.content_id).toBe("belly");
    expect(String(n.body)).toContain("https://youtu.be/BELLY000001");
    // Idempotent: a second run the same day adds nothing.
    expect((await scanInterestNotesAction()).drafted).toBe(0);
  });

  it("waits while the call follow-up is still running", async () => {
    setup({ followup: { ...FINISHED_FOLLOWUP, call_date: daysAgo(8), touches: [{ track: "free", touch: 1, status: "sent", sent_at: `${daysAgo(7)}T05:00:00Z` }] } });
    expect((await scanInterestNotesAction()).drafted).toBe(0);
  });

  it("never drafts for someone who opted out", async () => {
    setup({ followup: FINISHED_FOLLOWUP, extra: { marketing_opt_out: true } });
    expect((await scanInterestNotesAction()).drafted).toBe(0);
  });

  it("ignores old content (not new)", async () => {
    setup({ followup: FINISHED_FOLLOWUP, liveDaysAgo: 60 });
    expect((await scanInterestNotesAction()).drafted).toBe(0);
  });
});

describe("approve + opt-out", () => {
  it("sends the approved note and records it as sent", async () => {
    setup({ followup: FINISHED_FOLLOWUP });
    await scanInterestNotesAction();
    const n = notesFile()!.notes[0];
    const r = await approveInterestNoteAction("cl-960", { subject: String(n.subject), body: String(n.body) });
    expect(r).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("meera@example.com");
    expect(notesFile()!.notes[0].status).toBe("sent");
  });

  it("refuses an edited note carrying a link that is not in the library", async () => {
    setup({ followup: FINISHED_FOLLOWUP });
    await scanInterestNotesAction();
    const n = notesFile()!.notes[0];
    const body = String(n.body).replace("https://youtu.be/BELLY000001", "https://example.com/made-up");
    const r = await approveInterestNoteAction("cl-960", { subject: String(n.subject), body });
    expect(r.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("Stop these clears the waiting note and blocks future ones", async () => {
    setup({ followup: FINISHED_FOLLOWUP });
    await scanInterestNotesAction();
    await setNotesOptOutAction("cl-960", true);
    expect(notesFile()!.notes[0].status).toBe("skipped");
    const doc = yaml.load(fs.readFileSync(path.join(root, "prospects", "cl-960", "client.yaml"), "utf-8")) as Dict;
    expect(doc.marketing_opt_out).toBe(true);
  });
});

describe("loadInterestedPeopleAction", () => {
  it("lists a parked prospect with their concerns, words and a waiting note", async () => {
    setup({ followup: FINISHED_FOLLOWUP });
    await scanInterestNotesAction();
    const { rows } = await loadInterestedPeopleAction();
    expect(rows).toHaveLength(1);
    expect(rows[0].parked).toBe(true);
    expect(rows[0].concerns.map((c) => c.id)).toEqual(["weight"]);
    expect(rows[0].words).toEqual(["Belly weight"]);
    expect(rows[0].pendingNote?.title).toBe("Belly Fat After 40");
  });
});

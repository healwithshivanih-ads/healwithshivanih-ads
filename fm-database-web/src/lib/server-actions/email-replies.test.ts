/**
 * The hourly reply scan end to end over a temp plans root, with the mailbox
 * (the Python IMAP shim) and the thread writer mocked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mailbox: { messages: Array<Record<string, string>> } = { messages: [] };
const recorded: Array<{ clientId: string; body: string }> = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/fmdb/shim", async (orig) => ({
  ...(await orig<typeof import("@/lib/fmdb/shim")>()),
  runShim: async (_s: string, payload: { skip_ids: string[] }) => ({
    ok: true,
    messages: mailbox.messages.filter((m) => !payload.skip_ids.includes(m.message_id)),
  }),
}));
vi.mock("@/app/api/whatsapp/actions", () => ({
  recordInboundEmailAction: async (i: { clientId: string; body: string }) => {
    recorded.push(i);
    return { ok: true };
  },
  loadCommunicationThreadAction: async () => [],
  recordOutboundMessageAction: async () => ({ ok: true }),
}));
vi.mock("@/app/api/email/actions", () => ({ sendClientEmailAction: async () => ({ ok: true }) }));
vi.mock("@/lib/fmdb/foundation-orders", () => ({ foundationSessionPaid: async () => ({ paid: false }) }));
vi.mock("@/lib/fmdb/founding", () => ({ giftedSessionOf: () => null }));

import { scanEmailRepliesAction } from "./email-replies";
import { setNotesOptOutAction } from "./interest-tracking";

let root: string;
let prev: string | undefined;

function person(id: string, email: string, followup = true) {
  const dir = path.join(root, "prospects", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "client.yaml"), yaml.dump({ client_id: id, display_name: "Asha", email, engagement_status: "pending" }));
  if (followup) {
    fs.writeFileSync(
      path.join(dir, "_discovery_followup.yaml"),
      yaml.dump({
        client_id: id, client_name: "Asha", track: "free", call_date: "2026-10-10", manual: null, exited: false,
        touches: [{ track: "free", touch: 2, kind: "free_foundation_offer", due_on: "2026-10-15", status: "pending", subject: "s", body: "b" }],
      }),
    );
  }
}
const read = (id: string, f: string) => yaml.load(fs.readFileSync(path.join(root, "prospects", id, f), "utf-8")) as Record<string, unknown>;

beforeEach(() => {
  mailbox.messages = [];
  recorded.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "replies-"));
  fs.mkdirSync(path.join(root, "clients"));
  prev = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});
afterEach(() => {
  if (prev === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prev;
  fs.rmSync(root, { recursive: true, force: true });
});

const msg = (id: string, from: string, text: string) => ({
  message_id: id, from, subject: "Re: Thank you for our chat", date: "2026-10-21T06:00:00+00:00",
  text: `${text}\n\nOn Tue, 20 Oct 2026, Shivani Hari <s@x.com> wrote:\n> just reply "no more" and I'll stop.`,
});

describe("scanEmailRepliesAction", () => {
  it("'no more' opts them out, stops the call follow-up and skips the waiting draft", async () => {
    person("cl-970", "asha@example.com");
    mailbox.messages = [msg("<a@1>", "asha@example.com", "No more please")];
    const r = await scanEmailRepliesAction();
    expect(r.optedOut).toEqual([{ clientId: "cl-970", phrase: "no more please" }]);
    const doc = read("cl-970", "client.yaml");
    expect(doc.marketing_opt_out).toBe(true);
    expect(String(doc.marketing_opt_out_source)).toContain("replied by email");
    const fu = read("cl-970", "_discovery_followup.yaml") as { exited: boolean; touches: Array<{ status: string }> };
    expect(fu.exited).toBe(true);
    expect(fu.touches[0].status).toBe("skipped");
    // The reply itself is in their thread, quote stripped.
    expect(recorded).toEqual([expect.objectContaining({ clientId: "cl-970", body: "No more please" })]);
  });

  it("an ordinary reply is recorded but changes nothing else", async () => {
    person("cl-971", "ravi@example.com");
    mailbox.messages = [msg("<b@1>", "ravi@example.com", "No more bloating since the seeds, thank you!")];
    const r = await scanEmailRepliesAction();
    expect(r.optedOut).toEqual([]);
    expect(r.recorded).toBe(1);
    expect(read("cl-971", "client.yaml").marketing_opt_out).toBeUndefined();
    expect((read("cl-971", "_discovery_followup.yaml") as { exited: boolean }).exited).toBe(false);
  });

  it("each message is handled once", async () => {
    person("cl-972", "meera@example.com");
    mailbox.messages = [msg("<c@1>", "meera@example.com", "Thanks!")];
    expect((await scanEmailRepliesAction()).recorded).toBe(1);
    expect((await scanEmailRepliesAction()).recorded).toBe(0);
    expect(recorded).toHaveLength(1);
  });

  it("mail from someone who is not a prospect is ignored", async () => {
    person("cl-973", "known@example.com");
    mailbox.messages = [msg("<d@1>", "stranger@example.com", "no more")];
    expect((await scanEmailRepliesAction()).recorded).toBe(0);
  });

  it("undo on the dashboard restarts the follow-up the reply stopped", async () => {
    person("cl-974", "undo@example.com");
    mailbox.messages = [msg("<e@1>", "undo@example.com", "unsubscribe")];
    await scanEmailRepliesAction();
    await setNotesOptOutAction("cl-974", false);
    expect(read("cl-974", "client.yaml").marketing_opt_out).toBe(false);
    expect((read("cl-974", "_discovery_followup.yaml") as { exited: boolean }).exited).toBe(false);
  });
});

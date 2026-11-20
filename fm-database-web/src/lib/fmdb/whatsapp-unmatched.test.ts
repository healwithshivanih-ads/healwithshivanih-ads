/**
 * The reader for WhatsApp messages from numbers that are not on the roster
 * (~/fm-plans/_whatsapp_unmatched.yaml, written by /api/whatsapp-webhook).
 *
 * Runs against a real temp FMDB_PLANS_DIR. The fixture is written with the
 * same `yaml.dump(existing, { lineWidth: 120 })` call the webhook uses, so the
 * test reads the file shape the webhook really produces.
 */
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UNMATCHED_FILE_NAME,
  UNMATCHED_SEEN_FILE_NAME,
  UNMATCHED_UNREAD_DAYS,
  countUnread,
  loadUnmatchedMessages,
  markUnmatchedSeen,
  markUnmatchedSenderSeen,
  parseUnmatched,
} from "./whatsapp-unmatched";

const NOW = new Date("2026-11-18T06:00:00.000Z");
const TODAY = "2026-11-18";

let root: string;
let prevPlansDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wa-unmatched-"));
  prevPlansDir = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterEach(() => {
  if (prevPlansDir === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevPlansDir;
  fs.rmSync(root, { recursive: true, force: true });
});

interface Row {
  phone: string;
  name: string | null;
  date: string;
  received_at: string;
  text: string;
}

/** Exactly what saveUnmatchedMessage() in the webhook writes. */
function writeWebhookFile(rows: Row[]) {
  fs.writeFileSync(path.join(root, UNMATCHED_FILE_NAME), yaml.dump(rows, { lineWidth: 120 }), "utf-8");
}

const OLD: Row = {
  phone: "919800000001",
  name: "Asha Test",
  date: "2026-10-09",
  received_at: "9/10/2026, 4:05:11 pm",
  text: "Hello, is this the right number?",
};
const BUYER_1: Row = {
  phone: "919800000002",
  name: "Body Age Buyer",
  date: "2026-11-17",
  received_at: "17/11/2026, 8:17:05 am",
  text: "Hi Shivani, I have my body age report and would like to talk about it.",
};
const BUYER_2: Row = {
  phone: "919800000002",
  name: "Body Age Buyer",
  date: "2026-11-18",
  received_at: "18/11/2026, 10:02:40 am",
  text: "Hi Shivani, I would like to book the results call for my body age report.",
};
const NO_NAME: Row = {
  phone: "919800000003",
  name: null,
  date: "2026-11-18",
  received_at: "18/11/2026, 11:30:00 am",
  text: "",
};

describe("loadUnmatchedMessages — reading the file", () => {
  it("is an empty list when the file does not exist", async () => {
    expect(await loadUnmatchedMessages(NOW)).toEqual([]);
  });

  it("is an empty list when the file is empty", async () => {
    fs.writeFileSync(path.join(root, UNMATCHED_FILE_NAME), "", "utf-8");
    expect(await loadUnmatchedMessages(NOW)).toEqual([]);
  });

  it("is an empty list for an empty YAML list, a non-list, or broken YAML", async () => {
    for (const body of ["[]\n", "phone: 91\n", "- [unclosed\n  : :\n"]) {
      fs.writeFileSync(path.join(root, UNMATCHED_FILE_NAME), body, "utf-8");
      expect(await loadUnmatchedMessages(NOW)).toEqual([]);
    }
  });

  it("returns the webhook's rows newest first, with name, number, time and text", async () => {
    writeWebhookFile([OLD, BUYER_1, BUYER_2, NO_NAME]);
    const list = await loadUnmatchedMessages(NOW);
    expect(list.map((m) => m.text)).toEqual([NO_NAME.text, BUYER_2.text, BUYER_1.text, OLD.text]);
    const buyer = list[1];
    expect(buyer.name).toBe("Body Age Buyer");
    expect(buyer.phone).toBe("919800000002");
    expect(buyer.phoneKey).toBe("9800000002");
    expect(buyer.receivedAt).toBe("18/11/2026, 10:02:40 am");
    expect(buyer.date).toBe("2026-11-18");
    expect(list[0].name).toBeNull();
  });

  it("gives every message a stable id, the same on every read", async () => {
    writeWebhookFile([BUYER_1, BUYER_2]);
    const a = await loadUnmatchedMessages(NOW);
    const b = await loadUnmatchedMessages(NOW);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(new Set(a.map((m) => m.id)).size).toBe(2);
    expect(a[0].id).toMatch(/^m[0-9a-f]{16}$/);
  });

  it("skips rows that are not messages instead of failing", () => {
    const raw = yaml.dump([null, "just a string", { phone: "", text: "" }, BUYER_1]);
    const list = parseUnmatched(raw, {}, TODAY);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe(BUYER_1.text);
  });

  it("reads a number or date YAML left unquoted", () => {
    const raw = "- phone: 919800000004\n  name: Hand Edited\n  date: 2026-11-18\n  received_at: 18/11/2026, 9:00:00 am\n  text: hello\n";
    const [m] = parseUnmatched(raw, {}, TODAY);
    expect(m.phone).toBe("919800000004");
    expect(m.date).toBe("2026-11-18");
    expect(m.isUnread).toBe(true);
  });
});

describe("unread count", () => {
  it("counts unseen messages from the last 30 days only", async () => {
    writeWebhookFile([OLD, BUYER_1, BUYER_2, NO_NAME]);
    const list = await loadUnmatchedMessages(NOW);
    // OLD is 40 days old: listed, but not counted — the backlog from before
    // this page existed must not sit on the dashboard forever.
    expect(countUnread(list)).toBe(3);
    expect(list.find((m) => m.text === OLD.text)?.isUnread).toBe(false);
  });

  it("the window edge: day 30 counts, day 31 does not", () => {
    const at = (daysAgo: number) => {
      const d = new Date(`${TODAY}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    };
    const raw = yaml.dump([
      { ...BUYER_1, text: "edge-in", date: at(UNMATCHED_UNREAD_DAYS) },
      { ...BUYER_1, text: "edge-out", date: at(UNMATCHED_UNREAD_DAYS + 1) },
    ]);
    const list = parseUnmatched(raw, {}, TODAY);
    expect(list.find((m) => m.text === "edge-in")?.isUnread).toBe(true);
    expect(list.find((m) => m.text === "edge-out")?.isUnread).toBe(false);
  });
});

describe("mark seen", () => {
  it("drops the count, and the mark survives a fresh read from disk", async () => {
    writeWebhookFile([OLD, BUYER_1, BUYER_2, NO_NAME]);
    const before = await loadUnmatchedMessages(NOW);
    expect(countUnread(before)).toBe(3);

    const target = before.find((m) => m.text === NO_NAME.text)!;
    expect(await markUnmatchedSeen([target.id], NOW)).toBe(1);

    const after = await loadUnmatchedMessages(NOW);
    expect(countUnread(after)).toBe(2);
    const seen = after.find((m) => m.id === target.id)!;
    expect(seen.isUnread).toBe(false);
    expect(seen.seenAt).toBe(NOW.toISOString());
    // On disk, in its own file — the webhook's file is untouched.
    expect(fs.existsSync(path.join(root, UNMATCHED_SEEN_FILE_NAME))).toBe(true);
    expect(yaml.load(fs.readFileSync(path.join(root, UNMATCHED_FILE_NAME), "utf-8"))).toHaveLength(4);
  });

  it("marks every message from one number in one go, and leaves other numbers alone", async () => {
    writeWebhookFile([BUYER_1, BUYER_2, NO_NAME]);
    expect(await markUnmatchedSenderSeen("9800000002", NOW)).toBe(2);
    const after = await loadUnmatchedMessages(NOW);
    expect(countUnread(after)).toBe(1);
    expect(after.find((m) => m.isUnread)?.phoneKey).toBe("9800000003");
  });

  it("a later message from the same number is unread again", async () => {
    writeWebhookFile([BUYER_1]);
    await markUnmatchedSenderSeen("9800000002", NOW);
    expect(countUnread(await loadUnmatchedMessages(NOW))).toBe(0);
    writeWebhookFile([BUYER_1, BUYER_2]); // the webhook appends
    const after = await loadUnmatchedMessages(NOW);
    expect(countUnread(after)).toBe(1);
    expect(after[0].text).toBe(BUYER_2.text);
  });

  it("ignores ids that are not in the file and is a no-op the second time", async () => {
    writeWebhookFile([BUYER_1]);
    expect(await markUnmatchedSeen(["mdeadbeefdeadbeef"], NOW)).toBe(0);
    expect(fs.existsSync(path.join(root, UNMATCHED_SEEN_FILE_NAME))).toBe(false);
    const [m] = await loadUnmatchedMessages(NOW);
    expect(await markUnmatchedSeen([m.id], NOW)).toBe(1);
    expect(await markUnmatchedSeen([m.id], NOW)).toBe(0);
  });

  it("an unreadable seen file means nothing is seen, not an error", async () => {
    writeWebhookFile([BUYER_1]);
    fs.writeFileSync(path.join(root, UNMATCHED_SEEN_FILE_NAME), "- [unclosed\n  : :\n", "utf-8");
    expect(countUnread(await loadUnmatchedMessages(NOW))).toBe(1);
  });
});

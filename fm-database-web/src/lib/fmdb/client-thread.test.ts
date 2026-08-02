/**
 * Tests for the in-app client chat store.
 *
 * Runs against real temp files — the point of this module is its filesystem
 * and two-host behaviour, so mocking fs would test nothing that matters.
 *
 * The load-bearing property is the LAST describe block: two hosts writing the
 * same conversation must never touch each other's file, because the two trees
 * are reconciled by Mutagen and a conflict here would silently swallow a
 * coach's reply.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appendMessage,
  clientDir,
  currentHost,
  dedupeSort,
  markRead,
  mergeForDisplay,
  readThread,
  threadFileName,
  unreadCount,
  type ThreadMessage,
} from "./client-thread";

let root: string;
const ID = "cl-test";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thread-"));
  fs.mkdirSync(path.join(root, "clients", ID), { recursive: true });
  process.env.FMDB_PLANS_DIR = root;
  delete process.env.FLY_APP_NAME;
  delete process.env.FLY_INTAKE_ONLY;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.FMDB_PLANS_DIR;
  delete process.env.FLY_APP_NAME;
  delete process.env.FLY_INTAKE_ONLY;
});

const dirOf = (host: string) => path.join(root, "clients", ID, threadFileName(host));

describe("append and read", () => {
  it("round-trips a message", () => {
    const m = appendMessage(ID, { dir: "inbound", kind: "text", text: "hello" });
    expect(m).not.toBeNull();
    const all = readThread(ID);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe("hello");
    expect(all[0].dir).toBe("inbound");
    expect(all[0].read_at).toBeNull();
  });

  it("orders oldest first regardless of write order", () => {
    appendMessage(ID, { dir: "inbound", kind: "text", text: "second", at: "2026-08-02T10:00:00Z" });
    appendMessage(ID, { dir: "outbound", kind: "text", text: "first", at: "2026-08-01T10:00:00Z" });
    expect(readThread(ID).map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("returns empty for an unknown client rather than throwing", () => {
    expect(readThread("cl-nope")).toEqual([]);
    expect(appendMessage("cl-nope", { dir: "inbound", kind: "text", text: "x" })).toBeNull();
  });

  it("refuses a path-traversal client id", () => {
    for (const bad of ["../etc", "..", "a/b", ""]) {
      expect(clientDir(bad)).toBeNull();
    }
  });

  it("finds a prospect as well as a client", () => {
    fs.mkdirSync(path.join(root, "prospects", "cl-pros"), { recursive: true });
    expect(appendMessage("cl-pros", { dir: "inbound", kind: "text", text: "hi" })).not.toBeNull();
    expect(readThread("cl-pros")).toHaveLength(1);
  });
});

describe("durability", () => {
  it("survives a torn final line instead of losing the file", () => {
    appendMessage(ID, { dir: "inbound", kind: "text", text: "kept" });
    fs.appendFileSync(dirOf("mac"), '{"id":"x","at":"2026');  // interrupted write
    const all = readThread(ID);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe("kept");
  });

  it("drops lines with no id or timestamp — they cannot be ordered", () => {
    fs.writeFileSync(
      dirOf("mac"),
      '{"dir":"inbound","text":"no id"}\n{"id":"a","dir":"inbound","text":"no at"}\n',
    );
    expect(readThread(ID)).toHaveLength(0);
  });
});

describe("read state", () => {
  it("counts unread inbound, then clears it", () => {
    appendMessage(ID, { dir: "inbound", kind: "text", text: "a" });
    appendMessage(ID, { dir: "inbound", kind: "text", text: "b" });
    appendMessage(ID, { dir: "outbound", kind: "text", text: "mine" });
    expect(unreadCount(ID, "inbound")).toBe(2);

    expect(markRead(ID, "inbound")).toBe(2);
    expect(unreadCount(ID, "inbound")).toBe(0);
    // The coach reading the client's messages must not mark her own as read.
    expect(unreadCount(ID, "outbound")).toBe(1);
  });

  it("marking read appends rather than rewriting, and does not duplicate", () => {
    appendMessage(ID, { dir: "inbound", kind: "text", text: "a" });
    const before = fs.readFileSync(dirOf("mac"), "utf8").split("\n").filter(Boolean).length;
    markRead(ID, "inbound");
    const after = fs.readFileSync(dirOf("mac"), "utf8").split("\n").filter(Boolean).length;
    expect(after).toBe(before + 1); // appended
    expect(readThread(ID)).toHaveLength(1); // but still ONE message
    expect(readThread(ID)[0].read_at).toBeTruthy();
  });

  it("is a no-op when nothing is unread", () => {
    expect(markRead(ID, "inbound")).toBe(0);
  });
});

describe("two hosts — the property that makes sync safe", () => {
  it("each host writes only its OWN file", () => {
    appendMessage(ID, { dir: "outbound", kind: "text", text: "from the mac" });
    process.env.FLY_INTAKE_ONLY = "1";
    expect(currentHost()).toBe("fly");
    appendMessage(ID, { dir: "inbound", kind: "text", text: "from fly" });

    expect(fs.existsSync(dirOf("mac"))).toBe(true);
    expect(fs.existsSync(dirOf("fly"))).toBe(true);
    // The decisive assertion: neither file contains the other's message, so
    // the two trees can never conflict on the same bytes.
    expect(fs.readFileSync(dirOf("mac"), "utf8")).not.toContain("from fly");
    expect(fs.readFileSync(dirOf("fly"), "utf8")).not.toContain("from the mac");
  });

  it("reads merge both hosts into one conversation", () => {
    appendMessage(ID, { dir: "outbound", kind: "text", text: "mac", at: "2026-08-01T09:00:00Z" });
    process.env.FLY_INTAKE_ONLY = "1";
    appendMessage(ID, { dir: "inbound", kind: "text", text: "fly", at: "2026-08-01T10:00:00Z" });
    expect(readThread(ID).map((m) => m.text)).toEqual(["mac", "fly"]);
  });

  it("a message duplicated by a sync hiccup appears once", () => {
    const m = appendMessage(ID, { dir: "inbound", kind: "text", text: "once" })!;
    fs.writeFileSync(dirOf("fly"), JSON.stringify(m) + "\n"); // same id, other host
    expect(readThread(ID)).toHaveLength(1);
  });

  it("a read stamp written on one host wins over the unstamped copy", () => {
    const m: ThreadMessage = {
      id: "m1", at: "2026-08-01T09:00:00Z", dir: "inbound", kind: "text",
      text: "hi", read_at: null,
    };
    const stamped = { ...m, read_at: "2026-08-01T10:00:00Z" };
    expect(dedupeSort([m, stamped])[0].read_at).toBe("2026-08-01T10:00:00Z");
    expect(dedupeSort([stamped, m])[0].read_at).toBe("2026-08-01T10:00:00Z");
  });
});

describe("merged view with WhatsApp", () => {
  it("interleaves both channels chronologically and labels each", () => {
    const app: ThreadMessage[] = [
      { id: "a1", at: "2026-08-01T10:00:00Z", dir: "inbound", kind: "text", text: "in app" },
    ];
    const wa = [
      { direction: "outbound" as const, date: "2026-08-01T09:00:00Z", text: "on whatsapp" },
    ];
    const merged = mergeForDisplay(app, wa);
    expect(merged.map((m) => m.text)).toEqual(["on whatsapp", "in app"]);
    expect(merged.map((m) => m.via)).toEqual(["whatsapp", "app"]);
  });

  it("keeps WhatsApp attachments and template names visible", () => {
    const merged = mergeForDisplay([], [
      {
        direction: "inbound", date: "2026-08-01T09:00:00Z", text: "",
        attachment: { name: "lab.jpg", kind: "image" },
      },
      { direction: "outbound", date: "2026-08-01T10:00:00Z", text: "hi", template_name: "fm_x" },
    ]);
    expect(merged[0].file).toBe("lab.jpg");
    expect(merged[0].kind).toBe("image");
    expect(merged[1].template_name).toBe("fm_x");
  });

  it("gives every row a stable id, so nothing renders twice", () => {
    const wa = [{ direction: "inbound" as const, date: "2026-08-01T09:00:00Z", text: "same" }];
    const a = mergeForDisplay([], wa).map((m) => m.id);
    const b = mergeForDisplay([], wa).map((m) => m.id);
    expect(a).toEqual(b);
    expect(mergeForDisplay([], [...wa, ...wa])).toHaveLength(1);
  });

  it("skips WhatsApp rows with no date rather than sorting them to the top", () => {
    const merged = mergeForDisplay([], [
      { direction: "inbound", date: "", text: "undated" },
      { direction: "inbound", date: "2026-08-01T09:00:00Z", text: "dated" },
    ]);
    expect(merged.map((m) => m.text)).toEqual(["dated"]);
  });
});

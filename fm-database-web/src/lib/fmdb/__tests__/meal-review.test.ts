/**
 * Shadow-mode review state (docs/MEAL_PHOTO_CHECK_SPEC.md).
 *
 * In shadow mode the coach's verdict IS the dataset — nothing else is being
 * collected — so losing one is losing the calibration. And a verdict she
 * cannot change is one she stops trusting, so the last call wins.
 *
 * The pin carries a second job: it exempts a photo from the 365-day media
 * sweep. The spec requires a flagged photo to outlive the window, which only
 * holds if the pin and the sweep actually agree about which files those are
 * — tested here together rather than separately, because that is where they
 * would silently disagree.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

let root: string;
async function thread() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../client-thread");
}
async function media() {
  process.env.FMDB_PLANS_DIR = root;
  return import("../chat-media");
}
const jpeg = () =>
  sharp({ create: { width: 40, height: 40, channels: 3, background: "#c07" } })
    .jpeg()
    .toBuffer();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "meal-"));
  fs.mkdirSync(path.join(root, "clients", "cl-x"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("meal review", () => {
  it("records the coach's verdict", async () => {
    const t = await thread();
    const m = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: "a.jpg" })!;
    expect(t.reviewPhoto("cl-x", m.id, { coach_verdict: "agree" })).toBe(true);
    expect(t.readThread("cl-x")[0].coach_verdict).toBe("agree");
  });

  it("lets her change her mind — the last call wins", async () => {
    const t = await thread();
    const m = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: "a.jpg" })!;
    t.reviewPhoto("cl-x", m.id, { coach_verdict: "agree" });
    t.reviewPhoto("cl-x", m.id, { coach_verdict: "disagree" });
    expect(t.readThread("cl-x")[0].coach_verdict).toBe("disagree");
  });

  it("lets her clear a verdict entirely", async () => {
    const t = await thread();
    const m = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: "a.jpg" })!;
    t.reviewPhoto("cl-x", m.id, { coach_verdict: "agree" });
    t.reviewPhoto("cl-x", m.id, { coach_verdict: null });
    expect(t.readThread("cl-x")[0].coach_verdict).toBeFalsy();
  });

  it("a verdict does not disturb delivery or read stamps", async () => {
    const t = await thread();
    const m = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: "a.jpg" })!;
    t.markDelivered("cl-x", m.id);
    t.markRead("cl-x", "inbound");
    t.reviewPhoto("cl-x", m.id, { coach_verdict: "agree" });
    const row = t.readThread("cl-x")[0];
    expect(row.delivered_at).toBeTruthy();
    expect(row.read_at).toBeTruthy();
    expect(row.coach_verdict).toBe("agree");
  });

  it("refuses an unknown message rather than inventing one", async () => {
    const t = await thread();
    expect(t.reviewPhoto("cl-x", "nope", { coach_verdict: "agree" })).toBe(false);
  });

  it("pinning survives the 12-month sweep; an unpinned photo does not", async () => {
    const md = await media();
    const a = (await md.saveChatPhoto("cl-x", await jpeg()))!;
    const b = (await md.saveChatPhoto("cl-x", await jpeg()))!;
    const t = await thread();
    t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: a.file });
    const keep = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: b.file })!;
    t.reviewPhoto("cl-x", keep.id, { pinned: true });

    const dir = path.join(root, "clients", "cl-x", "files", "chat");
    const ancient = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    for (const f of [a.file, b.file]) fs.utimesSync(path.join(dir, f), ancient, ancient);

    // The sweep's keep-list comes from the pins — if these two ever disagree,
    // a photo the coach kept is deleted anyway.
    const res = await md.purgeOldChatMedia("cl-x", t.pinnedFiles("cl-x"));
    expect(res).toEqual({ deleted: 1, kept: 1 });
    expect(fs.existsSync(path.join(dir, b.file))).toBe(true);
    expect(fs.existsSync(path.join(dir, a.file))).toBe(false);
  });

  it("unpinning puts it back in reach of the sweep", async () => {
    const t = await thread();
    const m = t.appendMessage("cl-x", { dir: "inbound", kind: "photo", text: "", file: "a.jpg" })!;
    t.reviewPhoto("cl-x", m.id, { pinned: true });
    expect(t.pinnedFiles("cl-x").has("a.jpg")).toBe(true);
    t.reviewPhoto("cl-x", m.id, { pinned: false });
    expect(t.pinnedFiles("cl-x").has("a.jpg")).toBe(false);
  });
});

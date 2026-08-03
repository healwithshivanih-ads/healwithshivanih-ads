/**
 * Client photos are the most sensitive thing this app will hold.
 *
 * A meal photographed at home carries the client's home GPS in its EXIF, and
 * that file syncs to two hosts. So every upload is RE-ENCODED rather than
 * stored: that strips the metadata and doubles as validation, since a file
 * sharp cannot decode is not an image whatever its Content-Type claimed.
 * Filenames are ours, never the uploader's — a client-supplied name is an
 * attacker-supplied path.
 *
 * The retention sweep is the other sharp edge: clients/<id>/files/ holds lab
 * PDFs that must be kept forever, so the sweep is confined to files/chat/
 * and refuses to touch a name it did not generate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

let root: string;
async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../chat-media");
}

/** A real JPEG, with GPS EXIF attached the way a phone would. */
async function photoWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 2400, height: 1800, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .withExif({ IFD0: { Copyright: "client" }, GPS: { GPSLatitudeRef: "N" } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
  fs.mkdirSync(path.join(root, "clients", "cl-x"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("chat photos", () => {
  it("strips EXIF — the client's home coordinates never reach disk", async () => {
    const m = await mod();
    const saved = await m.saveChatPhoto("cl-x", await photoWithGps());
    expect(saved).not.toBeNull();
    const stored = await m.readChatPhoto("cl-x", saved!.file);
    const meta = await sharp(stored!).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("shrinks oversized photos rather than storing what the camera produced", async () => {
    const m = await mod();
    const saved = await m.saveChatPhoto("cl-x", await photoWithGps());
    expect(Math.max(saved!.width, saved!.height)).toBeLessThanOrEqual(1600);
  });

  it("refuses a file that is not an image, however it is labelled", async () => {
    const m = await mod();
    expect(await m.saveChatPhoto("cl-x", Buffer.from("<?php system($_GET[0]); ?>"))).toBeNull();
  });

  it("refuses an upload past the size ceiling before decoding it", async () => {
    const m = await mod();
    expect(await m.saveChatPhoto("cl-x", Buffer.alloc(m.MAX_UPLOAD_BYTES + 1))).toBeNull();
  });

  it("names the file itself — an uploader never influences the path", async () => {
    const m = await mod();
    const saved = await m.saveChatPhoto("cl-x", await photoWithGps());
    expect(saved!.file).toMatch(/^[a-f0-9-]{36}\.jpg$/);
  });

  it("refuses to serve a path that climbs out of the client's folder", async () => {
    const m = await mod();
    for (const bad of ["../../client.yaml", "../_thread.fly.jsonl", "/etc/passwd", "a.jpg"]) {
      expect(m.mediaPath("cl-x", bad)).toBeNull();
    }
  });

  it("refuses a client id that is itself a path", async () => {
    const m = await mod();
    expect(m.mediaPath("../../..", "0".repeat(8) + "-0000-0000-0000-000000000000.jpg")).toBeNull();
  });

  it("purges photos past the window but keeps pinned ones", async () => {
    const m = await mod();
    const old = await m.saveChatPhoto("cl-x", await photoWithGps());
    const pinned = await m.saveChatPhoto("cl-x", await photoWithGps());
    const dir = path.join(root, "clients", "cl-x", "files", "chat");
    const ancient = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(dir, old!.file), ancient, ancient);
    fs.utimesSync(path.join(dir, pinned!.file), ancient, ancient);
    const res = await m.purgeOldChatMedia("cl-x", new Set([pinned!.file]));
    expect(res).toEqual({ deleted: 1, kept: 1 });
    expect(fs.existsSync(path.join(dir, pinned!.file))).toBe(true);
    expect(fs.existsSync(path.join(dir, old!.file))).toBe(false);
  });

  it("keeps recent photos", async () => {
    const m = await mod();
    const fresh = await m.saveChatPhoto("cl-x", await photoWithGps());
    const res = await m.purgeOldChatMedia("cl-x", new Set());
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(path.join(root, "clients", "cl-x", "files", "chat", fresh!.file))).toBe(true);
  });

  it("never deletes a file it did not write — lab PDFs are not its business", async () => {
    const m = await mod();
    await m.saveChatPhoto("cl-x", await photoWithGps());
    const dir = path.join(root, "clients", "cl-x", "files", "chat");
    const foreign = path.join(dir, "bloodwork-2024.pdf");
    fs.writeFileSync(foreign, "pretend pdf");
    const ancient = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    fs.utimesSync(foreign, ancient, ancient);
    await m.purgeOldChatMedia("cl-x", new Set());
    expect(fs.existsSync(foreign)).toBe(true);
  });
});

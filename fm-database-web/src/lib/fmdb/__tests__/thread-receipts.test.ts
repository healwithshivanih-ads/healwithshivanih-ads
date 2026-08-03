/**
 * Receipts must state facts, not hopes.
 *
 * A push service returning 201 says the message left us. It says nothing
 * about whether a phone drew it — Hariharan's Android has been answering 201
 * to every send while displaying none of them. So "Delivered" is only ever
 * written by the receiving DEVICE, via /api/push-receipt, and WhatsApp rows
 * carry no ticks at all because we have no such signal for them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../client-thread");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thread-"));
  fs.mkdirSync(path.join(root, "clients", "cl-x"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("delivery receipts", () => {
  it("a new message is not delivered until a device says so", async () => {
    const m = await mod();
    const sent = m.appendMessage("cl-x", { dir: "outbound", kind: "text", text: "hi" })!;
    expect(m.readThread("cl-x")[0].delivered_at).toBeFalsy();
    expect(m.markDelivered("cl-x", sent.id)).toBe(true);
    expect(m.readThread("cl-x")[0].delivered_at).toBeTruthy();
  });

  it("confirming twice does not move the timestamp — a redraw is not a new arrival", async () => {
    const m = await mod();
    const sent = m.appendMessage("cl-x", { dir: "outbound", kind: "text", text: "hi" })!;
    m.markDelivered("cl-x", sent.id);
    const first = m.readThread("cl-x")[0].delivered_at;
    expect(m.markDelivered("cl-x", sent.id)).toBe(false);
    expect(m.readThread("cl-x")[0].delivered_at).toBe(first);
  });

  it("an unknown message id is refused rather than inventing a row", async () => {
    const m = await mod();
    expect(m.markDelivered("cl-x", "nope")).toBe(false);
  });

  it("a read stamp from one host merges with a delivery stamp from another", async () => {
    // THE case the merge exists for. Within one host both stamps ride along
    // on the appended copy, so same-host tests pass even with the merge
    // removed. Across hosts they genuinely arrive on separate lines in
    // separate files: the client's phone confirms delivery on Fly while the
    // coach's desk marks it read on the Mac, and neither copy knows the
    // other's stamp.
    const dir = path.join(root, "clients", "cl-x");
    const base = { id: "m1", at: "2026-08-03T10:00:00.000Z", dir: "outbound", kind: "text", text: "hi" };
    fs.writeFileSync(
      path.join(dir, "_thread.fly.jsonl"),
      JSON.stringify({ ...base, delivered_at: "2026-08-03T10:00:05.000Z", read_at: null }) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "_thread.mac.jsonl"),
      JSON.stringify({ ...base, delivered_at: null, read_at: "2026-08-03T10:02:00.000Z" }) + "\n",
    );
    const m = await mod();
    const rows = m.readThread("cl-x");
    expect(rows).toHaveLength(1);
    expect(rows[0].delivered_at).toBe("2026-08-03T10:00:05.000Z");
    expect(rows[0].read_at).toBe("2026-08-03T10:02:00.000Z");
  });

  it("delivered and read survive together — a later stamp never drops an earlier one", async () => {
    const m = await mod();
    const sent = m.appendMessage("cl-x", { dir: "outbound", kind: "text", text: "hi" })!;
    m.markDelivered("cl-x", sent.id);
    m.markRead("cl-x", "outbound");
    const row = m.readThread("cl-x")[0];
    expect(row.delivered_at).toBeTruthy();
    expect(row.read_at).toBeTruthy();
  });

  it("read implies nothing was lost when the read stamp lands first", async () => {
    const m = await mod();
    const sent = m.appendMessage("cl-x", { dir: "outbound", kind: "text", text: "hi" })!;
    m.markRead("cl-x", "outbound");
    m.markDelivered("cl-x", sent.id);
    const row = m.readThread("cl-x")[0];
    expect(row.read_at).toBeTruthy();
    expect(row.delivered_at).toBeTruthy();
  });

  it("WhatsApp history carries no delivery claim", async () => {
    const m = await mod();
    const rows = m.mergeForDisplay(
      [],
      [{ date: "2026-08-01T10:00:00Z", direction: "outbound", text: "old" }],
    );
    expect(rows[0].via).toBe("whatsapp");
    expect(rows[0].delivered_at).toBeUndefined();
  });
});

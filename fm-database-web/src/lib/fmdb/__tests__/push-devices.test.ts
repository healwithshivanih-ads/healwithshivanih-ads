/**
 * A client has DEVICES, plural.
 *
 * The store kept exactly one subscription and overwrote it on every
 * subscribe. A client who turned notifications on for a laptop and then a
 * phone silently lost the laptop — and turning them on anywhere other than
 * the phone they actually check is indistinguishable from push being broken,
 * because overwriting SUCCEEDS. These pin the plural behaviour and the
 * legacy read, so nobody has to re-subscribe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;

async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../push-server");
}

const device = (n: string) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: `p-${n}`, auth: `a-${n}` },
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "push-"));
  fs.mkdirSync(path.join(root, "clients", "cl-x"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("client push devices", () => {
  it("keeps both devices when a second one subscribes", async () => {
    const m = await mod();
    await m.saveSubscription("cl-x", device("laptop"));
    await m.saveSubscription("cl-x", device("phone"));
    expect((await m.pushStatus("cl-x")).devices).toBe(2);
  });

  it("refreshes rather than duplicates the same device", async () => {
    const m = await mod();
    await m.saveSubscription("cl-x", device("phone"));
    await m.saveSubscription("cl-x", device("phone"));
    expect((await m.pushStatus("cl-x")).devices).toBe(1);
  });

  it("turning one device off leaves the others working", async () => {
    const m = await mod();
    await m.saveSubscription("cl-x", device("laptop"));
    await m.saveSubscription("cl-x", device("phone"));
    await m.removeSubscription("cl-x", "https://push.example/laptop");
    const s = await m.pushStatus("cl-x");
    expect(s).toEqual({ enabled: true, devices: 1 });
  });

  it("turning off with no endpoint stops everything", async () => {
    const m = await mod();
    await m.saveSubscription("cl-x", device("phone"));
    await m.removeSubscription("cl-x");
    expect((await m.pushStatus("cl-x")).enabled).toBe(false);
  });

  it("still reads a client stored in the old single-subscription shape", async () => {
    fs.writeFileSync(
      path.join(root, "clients", "cl-x", "_push_subscription.yaml"),
      "subscription:\n  endpoint: https://push.example/legacy\n  keys:\n    p256dh: p\n    auth: a\nenabled: true\nupdated_at: '2026-01-01T00:00:00Z'\n",
    );
    const m = await mod();
    expect(await m.pushStatus("cl-x")).toEqual({ enabled: true, devices: 1 });
  });

  it("a legacy client adding a device keeps the legacy one", async () => {
    fs.writeFileSync(
      path.join(root, "clients", "cl-x", "_push_subscription.yaml"),
      "subscription:\n  endpoint: https://push.example/legacy\n  keys:\n    p256dh: p\n    auth: a\nenabled: true\nupdated_at: '2026-01-01T00:00:00Z'\n",
    );
    const m = await mod();
    await m.saveSubscription("cl-x", device("phone"));
    expect((await m.pushStatus("cl-x")).devices).toBe(2);
  });

  it("reports nothing for a client who never subscribed", async () => {
    const m = await mod();
    expect(await m.pushStatus("cl-y")).toEqual({ enabled: false, devices: 0 });
  });
});

describe("delivery options", () => {
  it("sends at high urgency with a TTL — a dozing Android must not batch a coach reply", async () => {
    const sent: unknown[] = [];
    vi.doMock("web-push", () => ({
      default: {
        setVapidDetails: () => {},
        sendNotification: (...a: unknown[]) => {
          sent.push(a[2]);
          return Promise.resolve({ statusCode: 201 });
        },
      },
    }));
    process.env.VAPID_PRIVATE_KEY = "test-key";
    const m = await mod();
    await m.saveSubscription("cl-x", device("phone"));
    await m.sendPushToClient("cl-x", { title: "t", body: "b" });
    expect(sent[0]).toMatchObject({ urgency: "high" });
    expect((sent[0] as { TTL: number }).TTL).toBeGreaterThan(0);
    vi.doUnmock("web-push");
  });
});

/**
 * Tests for the coach's own push subscriptions.
 *
 * Multi-device and host-splitting are the properties that rot silently: a
 * second phone that never rings, or two hosts overwriting each other, both
 * look exactly like "notifications are a bit flaky".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  coachPushEnabled,
  listCoachSubscriptions,
  removeCoachSubscription,
  saveCoachSubscription,
} from "./coach-push";

let root: string;
const sub = (endpoint: string) =>
  ({ endpoint, keys: { p256dh: "k", auth: "a" } }) as never;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "coachpush-"));
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

describe("registering devices", () => {
  it("starts with nothing and reports it honestly", () => {
    expect(listCoachSubscriptions()).toEqual([]);
    expect(coachPushEnabled()).toBe(false);
  });

  it("registers a device", () => {
    expect(saveCoachSubscription(sub("https://push/1"))).toBe(true);
    expect(listCoachSubscriptions()).toHaveLength(1);
    expect(coachPushEnabled()).toBe(true);
  });

  it("keeps several devices — phone AND laptop both ring", () => {
    saveCoachSubscription(sub("https://push/phone"));
    saveCoachSubscription(sub("https://push/laptop"));
    expect(listCoachSubscriptions().map((s) => s.endpoint).sort()).toEqual([
      "https://push/laptop",
      "https://push/phone",
    ]);
  });

  it("re-subscribing the same device refreshes rather than duplicates", () => {
    saveCoachSubscription(sub("https://push/1"));
    saveCoachSubscription(sub("https://push/1"));
    expect(listCoachSubscriptions()).toHaveLength(1);
  });

  it("refuses a subscription with no endpoint", () => {
    expect(saveCoachSubscription({} as never)).toBe(false);
  });

  it("writes the store 0600 — it is a credential", () => {
    saveCoachSubscription(sub("https://push/1"));
    const f = fs.readdirSync(root).find((n) => n.startsWith("_coach_push."))!;
    expect(fs.statSync(path.join(root, f)).mode & 0o777).toBe(0o600);
  });
});

describe("two hosts", () => {
  it("each host writes its own file and reads see both", () => {
    saveCoachSubscription(sub("https://push/mac"));
    process.env.FLY_INTAKE_ONLY = "1";
    saveCoachSubscription(sub("https://push/fly"));

    const names = fs.readdirSync(root).filter((n) => n.startsWith("_coach_push."));
    expect(names.sort()).toEqual(["_coach_push.fly.json", "_coach_push.mac.json"]);
    expect(listCoachSubscriptions()).toHaveLength(2);
  });

  it("one host unsubscribing does not wipe the other's devices", () => {
    saveCoachSubscription(sub("https://push/mac"));
    process.env.FLY_INTAKE_ONLY = "1";
    saveCoachSubscription(sub("https://push/fly"));
    removeCoachSubscription(); // clears Fly's only
    expect(listCoachSubscriptions().map((s) => s.endpoint)).toEqual(["https://push/mac"]);
  });
});

describe("removal", () => {
  it("removes one device by endpoint, leaving the rest", () => {
    saveCoachSubscription(sub("https://push/1"));
    saveCoachSubscription(sub("https://push/2"));
    removeCoachSubscription("https://push/1");
    expect(listCoachSubscriptions().map((s) => s.endpoint)).toEqual(["https://push/2"]);
  });

  it("survives a corrupt store instead of throwing", () => {
    fs.writeFileSync(path.join(root, "_coach_push.mac.json"), "{ not json");
    expect(listCoachSubscriptions()).toEqual([]);
    expect(saveCoachSubscription(sub("https://push/1"))).toBe(true);
  });
});

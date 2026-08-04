/**
 * The coach-set recipe pause.
 *
 * Two properties matter and neither is obvious from reading the helper:
 *
 *   1. It must FAIL OPEN. A missing or corrupt client.yaml means "I don't
 *      know", and "I don't know" must not silently switch off a client the
 *      coach never paused — that failure is invisible for weeks (nothing
 *      appears, and an absent recipe pack looks like a quiet cadence).
 *
 *   2. Setting it must not disturb the rest of the record. It read-modify-
 *      writes a large PHI document; a round-trip that dropped or reordered
 *      unrelated keys would be a far worse bug than the feature is worth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

let root: string;

vi.mock("./paths", () => ({ getPlansRoot: () => root }));

const { weeklyGenerationPaused, setWeeklyGenerationPaused } = await import("./weekly-generation-pause");

async function writeClient(id: string, doc: Record<string, unknown>) {
  const dir = path.join(root, "clients", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "client.yaml"), yaml.dump(doc), "utf-8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-weekly-gen-pause-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("weeklyGenerationPaused", () => {
  it("is false for a client with no flag", async () => {
    await writeClient("cl-x", { client_id: "cl-x", display_name: "X" });
    expect(await weeklyGenerationPaused("cl-x")).toBe(false);
  });

  it("is true only for an explicit boolean true", async () => {
    await writeClient("cl-a", { client_id: "cl-a", weekly_generation_paused: true });
    await writeClient("cl-b", { client_id: "cl-b", weekly_generation_paused: false });
    // A truthy STRING must not pause anyone — YAML turns an unquoted `yes`
    // into a boolean but a quoted "true" into a string, and only one of
    // those is the coach saying pause.
    await writeClient("cl-c", { client_id: "cl-c", weekly_generation_paused: "true" });
    expect(await weeklyGenerationPaused("cl-a")).toBe(true);
    expect(await weeklyGenerationPaused("cl-b")).toBe(false);
    expect(await weeklyGenerationPaused("cl-c")).toBe(false);
  });

  it("fails OPEN when the client record is missing", async () => {
    expect(await weeklyGenerationPaused("cl-does-not-exist")).toBe(false);
  });

  it("fails OPEN when the client record is unreadable", async () => {
    const dir = path.join(root, "clients", "cl-bad");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "client.yaml"), "{{ not: valid: yaml", "utf-8");
    expect(await weeklyGenerationPaused("cl-bad")).toBe(false);
  });
});

describe("setWeeklyGenerationPaused", () => {
  it("round-trips without disturbing other fields", async () => {
    await writeClient("cl-r", {
      client_id: "cl-r",
      display_name: "Round Trip",
      version: 4,
      active_conditions: ["Hashimoto's"],
      nested: { a: 1, b: [1, 2, 3] },
    });
    expect((await setWeeklyGenerationPaused("cl-r", true)).ok).toBe(true);

    const doc = yaml.load(
      await fs.readFile(path.join(root, "clients", "cl-r", "client.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(doc.weekly_generation_paused).toBe(true);
    expect(doc.display_name).toBe("Round Trip");
    expect(doc.active_conditions).toEqual(["Hashimoto's"]);
    expect(doc.nested).toEqual({ a: 1, b: [1, 2, 3] });
    expect(doc.version).toBe(5); // bumped
    expect(await weeklyGenerationPaused("cl-r")).toBe(true);
  });

  it("resumes, and is a no-op when already in the target state", async () => {
    await writeClient("cl-n", { client_id: "cl-n", version: 2, weekly_generation_paused: true });
    expect((await setWeeklyGenerationPaused("cl-n", true)).ok).toBe(true);
    let doc = yaml.load(
      await fs.readFile(path.join(root, "clients", "cl-n", "client.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(doc.version).toBe(2); // untouched — no write, no version churn

    expect((await setWeeklyGenerationPaused("cl-n", false)).ok).toBe(true);
    doc = yaml.load(
      await fs.readFile(path.join(root, "clients", "cl-n", "client.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(doc.weekly_generation_paused).toBe(false);
    expect(doc.version).toBe(3);
    expect(await weeklyGenerationPaused("cl-n")).toBe(false);
  });

  it("reports an error rather than throwing when the client is missing", async () => {
    const res = await setWeeklyGenerationPaused("cl-nope", true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cl-nope/);
  });
});

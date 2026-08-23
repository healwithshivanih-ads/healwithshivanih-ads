/**
 * An unreadable client.yaml must not read as a client SETTING.
 *
 * Two helpers load `clients/<id>/client.yaml` with their own `fs.readFile` +
 * `yaml.load` rather than going through loader.ts's `readYaml()`, so they never
 * got its guard (skip-and-log the unparseable, surface real I/O errors, treat
 * only ENOENT as "no file"). Each collapsed every failure into its default:
 *
 *   somatic.ts      loadMindBodyDepth -> "off"
 *   weekly-menu.ts  mealPlanStyle     -> "hybrid"
 *
 * The trigger is real, not hypothetical. A client.yaml with the SAME top-level
 * key twice makes js-yaml throw `duplicated mapping key`, while PyYAML tolerates
 * it last-wins — so every Python shim keeps working and the corruption stays
 * invisible on the TypeScript side. That is the cl-021 incident (2026-07-07),
 * and it is why /api/cron/client-yaml-integrity exists.
 *
 * The two directions are NOT equally bad, which is why they are fixed
 * differently and asserted differently here:
 *
 *   "off" fails CLOSED and is coach-display only (the client app reads
 *   mind_body_depth straight off its own loaded record, never via this action),
 *   so it stays — but it must LOG, or a coach reads "closed" for someone who is
 *   actually at `deep`.
 *
 *   "hybrid" failed OPEN, and that one is a behaviour change. `principles` is
 *   the value that means "no weekly menu by design"; anything else means draft
 *   one. So a corrupt file read as consent, and the cron would draft a weekly
 *   menu for a client who had opted out of having one.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";

/** Duplicate top-level key — the exact shape that took cl-021 down. */
const CORRUPT_CLIENT_YAML = [
  "client_id: cl-corrupt",
  "app_token: null",
  "meal_plan_style: principles",
  "mind_body_depth: deep",
  "app_token: real-token-appended-later",
  "",
].join("\n");

const HEALTHY_CLIENT_YAML = ["client_id: cl-ok", "display_name: Ok Client", ""].join("\n");

/** Enough plan for the queue sweep to consider the week due (no weeks loaded). */
function planYaml(clientId: string, slug: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `slug: ${slug}`,
    `client_id: ${clientId}`,
    `meal_plan_started_on: ${today}`,
    "plan_period_weeks: 12",
    "app_menu:",
    "  weeks: []",
    "",
  ].join("\n");
}

let root: string;
let prevRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fm-plans-test-"));
  await mkdir(path.join(root, "clients", "cl-corrupt"), { recursive: true });
  await mkdir(path.join(root, "clients", "cl-ok"), { recursive: true });
  await mkdir(path.join(root, "published"), { recursive: true });
  await writeFile(path.join(root, "clients", "cl-corrupt", "client.yaml"), CORRUPT_CLIENT_YAML);
  await writeFile(path.join(root, "clients", "cl-ok", "client.yaml"), HEALTHY_CLIENT_YAML);
  await writeFile(path.join(root, "published", "cl-corrupt-plan.yaml"), planYaml("cl-corrupt", "cl-corrupt-plan"));
  await writeFile(path.join(root, "published", "cl-ok-plan.yaml"), planYaml("cl-ok", "cl-ok-plan"));
  // getPlansRoot() reads the env on every call, so setting it here is enough.
  prevRoot = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterAll(async () => {
  if (prevRoot === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevRoot;
  await rm(root, { recursive: true, force: true });
});

describe("the mechanism", () => {
  it("js-yaml refuses a duplicate top-level key", () => {
    // If js-yaml ever starts tolerating this the way PyYAML does, the two
    // assertions below become vacuous rather than failing — so pin it.
    expect(() => yaml.load(CORRUPT_CLIENT_YAML)).toThrow(/duplicated mapping key/i);
  });
});

describe("mind_body_depth (must not answer a consent question it could not read)", () => {
  it("reports the corrupt file instead of defaulting to off", async () => {
    const errs: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => void errs.push(a));
    try {
      const { loadMindBodyDepth } = await import("../somatic");
      const r = await loadMindBodyDepth("cl-corrupt");
      // The file says `deep`. Answering "off" would have told the coach this
      // client's mind-body layer is closed when it is fully open — and since
      // "off" is the true value for nearly every client, nothing about that
      // answer would have looked wrong.
      expect(r.ok).toBe(false);
      expect(errs.some((a) => String(a[0]).includes("cl-corrupt"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("still answers off for a healthy client with the key absent", async () => {
    // The guard above must not have turned the ordinary case into an error:
    // an absent key is a real, valid "not opened", reached without the catch.
    const { loadMindBodyDepth } = await import("../somatic");
    const r = await loadMindBodyDepth("cl-ok");
    expect(r).toEqual({ ok: true, depth: "off" });
  });
});

describe("meal_plan_style (used to fail OPEN)", () => {
  it("drops a client whose client.yaml cannot be read out of the auto-draft queue", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { weeklyMenuQueueAction } = await import("../weekly-menu");
      const rows = await weeklyMenuQueueAction();
      const ids = rows.map((r) => r.clientId);

      // The healthy client proves the fixture actually produces due rows —
      // without this the assertion below would pass on an empty queue.
      expect(ids).toContain("cl-ok");

      // The corrupt one must NOT be queued. Before the fix mealPlanStyle
      // answered "hybrid" here, which is not "principles", so this client
      // sailed through the opt-out check and got queued for an unattended
      // draft — on a file that actually says `meal_plan_style: principles`.
      expect(ids).not.toContain("cl-corrupt");
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});

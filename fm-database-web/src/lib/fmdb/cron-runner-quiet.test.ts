import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pins the quiet-logging predicate in `scripts/cron-runner.js`.
 *
 * The three per-minute crons (pending-sends / intake-reconcile / app-reminders)
 * fire 1440x/day each and used to log a success line every run — 316k lines /
 * 55 MB in three months, ~99% of it "I ran, nothing to do". They now log only
 * on real activity or error. That is only safe while the predicate keeps
 * classifying real payloads correctly, so this asserts it against payloads
 * captured live off the running app on 2026-08-22.
 *
 * THE TRAP THIS EXISTS TO CATCH: the obvious predicate — "any action that is
 * not `noop` means something happened" — silences NOTHING, because the real
 * steady state is `skipped_coach_newer` (54,749 occurrences in 3 months vs 7
 * genuine events). Any future edit must keep the steady-state cases noisy=false
 * AND the seven real event kinds noisy=true.
 */

const runnerSrc = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/cron-runner.js"),
  "utf8",
);

// Lift the pure predicate block out of the real source. Importing the module
// would start node-cron's schedules and never return.
function loadIsNoise(): (job: string, body: string) => boolean {
  const start = runnerSrc.indexOf("const QUIET_JOBS");
  const end = runnerSrc.indexOf("async function fire(job)");
  expect(start, "QUIET_JOBS block not found — did cron-runner.js get restructured?").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(runnerSrc.slice(start, end) + "\nreturn isNoise;")() as (j: string, b: string) => boolean;
}
const isNoise = loadIsNoise();

/** Captured live from the running app, 2026-08-22. Two consecutive runs were byte-identical. */
const LIVE_RECONCILE = {
  ok: true,
  reconciled: [
    { client_id: "cl-004", actions: ["noop"] as string[] },
    { client_id: "cl-005", actions: ["skipped_coach_newer"] as string[] },
  ],
  purged: ["cl-004", "cl-005"],
  app_staging: { ok: true, refreshed: 19, checkins_mirrored: 0, purged: 0, errors: [] as string[] },
  coach_staging: { ok: true, people: 23, bytes: 0, unchanged: 24, notes_drained: 0, dry_run: false },
};
const LIVE_PENDING = { ok: true, fired: 0, failed: 0, errors: [] };
const LIVE_REMINDERS = { ok: true, today: "2026-08-22", sent: 0, skipped: 0, detail: { sent: [], skipped: [] } };

const recon = (mut: (c: typeof LIVE_RECONCILE) => void) => {
  const c = structuredClone(LIVE_RECONCILE);
  mut(c);
  return JSON.stringify(c);
};

describe("cron-runner quiet predicate", () => {
  it("suppresses the real idle payloads", () => {
    expect(isNoise("intake-reconcile", JSON.stringify(LIVE_RECONCILE))).toBe(true);
    expect(isNoise("pending-sends", JSON.stringify(LIVE_PENDING))).toBe(true);
    expect(isNoise("app-reminders", JSON.stringify(LIVE_REMINDERS))).toBe(true);
  });

  it("keeps skipped_coach_newer quiet — it is the steady state, not an event", () => {
    expect(isNoise("intake-reconcile", recon((c) => {
      c.reconciled.forEach((r) => (r.actions = ["skipped_coach_newer"]));
    }))).toBe(true);
  });

  it.each(["draft_mirrored", "submission_merged", "submission_marker_only"])(
    "logs the real event %s", (action) => {
      expect(isNoise("intake-reconcile", recon((c) => { c.reconciled[0].actions = [action]; }))).toBe(false);
    },
  );

  it("logs nested staging activity", () => {
    expect(isNoise("intake-reconcile", recon((c) => { c.app_staging.checkins_mirrored = 2; }))).toBe(false);
    expect(isNoise("intake-reconcile", recon((c) => { c.app_staging.purged = 1; }))).toBe(false);
    expect(isNoise("intake-reconcile", recon((c) => { c.app_staging.errors = ["boom"]; }))).toBe(false);
    expect(isNoise("intake-reconcile", recon((c) => { c.app_staging.ok = false; }))).toBe(false);
    expect(isNoise("intake-reconcile", recon((c) => { c.coach_staging.notes_drained = 3; }))).toBe(false);
    expect(isNoise("intake-reconcile", recon((c) => { c.coach_staging.bytes = 128; }))).toBe(false);
  });

  it("ignores scan counters that are constant every run", () => {
    expect(isNoise("intake-reconcile", recon((c) => { c.app_staging.refreshed = 99; }))).toBe(true);
    expect(isNoise("intake-reconcile", recon((c) => { c.coach_staging.unchanged = 99; }))).toBe(true);
    expect(isNoise("intake-reconcile", recon((c) => { c.coach_staging.people = 99; }))).toBe(true);
    expect(isNoise("intake-reconcile", recon((c) => { c.purged = ["a", "b", "c"]; }))).toBe(true);
  });

  it("logs pending-sends and app-reminders activity", () => {
    expect(isNoise("pending-sends", '{"ok":true,"fired":1,"failed":0,"errors":[]}')).toBe(false);
    expect(isNoise("pending-sends", '{"ok":true,"fired":0,"failed":1,"errors":[]}')).toBe(false);
    expect(isNoise("pending-sends", '{"ok":true,"fired":0,"failed":0,"errors":["x"]}')).toBe(false);
    expect(isNoise("app-reminders", '{"ok":true,"sent":1,"skipped":0}')).toBe(false);
    expect(isNoise("app-reminders", '{"ok":true,"sent":0,"skipped":1}')).toBe(false);
  });

  it("fails loud rather than silent", () => {
    expect(isNoise("pending-sends", '{"ok":false,"fired":0}')).toBe(false);
    expect(isNoise("pending-sends", "not json")).toBe(false);
    expect(isNoise("pending-sends", "")).toBe(false);
    expect(isNoise("pending-sends", "null")).toBe(false);
    expect(isNoise("pending-sends", "[]")).toBe(false);
  });

  it("goes loud if a response field is ever renamed", () => {
    expect(isNoise("pending-sends", '{"ok":true,"dispatched":0}')).toBe(false);
    expect(isNoise("app-reminders", '{"ok":true,"delivered":0}')).toBe(false);
    expect(isNoise("intake-reconcile", '{"ok":true,"clients":[]}')).toBe(false);
  });

  it("never quiets the daily jobs", () => {
    for (const job of ["renewal-sweep", "revenue-export", "client-yaml-integrity"]) {
      expect(isNoise(job, '{"ok":true}')).toBe(false);
    }
  });

  it("still schedules an hourly heartbeat, so a dead cron cannot look idle", () => {
    expect(runnerSrc).toContain('"0 * * * *"');
    expect(runnerSrc).toContain("hourly ·");
  });
});

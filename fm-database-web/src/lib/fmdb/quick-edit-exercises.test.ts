/**
 * Quick-edit must not eat a client's exercise session.
 *
 * THE BUG THIS PINS. `quickEditActivePlanPractice` replaces the session
 * wholesale whenever `exercises` is present on the patch, so the panel sends the
 * current list on every save. The panel builds that list from the row it was
 * handed — and the row builder in the plan page originally dropped `exercises`.
 * The result: open a published plan, fix a typo in a practice name, and the
 * whole prescribed session is deleted. Silently, because a name edit reports
 * success.
 *
 * That is a one-line omission in a file far away from the one that does the
 * damage, which is exactly the kind of coupling a test has to hold down.
 *
 * Runs against a temp plans root via FMDB_PLANS_DIR so it never touches real
 * client data.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The action revalidates Next's cache after writing. Outside a request scope
// that throws ("static generation store missing"), which the action's own
// try/catch would report as a failed edit — so the mock is about reaching the
// code under test, not about skipping it. The YAML write happens first and is
// what these assertions read.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

const SLUG = "test-plan-exercises";
let root: string;

function planPath() {
  return path.join(root, "published", `${SLUG}-v1.yaml`);
}

function writePlan(practices: unknown[]) {
  fs.mkdirSync(path.join(root, "published"), { recursive: true });
  fs.writeFileSync(
    planPath(),
    yaml.dump({
      slug: SLUG,
      client_id: "cl-test",
      status: "published",
      version: 1,
      lifestyle_practices: practices,
      status_history: [],
    }),
    "utf8",
  );
}

function readPractices(): Record<string, unknown>[] {
  const d = yaml.load(fs.readFileSync(planPath(), "utf8")) as Record<string, unknown>;
  return (d.lifestyle_practices as Record<string, unknown>[]) ?? [];
}

const SESSION = [
  { exercise: "joint-mobilising-sequence", level: null, note: "" },
  { exercise: "chair-sit-to-stand", level: "B", note: "cushion if the knee grumbles" },
];

describe("quickEditActivePlanPractice — exercise sessions", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fmplans-"));
    process.env.FMDB_PLANS_DIR = root;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.FMDB_PLANS_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function edit(patch: Record<string, unknown>) {
    const mod = await import("@/lib/server-actions/plan-lifecycle");
    return mod.quickEditActivePlanPractice(SLUG, patch as never);
  }

  it("keeps the session when the coach edits only the practice name", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    // Exactly what the panel posts: the name changed, the session unchanged.
    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Strength & balance",
      cadence: "3x/week",
      details: "",
      exercises: SESSION,
    });

    expect(r.ok).toBe(true);
    const row = readPractices()[0];
    expect(row.name).toBe("Strength & balance");
    expect(row.exercises).toHaveLength(2);
  });

  it("changes a level in place — the whole point of editing a published plan", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    const advanced = SESSION.map((e) =>
      e.exercise === "chair-sit-to-stand" ? { ...e, level: "C" } : e,
    );
    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Movement session",
      exercises: advanced,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(true);
    const rows = readPractices()[0].exercises as { exercise: string; level: string }[];
    expect(rows.find((e) => e.exercise === "chair-sit-to-stand")?.level).toBe("C");
  });

  it("treats a REORDER as a change — order is the prescription", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    const reversed = [...SESSION].reverse();
    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Movement session",
      exercises: reversed,
    });

    expect(r.ok).toBe(true);
    // A per-field diff would call this identical and save nothing, leaving the
    // warm-up after the strength work exactly where the coach moved it from.
    if (r.ok) expect(r.changed).toBe(true);
    const rows = readPractices()[0].exercises as { exercise: string }[];
    expect(rows[0].exercise).toBe("chair-sit-to-stand");
  });

  it("saves a per-exercise cadence change — the schedule is data, not prose", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    // The walk inside a strength session is daily. Before `cadence` existed this
    // could only be written as English in the note, where nothing reads it.
    const withCadence = SESSION.map((e) =>
      e.exercise === "chair-sit-to-stand" ? { ...e, cadence: "daily" } : e,
    );
    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Movement session",
      exercises: withCadence,
    });

    expect(r.ok).toBe(true);
    // The change-detection key has to include cadence, or editing only the
    // cadence reports "no change to save" and silently discards it.
    if (r.ok) expect(r.changed).toBe(true);
    const rows = readPractices()[0].exercises as { exercise: string; cadence?: string }[];
    expect(rows.find((e) => e.exercise === "chair-sit-to-stand")?.cadence).toBe("daily");
  });

  it("clears the session only when explicitly given an empty list", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Movement session",
      exercises: [],
    });

    expect(r.ok).toBe(true);
    expect(readPractices()[0].exercises).toBeUndefined();
  });

  it("leaves the session alone when the patch omits it entirely", async () => {
    writePlan([{ name: "Movement session", cadence: "3x/week", exercises: SESSION }]);

    // Any caller that does not know about exercises must not destroy them.
    const r = await edit({
      index: 0,
      originalName: "Movement session",
      name: "Renamed by an older caller",
    });

    expect(r.ok).toBe(true);
    expect(readPractices()[0].exercises).toHaveLength(2);
  });
});

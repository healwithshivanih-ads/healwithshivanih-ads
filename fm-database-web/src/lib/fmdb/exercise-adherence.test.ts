/**
 * The exercise adherence reader.
 *
 * The value of these is mostly in what they refuse to do: no session count is
 * turned into a verdict, and a part-way session is never quietly counted as a
 * finished one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadExerciseAdherence } from "./exercise-adherence";

let root: string;
const CLIENT = "cl-test";

function today(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function writeLog(lines: Record<string, unknown>[]) {
  const dir = path.join(root, "clients", CLIENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "_practice_log.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );
}

const ex = (over: Record<string, unknown> = {}) => ({
  kind: "exercise", date: today(), seconds: 300, completed: true,
  name: "Movement session", ...over,
});

describe("loadExerciseAdherence", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fmplans-"));
    process.env.FMDB_PLANS_DIR = root;
  });
  afterEach(() => {
    delete process.env.FMDB_PLANS_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("treats a missing log as the normal empty state, not an error", async () => {
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.sessions).toEqual([]);
    expect(a.headline).toBe("No sessions logged yet.");
  });

  it("ignores other practice kinds", async () => {
    writeLog([
      { kind: "breath", date: today(), seconds: 300, completed: true },
      { kind: "somatic", date: today(), seconds: 300, completed: true },
      ex(),
    ]);
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.sessions).toHaveLength(1);
  });

  it("counts DISTINCT days, not sessions — three in one day is one day", async () => {
    writeLog([ex(), ex(), ex()]);
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.sessions).toHaveLength(3);
    expect(a.days).toBe(1);
  });

  it("keeps part-way sessions visible instead of folding them into the total", async () => {
    writeLog([ex(), ex({ completed: false, seconds: 40 })]);
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.finished).toBe(1);
    expect(a.partial).toBe(1);
    // A client stopping half way is a signal about the session, and a bare
    // "2 sessions" would hide it behind a number that reads as success.
    expect(a.headline).toContain("stopped part-way");
  });

  it("reads a missing `completed` as finished, matching what the shim writes", async () => {
    // save-app-practice.py defaults completed to True when absent, so treating
    // absence as abandonment would under-report every such row.
    writeLog([{ kind: "exercise", date: today(), seconds: 300 }]);
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.finished).toBe(1);
    expect(a.partial).toBe(0);
  });

  it("drops sessions outside the window", async () => {
    writeLog([ex({ date: today(2) }), ex({ date: today(40) })]);
    const a = await loadExerciseAdherence(CLIENT, 28);
    expect(a.sessions).toHaveLength(1);
  });

  it("medians only FINISHED sessions — an abandoned one is not a duration", async () => {
    writeLog([
      ex({ seconds: 600 }),
      ex({ seconds: 300 }),
      ex({ completed: false, seconds: 5 }),
    ]);
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.medianSeconds).toBe(450);
  });

  it("survives a malformed line without losing the rest", async () => {
    const dir = path.join(root, "clients", CLIENT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "_practice_log.jsonl"),
      `{ this is not json\n${JSON.stringify(ex())}\n`,
      "utf8",
    );
    const a = await loadExerciseAdherence(CLIENT);
    expect(a.sessions).toHaveLength(1);
  });

  it("never returns a progression verdict", async () => {
    writeLog([ex({ date: today(0) }), ex({ date: today(1) }), ex({ date: today(2) })]);
    const a = await loadExerciseAdherence(CLIENT);
    // Three clean sessions is exactly the shape someone would be tempted to
    // turn into "ready to advance". The threshold has to come from real logs.
    expect(a.headline).not.toMatch(/advance|progress|ready|level/i);
  });
});

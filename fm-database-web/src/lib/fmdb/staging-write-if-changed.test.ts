/** The staging projections must not rewrite files that have not changed.
 *
 * WHY THIS SUITE EXISTS. `coach-staging-action.py` and `app-staging-action.py`
 * stamp every file they write with a fresh `staged_at`. Writing that stamp
 * unconditionally marked all ~40 projection/marker files as modified on the
 * Mac every few minutes, because Mutagen detects changes by CONTENT hash.
 * In steady state that is only wasteful. When the sync loses its ancestor
 * state — which a Fly deploy does, since it replaces the machine — it turns
 * into one conflict per file on files that are identical apart from a
 * timestamp. On 2026-08-09 that produced a 23-file conflict pile and blocked
 * real client data from reaching Fly for three hours.
 *
 * So: a run that changes nothing must write nothing. These tests drive the
 * REAL Python helper rather than a copy, so a refactor that reinstates the
 * unconditional write fails here.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import { spawnSync } from "node:child_process";

const SCRIPT = path.resolve(
  __dirname,
  "../../../scripts/coach-staging-action.py",
);

/** Call `_write_if_changed` in the real script and return bytes written. */
function writeIfChanged(file: string, body: string, ignoreKey = ""): number {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cs", ${JSON.stringify(SCRIPT)})
cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)
from pathlib import Path
n = cs._write_if_changed(Path(${JSON.stringify(file)}), sys.stdin.read(), ${JSON.stringify(ignoreKey)})
print(n)
`;
  const r = spawnSync(TEST_PYTHON, ["-c", py], {
    input: body,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || "python failed");
  return Number(r.stdout.trim());
}

const card = (name: string, stamp: string) =>
  JSON.stringify({ id: "cl-1", glance: { name }, staged_at: stamp }, null, 1);

describe("coach-staging _write_if_changed", () => {
  it(
    "writes first time, then skips a stamp-only change",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "staging-"));
      const f = path.join(dir, "cl-1.json");

      expect(writeIfChanged(f, card("A", "10:00"), "staged_at")).toBeGreaterThan(0);

      // Same person, new stamp — the exact case that caused the churn.
      expect(writeIfChanged(f, card("A", "10:05"), "staged_at")).toBe(0);
      // and the file on disk is genuinely untouched
      expect(JSON.parse(readFileSync(f, "utf8")).staged_at).toBe("10:00");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "still writes when something real changes",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "staging-"));
      const f = path.join(dir, "cl-1.json");
      writeIfChanged(f, card("A", "10:00"), "staged_at");

      expect(writeIfChanged(f, card("B", "10:10"), "staged_at")).toBeGreaterThan(0);
      const on = JSON.parse(readFileSync(f, "utf8"));
      expect(on.glance.name).toBe("B");
      expect(on.staged_at).toBe("10:10");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "compares whole content when no key is ignored (index.json)",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "staging-"));
      const f = path.join(dir, "index.json");
      expect(writeIfChanged(f, '[{"a":1}]')).toBeGreaterThan(0);
      expect(writeIfChanged(f, '[{"a":1}]')).toBe(0);
      expect(writeIfChanged(f, '[{"a":2}]')).toBeGreaterThan(0);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "rewrites rather than throwing when the file on disk is corrupt",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "staging-"));
      const f = path.join(dir, "cl-1.json");
      writeFileSync(f, "{ not json");
      expect(writeIfChanged(f, card("A", "10:00"), "staged_at")).toBeGreaterThan(0);
      expect(JSON.parse(readFileSync(f, "utf8")).glance.name).toBe("A");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

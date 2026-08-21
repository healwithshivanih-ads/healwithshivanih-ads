/**
 * Tests for runShim's failure reporting.
 *
 * WHY: a shim killed at its timeout writes nothing to stdout OR stderr, and the
 * old message for that case was "produced no output.\nstderr: " with an empty
 * stderr — indistinguishable from a script that ran fine and printed nothing.
 * The fm-coach log carried that line every few minutes for weeks while
 * app-staging-action.py was healthy and merely slower than its 90s ceiling
 * (2026-08-21). A timeout must say it timed out.
 *
 * These drive the real spawn path with tiny stdlib-only python programs,
 * because the thing under test IS the child-process wiring. shim.ts resolves
 * both the interpreter and the scripts dir at IMPORT time, so each test sets
 * the environment first and then imports a fresh copy of the module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let dir: string;
let prevCwd: string;
let prevPython: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  prevCwd = process.cwd();
  prevPython = process.env.FMDB_PYTHON;
  // Stdlib-only scripts, so any python3 on PATH is a valid interpreter here.
  process.env.FMDB_PYTHON = "python3";
  process.chdir(dir);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevPython === undefined) delete process.env.FMDB_PYTHON;
  else process.env.FMDB_PYTHON = prevPython;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a script into the temp cwd's scripts/ dir, then load shim.ts fresh
 *  so its import-time cwd/interpreter resolution picks this dir up. */
async function withScript(name: string, body: string) {
  fs.writeFileSync(path.join(dir, "scripts", name), body);
  return (await import("./shim")).runShim;
}

describe("runShim failure reporting", () => {
  it("says the script TIMED OUT when it is killed at the ceiling", async () => {
    const runShim = await withScript("slow.py", "import time\ntime.sleep(30)\n");
    await expect(runShim("slow.py", {}, 700)).rejects.toThrow(
      /exceeded its timeout|killed by SIG/,
    );
  });

  it("reports the exit code when a script exits silently without output", async () => {
    const runShim = await withScript("silent.py", "import sys\nsys.exit(3)\n");
    await expect(runShim("silent.py", {})).rejects.toThrow(/exited with code 3/);
  });

  it("still surfaces stderr when the script fails loudly", async () => {
    const runShim = await withScript(
      "boom.py",
      "import sys\nsys.stderr.write('kaboom\\n')\nsys.exit(1)\n",
    );
    await expect(runShim("boom.py", {})).rejects.toThrow(/kaboom/);
  });

  it("returns parsed JSON on the happy path", async () => {
    const runShim = await withScript(
      "ok.py",
      "import json,sys\njson.dump({'ok': True, 'n': 7}, sys.stdout)\n",
    );
    await expect(runShim("ok.py", {})).resolves.toEqual({ ok: true, n: 7 });
  });

  it("passes the payload through on stdin", async () => {
    const runShim = await withScript(
      "echo.py",
      "import json,sys\njson.dump({'got': json.load(sys.stdin)}, sys.stdout)\n",
    );
    await expect(runShim("echo.py", { action: "refresh" })).resolves.toEqual({
      got: { action: "refresh" },
    });
  });
});

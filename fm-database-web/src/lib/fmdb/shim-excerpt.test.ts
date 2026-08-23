import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { excerpt } from "./shim";

/**
 * `excerpt` exists so a shim's error message keeps the END of stderr. A Python
 * traceback puts the exception on its LAST line; the head-only slice it replaced
 * showed subprocess.py frames and dropped the `FileNotFoundError` that named the
 * missing interpreter (ingest-action.py from a worktree, 2026-08-22).
 */
describe("excerpt", () => {
  it("returns short text untouched", () => {
    expect(excerpt("all fine", 100)).toBe("all fine");
    expect(excerpt("", 100)).toBe("");
  });

  it("keeps the last line of a long traceback, not just the first frames", () => {
    const frames = Array.from(
      { length: 12 },
      (_, i) => `  File "/lib/python3.9/subprocess.py", line ${1000 + i}, in _execute_child\n    raise child_exception_type(errno_num, err_msg, err_filename)`
    ).join("\n");
    const last = "FileNotFoundError: [Errno 2] No such file or directory: '/wt/fm-database/.venv/bin/python'";
    const traceback = `Traceback (most recent call last):\n${frames}\n${last}`;
    expect(traceback.length).toBeGreaterThan(1200);

    const out = excerpt(traceback, 1200);
    expect(out).toContain("Traceback (most recent call last):");
    expect(out.endsWith(last)).toBe(true);
    expect(out).toMatch(/… \[\d+ chars elided\] …/);
    // Bounded: head + tail + one elision marker.
    expect(out.length).toBeLessThan(1200 + 60);
  });

  it("never elides when the text is exactly at the cap", () => {
    const text = "x".repeat(1200);
    expect(excerpt(text, 1200)).toBe(text);
  });
});

/**
 * The head slice is one copy-paste away from coming back: every private
 * `runShim` in this repo was written by copying the previous one, which is how
 * the same `stderr.slice(0, N)` reached 13 files. Unit-testing `excerpt` proves
 * the helper works; only a scan proves it is the one actually used.
 *
 * stdout is deliberately NOT covered — a JSON parse failure is diagnosed from
 * the START of the document, so a head slice is the right clip there.
 */
describe("no shim error path head-slices stderr", () => {
  const SRC = path.resolve(__dirname, "..", "..");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("uses excerpt(stderr, …) everywhere instead of stderr.slice(0, …)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, "utf-8");
      text.split("\n").forEach((line, i) => {
        if (/\bstderr\w*\.slice\(\s*0\s*,/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Clip stderr with excerpt() from @/lib/fmdb/shim — a head slice drops the ` +
        `last line of a Python traceback, which is the exception itself:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

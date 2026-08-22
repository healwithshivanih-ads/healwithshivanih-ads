import { describe, expect, it } from "vitest";
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

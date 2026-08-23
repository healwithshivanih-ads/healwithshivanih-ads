/**
 * shim.ts owns the interpreter. Nothing else may resolve its own.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION: the hard-coded venv path was swept
 * out of 20 files across three batches (2026-08-22), and while the last batch
 * was in flight a fourth site grew back independently — c35a5187 added
 *
 *     const PYTHON =
 *       process.env.FMDB_PYTHON?.trim() || path.join(FMDB_REPO, ".venv/bin/python");
 *
 * to server-actions/intake.ts, two minutes after the batch that removed the last
 * twelve.
 *
 * Read that as carelessness and you will draw the wrong conclusion, so here is
 * what actually happened — it is the part that makes a guard necessary rather
 * than optional. c35a5187 does NOT descend from the sweep; it forked at
 * fe95cb63, before any batch landed. In that tree intake.ts still carried the
 * OLD `const PYTHON = path.join(FMDB_REPO, ".venv/bin/python")`, so that author
 * did not re-add a bad pattern: they hit a real bug (intake actions failing from
 * a worktree), improved the line in front of them, and improved it into exactly
 * what shim.ts had exported since b979ae1c — their own comment cites shim.ts by
 * name. Knowing about the shim was never the missing piece — editing a file
 * whose local const was still there was enough, and that is the normal state of
 * every branch in flight during a multi-hour sweep. Which is why "we finished
 * it" cannot hold on its own. This one was caught purely because the conflict
 * landed on those exact lines; the same edit in a file the sweep had not touched
 * would have merged clean and silently. The failure it
 * reintroduces is quiet — a missing venv surfaces as ENOENT, and several callers
 * catch and return an empty result, so a guardrail chip just hides and a count
 * reads 0.
 *
 * Two shapes are refused, matching how it actually recurs:
 *   1. reading process.env.FMDB_PYTHON — the override belongs to shim.ts alone
 *   2. building a path with path.join/resolve at a `.venv`
 *
 * Both are precise enough to need no allowlist. The remaining legitimate
 * mentions of `.venv/bin/python` in src/ are a doc comment, JSX display text,
 * and one relative command string emailed to the coach to copy-paste — none of
 * them reads the env var or joins a path, so none trips this.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "..");

/** shim.ts defines the interpreter; test-python.ts is its test-side sibling and
 *  deliberately has its own resolution (including a python3-on-PATH fallback
 *  that CI depends on). Test files may reference either freely. */
const OWNERS = new Set(["shim.ts", "test-python.ts"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !OWNERS.has(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function offenders(predicate: (line: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    fs.readFileSync(file, "utf-8")
      .split("\n")
      .forEach((line, i) => {
        if (predicate(line)) found.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim()}`);
      });
  }
  return found;
}

describe("shim.ts is the single source of the Python interpreter", () => {
  it("no other module reads process.env.FMDB_PYTHON", () => {
    const bad = offenders((l) => l.includes("process.env.FMDB_PYTHON"));
    expect(
      bad,
      "Import { PYTHON } from @/lib/fmdb/shim instead — it already honours " +
        `FMDB_PYTHON, and a second copy drifts from it:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("no other module builds an interpreter path at a .venv", () => {
    const bad = offenders(
      (l) => l.includes(".venv") && (l.includes("path.join(") || l.includes("path.resolve(")),
    );
    expect(
      bad,
      "Import { PYTHON } from @/lib/fmdb/shim instead of resolving the venv " +
        `here — the venv is untracked, so this dies as ENOENT in a worktree:\n${bad.join("\n")}`,
    ).toEqual([]);
  });
});

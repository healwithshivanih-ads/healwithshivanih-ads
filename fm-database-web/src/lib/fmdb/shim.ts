import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";

/**
 * The interpreter every shim is spawned with: the repo venv, which is where
 * pyyaml / pydantic / the anthropic SDK actually live.
 *
 * That venv is untracked, so it does not exist in a git worktree or in CI, and
 * this path was hard-coded with no way to point it elsewhere — its test
 * sibling, test-python.ts, has honoured FMDB_PYTHON for exactly that reason.
 * Same override here, so one env var covers both.
 *
 * Deliberately NO python3-on-PATH fallback, unlike test-python.ts (whose
 * fallback CI depends on — see the pip install step in ci.yml). Falling through
 * to a dependency-less interpreter in production would surface as an
 * ImportError from inside a shim, or worse: a shim that catches its own import
 * failure and returns an EMPTY result, which is how the same fallback makes
 * recipe-generation-skip fail as a wrong-answer AssertionError rather than an
 * error. A missing venv should fail as a plain ENOENT naming the absent path.
 */
export const PYTHON =
  process.env.FMDB_PYTHON?.trim() ||
  path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
export const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

/**
 * Clip a captured stream for an error message WITHOUT losing its end. A Python
 * traceback puts the one line that matters — the exception itself — LAST, so a
 * plain head slice of a long traceback showed eight frames of subprocess.py and
 * cut off the `FileNotFoundError: … .venv/bin/python` that named the actual
 * problem (ingest-action.py from a worktree, 2026-08-22). Keeps roughly a third
 * from the head (the "Traceback" header and the first frames, which say which
 * script) and the rest from the tail.
 */
export function excerpt(text: string, max = 1200): string {
  if (text.length <= max) return text;
  const head = Math.floor(max / 3);
  const tail = max - head;
  return `${text.slice(0, head)}\n… [${text.length - max} chars elided] …\n${text.slice(-tail)}`;
}

export async function runShim(
  scriptName: string,
  payload: unknown,
  timeoutMs = 90_000
): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const child = execFile(PYTHON, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  // Capture how the process ENDED, not just what it said. execFile's `timeout`
  // kills the child with a signal, and a killed child writes nothing to either
  // stream — so without this the failure read as the bare, actively misleading
  // "produced no output. stderr:" with an empty stderr, which looks like a
  // broken script rather than a job that ran out of time. That exact message
  // filled the fm-coach log for weeks (app-staging-action.py, 2026-08-21) while
  // the script itself was healthy and merely slow.
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c, s) => resolve({ code: c, signal: s }));
  });

  if (!stdout.trim()) {
    const how = signal
      ? `killed by ${signal} after ${timeoutMs}ms — the script exceeded its timeout`
      : `exited with code ${code}`;
    throw new Error(
      `${scriptName} produced no output (${how}).\nstderr: ${excerpt(stderr, 1200)}`
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `${scriptName} produced invalid JSON: ${(err as Error).message}\n` +
        `stdout: ${excerpt(stdout, 800)}\nstderr: ${excerpt(stderr, 800)}`
    );
  }
}

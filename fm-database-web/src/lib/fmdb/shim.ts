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

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    throw new Error(
      `${scriptName} produced no output.\nstderr: ${stderr.slice(0, 1200)}`
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `${scriptName} produced invalid JSON: ${(err as Error).message}\n` +
        `stdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 800)}`
    );
  }
}

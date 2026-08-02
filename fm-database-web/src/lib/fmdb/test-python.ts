/**
 * Interpreter used by the tests that drive the real Python modules
 * (menu_hygiene, generate-week-recipes).
 *
 * At runtime the app shells out to the repo venv (see `PYTHON` in shim.ts).
 * That venv is untracked, so it does not exist in CI or in a git worktree —
 * hard-coding it made those tests die with spawnSync ENOENT instead of
 * running. Resolve it, and fall back to python3 on PATH.
 *
 * Override with FMDB_PYTHON when neither location is right. shim.ts honours the
 * same variable, so one setting covers both the tests and the app's own shims.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Every suite that imports this drives real fmdb code, so the interpreter needs
 * pyyaml (recipe + remedy catalogue) and pydantic (fmdb.plan.models). CI
 * installs both onto PATH deliberately — see the pip step in ci.yml.
 *
 * The python3 fallback is the ONLY branch worth probing, and it earns the cost:
 * without it, a machine whose system python3 lacks those deps does not fail
 * with an ImportError. The shims catch their own catalogue-read failure and
 * return an EMPTY result, so the suite fails as `expected [] to deeply equal
 * [...]` — a wrong answer that reads like a code regression and sends you
 * debugging the wrong thing. That is exactly what a fresh git worktree looks
 * like, since the venv is untracked and therefore absent there.
 */
function assertUsable(python: string): string {
  const probe = spawnSync(python, ["-c", "import yaml, pydantic"], { encoding: "utf-8" });
  if (probe.status !== 0) {
    throw new Error(
      `Python-backed tests need an interpreter with pyyaml + pydantic, and ` +
        `\`${python}\` has neither or only one of them.\n` +
        `  ${(probe.stderr || probe.error?.message || "").trim().split("\n").pop()}\n` +
        `Point them at the repo venv instead:\n` +
        `  FMDB_PYTHON=<repo>/fm-database/.venv/bin/python npm test\n` +
        `(Failing here on purpose: without deps these suites do not error, they ` +
        `return empty results and fail as wrong answers.)`,
    );
  }
  return python;
}

function resolvePython(): string {
  const explicit = process.env.FMDB_PYTHON?.trim();
  if (explicit) return explicit;
  const venv = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python3");
  if (existsSync(venv)) return venv;
  return assertUsable("python3");
}

export const TEST_PYTHON = resolvePython();

/**
 * Timeout for a test that shells out to Python. Every call is a cold
 * interpreter that then reads the whole catalogue off disk (1,100+ recipe and
 * remedy YAMLs) — ~1.5s on a dev Mac but 4-5s on a CI runner, which blew
 * vitest's 5s default. Generous on purpose: this budget is for slow I/O, not
 * for a hang.
 */
export const PY_TEST_TIMEOUT_MS = 30_000;

/**
 * Interpreter used by the tests that drive the real Python modules
 * (menu_hygiene, generate-week-recipes).
 *
 * At runtime the app shells out to the repo venv (see `PYTHON` in shim.ts).
 * That venv is untracked, so it does not exist in CI or in a git worktree —
 * hard-coding it made those tests die with spawnSync ENOENT instead of
 * running. Resolve it, and fall back to python3 on PATH.
 *
 * Override with FMDB_PYTHON when neither location is right.
 */
import { existsSync } from "node:fs";
import path from "node:path";

function resolvePython(): string {
  const explicit = process.env.FMDB_PYTHON?.trim();
  if (explicit) return explicit;
  const venv = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python3");
  return existsSync(venv) ? venv : "python3";
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

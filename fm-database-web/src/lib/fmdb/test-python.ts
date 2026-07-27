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

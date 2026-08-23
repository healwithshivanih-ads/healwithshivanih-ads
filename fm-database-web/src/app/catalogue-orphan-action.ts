"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { PYTHON } from "@/lib/fmdb/shim";

const exec = promisify(execFile);

// PYTHON is shared with shim.ts (honours FMDB_PYTHON — the venv is untracked, so it
// is absent in a git worktree). FMDB_DIR is the fm-database package dir, resolved
// relative to the Next server cwd (fm-database-web).
const FMDB_DIR = path.resolve(process.cwd(), "..", "fm-database");

/** One unreachable entity, as emitted by `fmdb orphans --json`. */
export interface OrphanItem {
  kind: string;          // "mechanism" | "supplement" | "claim" | ...
  slug: string;
  display_name: string;
  reason: string;
  blocking: boolean;     // true = assessment-blocking (mechanism / supplement)
}

export interface OrphanCounts {
  total: number;                       // all orphans
  blocking: number;                    // assessment-blocking orphans (mechanisms + supplements)
  byKind: { kind: string; n: number; blocking: boolean }[];
  blockingItems: OrphanItem[];         // the actionable list, capped
}

/**
 * Deliberately a discriminated union, not `OrphanCounts` with zeroes.
 *
 * The whole point of this chip is that zero blocking orphans means "the
 * catalogue is wired correctly". If a spawn failure also produced zero, the
 * chip would hide — and a hidden chip is indistinguishable from a clean
 * catalogue. That is exactly what happened: run from a git worktree, the
 * untracked venv is absent, the spawn ENOENTs in ~2ms, and the guardrail
 * silently reported all-clear for as long as nobody noticed. A guardrail that
 * cannot report its own breakage is worse than no guardrail, because it is
 * trusted.
 *
 * So: "unavailable" is a THIRD state the UI must render as "couldn't check".
 * It must not throw — an unhandled error in a dashboard chip takes the
 * dashboard down with it, which is the failure this catch was right to avoid.
 */
export type OrphanStatus =
  | ({ status: "ok" } & OrphanCounts)
  | { status: "unavailable"; error: string };

/** Why the detector could not run, phrased for the coach, not for a stack trace. */
function unavailable(e: unknown): OrphanStatus {
  const err = e as { code?: string; killed?: boolean; message?: string };
  const reason =
    err?.code === "ENOENT"
      ? `Python not found at ${PYTHON} — set FMDB_PYTHON to the repo venv.`
      : err?.killed
        ? "the scan timed out (30s)"
        : (err?.message ?? String(e)).split("\n")[0];
  // Log with the interpreter path: this class of failure says nothing in the
  // UI, and the only other signal is the dev server's `ƒ action() in 2ms`
  // timing line (a real scan is ~14s). Give the log the actionable half.
  console.error(`[catalogue-orphans] scan unavailable (python=${PYTHON}):`, e);
  return { status: "unavailable", error: reason };
}

/**
 * Run the catalogue orphan detector (`fmdb orphans --json`) and summarise it
 * for the dashboard chip. Orphans are entities that EXIST and validate but the
 * assessment subgraph can never reach — so the AI can never surface them. The
 * exact failure that hid beta-glucuronidase. See fmdb/validator.py::find_orphans.
 */
export async function getCatalogueOrphanStatus(): Promise<OrphanStatus> {
  let stdout: string;
  try {
    ({ stdout } = await exec(
      PYTHON,
      ["-m", "fmdb.cli", "orphans", "--json"],
      { cwd: FMDB_DIR, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (e) {
    return unavailable(e);
  }

  try {
    const items = JSON.parse(stdout) as OrphanItem[];
    // A non-array payload means the CLI's JSON contract moved under us. That is
    // a broken detector, not an empty one — see catalogue-detector-contract.test.ts,
    // which pins the shape so this branch stays theoretical.
    if (!Array.isArray(items)) {
      return { status: "unavailable", error: "`fmdb orphans --json` did not return a list" };
    }

    const counts = new Map<string, { n: number; blocking: boolean }>();
    for (const o of items) {
      const cur = counts.get(o.kind) ?? { n: 0, blocking: o.blocking };
      cur.n += 1;
      counts.set(o.kind, cur);
    }
    const byKind = [...counts.entries()]
      .map(([kind, v]) => ({ kind, n: v.n, blocking: v.blocking }))
      .sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.n - a.n);

    const allBlocking = items.filter((o) => o.blocking);

    return {
      status: "ok",
      total: items.length,
      blocking: allBlocking.length,
      byKind,
      blockingItems: allBlocking.slice(0, 200), // cap the rendered list
    };
  } catch (e) {
    return unavailable(e);
  }
}

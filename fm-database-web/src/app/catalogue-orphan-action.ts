"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);

// Mirror shim.ts: the venv python + the fm-database package dir, resolved
// relative to the Next server cwd (fm-database-web).
const PYTHON = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
const FMDB_DIR = path.resolve(process.cwd(), "..", "fm-database");

/** One unreachable entity, as emitted by `fmdb orphans --json`. */
export interface OrphanItem {
  kind: string;          // "mechanism" | "supplement" | "claim" | ...
  slug: string;
  display_name: string;
  reason: string;
  blocking: boolean;     // true = assessment-blocking (mechanism / supplement)
}

export interface OrphanStatus {
  total: number;                       // all orphans
  blocking: number;                    // assessment-blocking orphans (mechanisms + supplements)
  byKind: { kind: string; n: number; blocking: boolean }[];
  blockingItems: OrphanItem[];         // the actionable list, capped
}

const EMPTY: OrphanStatus = { total: 0, blocking: 0, byKind: [], blockingItems: [] };

/**
 * Run the catalogue orphan detector (`fmdb orphans --json`) and summarise it
 * for the dashboard chip. Orphans are entities that EXIST and validate but the
 * assessment subgraph can never reach — so the AI can never surface them. The
 * exact failure that hid beta-glucuronidase. See fmdb/validator.py::find_orphans.
 *
 * Defensive by design: any failure (no venv, parse error, timeout) returns the
 * empty status so the chip simply hides rather than breaking the dashboard.
 */
export async function getCatalogueOrphanStatus(): Promise<OrphanStatus> {
  try {
    const { stdout } = await exec(
      PYTHON,
      ["-m", "fmdb.cli", "orphans", "--json"],
      { cwd: FMDB_DIR, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const items = JSON.parse(stdout) as OrphanItem[];
    if (!Array.isArray(items)) return EMPTY;

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
      total: items.length,
      blocking: allBlocking.length,
      byKind,
      blockingItems: allBlocking.slice(0, 200), // cap the rendered list
    };
  } catch {
    return EMPTY;
  }
}

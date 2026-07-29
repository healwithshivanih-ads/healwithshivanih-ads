"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);

// Mirror shim.ts / catalogue-orphan-action.ts: the venv python + the fm-database
// package dir, resolved relative to the Next server cwd (fm-database-web).
const PYTHON = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
const FMDB_DIR = path.resolve(process.cwd(), "..", "fm-database");

/** One duplicate candidate, as emitted by `fmdb duplicates --json`. */
export interface DuplicateItem {
  check: "SHARED_ALIAS" | "ALIAS_IS_SLUG" | "SAME_DISPLAY" | "NEAR_SLUG";
  entity_kind: string; // topics / mechanisms / supplements / ...
  slugs: string[];
  severity: "CRITICAL" | "WARNING";
  detail: string;
  evidence: string[]; // the shared aliases, or the overlap score
}

export interface DuplicateStatus {
  total: number;
  critical: number;
  byCheck: { check: string; n: number }[];
  criticalItems: DuplicateItem[];
}

const EMPTY: DuplicateStatus = { total: 0, critical: 0, byCheck: [], criticalItems: [] };

/**
 * Run the catalogue duplicate detector (`fmdb duplicates --json`) and summarise
 * it for a dashboard chip.
 *
 * Why this exists: a single cleanup session found FIVE duplicate pairs sitting
 * unnoticed (CoQ10 x3, mitochondrial-health x2, type-2-diabetes x2). Each had
 * overlapping aliases, so `_resolve_index` — which is last-wins by load order —
 * silently picked a winner nobody chose. The ingest pipeline creates
 * near-duplicates faster than anyone reads the catalogue, so the durable fix is
 * making them visible rather than cleaning up after them.
 *
 * CRITICAL means one of two things, and the `detail` string says which:
 *   - the entities look alike -> one concept split in two, merge them
 *   - they do not -> an alias is on the wrong entity and WILL mis-resolve
 *     (`tg-antibodies` and `triglycerides` both claiming "tg" is the live case)
 *
 * Defensive by design: any failure (no venv, parse error, timeout) returns the
 * empty status so the chip hides rather than breaking the dashboard. Note the
 * CLI exits 1 when criticals exist, which makes execFile reject — so the JSON
 * is recovered from the error's stdout before giving up.
 */
export async function getCatalogueDuplicateStatus(): Promise<DuplicateStatus> {
  let stdout: string;
  try {
    ({ stdout } = await exec(PYTHON, ["-m", "fmdb.cli", "duplicates", "--json"], {
      cwd: FMDB_DIR,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (err) {
    // `fmdb duplicates` exits 1 when there ARE criticals — the normal case, not
    // a failure. The payload is still on stdout.
    const out = (err as { stdout?: string })?.stdout;
    if (!out) return EMPTY;
    stdout = out;
  }

  try {
    const items = JSON.parse(stdout) as DuplicateItem[];
    if (!Array.isArray(items)) return EMPTY;

    const counts = new Map<string, number>();
    for (const d of items) counts.set(d.check, (counts.get(d.check) ?? 0) + 1);

    const critical = items.filter((d) => d.severity === "CRITICAL");
    return {
      total: items.length,
      critical: critical.length,
      byCheck: [...counts.entries()]
        .map(([check, n]) => ({ check, n }))
        .sort((a, b) => b.n - a.n),
      criticalItems: critical.slice(0, 200), // cap the rendered list
    };
  } catch {
    return EMPTY;
  }
}

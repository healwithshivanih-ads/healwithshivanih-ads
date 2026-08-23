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

/** One duplicate candidate, as emitted by `fmdb duplicates --json`. */
export interface DuplicateItem {
  check: "SHARED_ALIAS" | "ALIAS_IS_SLUG" | "SAME_DISPLAY" | "NEAR_SLUG";
  entity_kind: string; // topics / mechanisms / supplements / ...
  slugs: string[];
  severity: "CRITICAL" | "WARNING";
  detail: string;
  evidence: string[]; // the shared aliases, or the overlap score
}

export interface DuplicateCounts {
  /** Findings NOT in the accepted baseline — the actionable set. */
  newCount: number;
  /** How many of those need a merge or a wrong-alias removal. */
  newCritical: number;
  /** Total findings the scan produced, baseline included. Context only. */
  known: number;
  byCheck: { check: string; n: number }[];
  /** The new findings, capped for rendering. */
  newItems: DuplicateItem[];
}

/**
 * Discriminated, so a scan that could not RUN can never be mistaken for a scan
 * that found nothing new. `newCount === 0` is the normal, reassuring state this
 * chip stays silent for — which is exactly why a failure must not be able to
 * produce it. Run from a git worktree the untracked venv is absent, the spawn
 * ENOENTs in ~2ms, and the old `return EMPTY` reported a clean ratchet.
 *
 * The chip must branch through `chipView()` in lib/fmdb/guardrail-chip-view.ts
 * rather than narrowing with `status.status !== "ok" || status.newCount === 0`.
 * That narrowing type-checks, keeps the ratchet intact, and quietly restores
 * the fail-closed hide — see guardrail-chip-view.test.ts.
 *
 * FmCatalogueDuplicateChip's `if (!status || status.newCount === 0) return null`
 * becomes a four-way switch. ChipStatus is deliberately generic (`actionable`),
 * which is what lets this chip's `newCount` and the orphan chip's `blocking`
 * share one asserted function — so map it with a ternary that BUILDS the union
 * member, not by spreading `actionable: status.newCount` across both variants
 * (on the unavailable variant that field is `undefined`, and the union has no
 * such member):
 *
 *     const view = chipView(
 *       status === null
 *         ? null
 *         : status.status === "ok"
 *           ? { status: "ok", actionable: status.newCount }
 *           : { status: "unavailable" },
 *     );
 *     if (view === "loading" || view === "hide") return null;   // ONLY these two
 *     if (status === null) return null;                          // narrows the type
 *     if (status.status === "unavailable") return <CouldntCheck … />;
 *     // everything below is the alarm
 *
 * `unavailable` must not appear in that early-return list. FmCatalogueOrphanChip
 * is the worked example.
 */
export type DuplicateStatus =
  | ({ status: "ok" } & DuplicateCounts)
  | { status: "unavailable"; error: string };

function unavailable(e: unknown): DuplicateStatus {
  const err = e as { code?: string; killed?: boolean; message?: string };
  const reason =
    err?.code === "ENOENT"
      ? `Python not found at ${PYTHON} — set FMDB_PYTHON to the repo venv.`
      : err?.killed
        ? "the scan timed out (60s)"
        : (err?.message ?? String(e)).split("\n")[0];
  console.error(`[catalogue-duplicates] scan unavailable (python=${PYTHON}):`, e);
  return { status: "unavailable", error: reason };
}

/**
 * Run the catalogue duplicate detector as a RATCHET and summarise the result
 * for a dashboard chip.
 *
 * Why this exists: a single cleanup session found FIVE duplicate pairs sitting
 * unnoticed (CoQ10 x3, mitochondrial-health x2, type-2-diabetes x2). Each had
 * overlapping aliases, so `_resolve_index` — which is last-wins by load order —
 * silently picked a winner nobody chose. The ingest pipeline creates
 * near-duplicates faster than anyone reads the catalogue, so the durable fix is
 * making them visible rather than cleaning up after them.
 *
 * ⚠ THIS READS `--check-new`, NOT THE FULL SCAN, AND THAT IS THE WHOLE POINT.
 * Every one of the ~349 findings on disk today is already recorded in
 * `_duplicates_baseline.yaml`. A chip driven by the full scan would report 47
 * criticals on every single dashboard load, forever, about debt that has been
 * explicitly accepted — which is precisely the "after 3-4 they become
 * wallpaper" failure FmAlertGroup exists to fix. Adoption started at 111
 * criticals; gating on the total just teaches everyone to pass --no-verify.
 * So the chip fires only on what is NEW, matching the pre-push hook and
 * catalogue-ci. `known` is carried purely as context inside the disclosure.
 *
 * The coach-facing half of that ratchet: batches are approved through /ingest
 * in this UI, and the coach never sees the pre-push hook (pushes are
 * assistant-owned). Without this chip a duplicate created by an approve is
 * invisible until someone next pushes catalogue changes.
 *
 * CRITICAL means one of two things, and the `detail` string says which:
 *   - the entities look alike -> one concept split in two, merge them
 *   - they do not -> an alias is on the wrong entity and WILL mis-resolve
 *     (`tg-antibodies` and `triglycerides` both claiming "tg" is the live case)
 *
 * A broken payload shows no symptom of its own — which is why
 * tests/test_duplicates_ratchet.py pins the JSON shape rather than trusting
 * review, and why an unrunnable scan now reports `unavailable` instead of an
 * empty result. Note the CLI exits 1 when anything is new, which makes execFile
 * reject, so the JSON is recovered from the error's stdout before giving up —
 * that path is load-bearing and stays. A rejection with NO stdout is the
 * different animal: the run itself failed.
 */
export async function getCatalogueDuplicateStatus(): Promise<DuplicateStatus> {
  let stdout: string;
  try {
    ({ stdout } = await exec(
      PYTHON,
      ["-m", "fmdb.cli", "duplicates", "--check-new", "--json"],
      {
        cwd: FMDB_DIR,
        // A full catalogue load is ~15s. 60s leaves headroom as it grows.
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    ));
  } catch (err) {
    // `duplicates --check-new` exits 1 when there ARE new findings — the case
    // the chip exists for, not a failure. The payload is still on stdout.
    const out = (err as { stdout?: string })?.stdout;
    if (!out?.trim()) return unavailable(err);
    stdout = out;
  }

  try {
    const payload = JSON.parse(stdout) as { new?: DuplicateItem[]; known?: number };
    // Guard the shape explicitly: the full-scan mode of the same command emits
    // a bare ARRAY, and silently treating that as a ratchet result would
    // surface the entire accepted baseline as if it were new.
    if (!payload || Array.isArray(payload) || !Array.isArray(payload.new)) {
      return {
        status: "unavailable",
        error: "`fmdb duplicates --check-new --json` did not return a {new, known} object",
      };
    }

    const items = payload.new;
    const counts = new Map<string, number>();
    for (const d of items) counts.set(d.check, (counts.get(d.check) ?? 0) + 1);

    return {
      status: "ok",
      newCount: items.length,
      newCritical: items.filter((d) => d.severity === "CRITICAL").length,
      known: typeof payload.known === "number" ? payload.known : 0,
      byCheck: [...counts.entries()]
        .map(([check, n]) => ({ check, n }))
        .sort((a, b) => b.n - a.n),
      newItems: items.slice(0, 200), // cap the rendered list
    };
  } catch (e) {
    return unavailable(e);
  }
}

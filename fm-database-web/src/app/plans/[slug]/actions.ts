"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import type { Plan } from "@/lib/fmdb/types";

export interface PlanCheckFinding {
  severity: "CRITICAL" | "WARNING" | "INFO";
  section: string;
  field: string;
  detail: string;
  target: string;
  ack_id: string;
}

export interface PlanCheckResult {
  ok: boolean;
  slug?: string;
  findings?: PlanCheckFinding[];
  counts?: { CRITICAL: number; WARNING: number; INFO: number };
  error?: string | null;
}

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";
const WEB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database-web";

/**
 * Shell out to `scripts/plan-check.py` (which imports fmdb.plan.checker
 * directly) and parse its JSON output. Same shim pattern Agent B used for
 * scripts/assess.py last turn — keeps fm-database/ Python untouched.
 */
export async function runPlanCheck(slug: string): Promise<PlanCheckResult> {
  return new Promise((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts/plan-check.py");
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => resolve({ ok: false, error: String(err) }));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        resolve({
          ok: false,
          error: `plan-check.py exited ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PlanCheckResult;
        resolve(parsed);
      } catch (e) {
        resolve({
          ok: false,
          error: `failed to parse plan-check.py output: ${e}\nstdout: ${stdout.slice(0, 500)}`,
        });
      }
    });

    child.stdin.write(JSON.stringify({ slug }));
    child.stdin.end();
  });
}

/**
 * Apply a partial patch to a plan and persist. Always loads the current
 * canonical plan first so concurrent edits to other fields don't get
 * clobbered by a stale client snapshot.
 *
 * Lock: refuses to write if the plan's current on-disk status is anything
 * other than "draft". Lifecycle transitions (submit/publish/revoke) are
 * intentionally only available via the Python CLI for now.
 */
export async function updatePlan(
  slug: string,
  patch: Partial<Plan>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await loadPlanBySlug(slug);
  if (!current) return { ok: false, error: `Plan ${slug} not found` };

  const status = current.status ?? current._bucket;
  if (status !== "draft") {
    return {
      ok: false,
      error: `Plan is ${status} — only drafts are editable from the web UI. Use the Python CLI for lifecycle transitions.`,
    };
  }

  // Drop the loader-only fields before writing
  const { _bucket, _file, ...rest } = current;
  void _bucket;
  void _file;

  const next: Plan = { ...rest, ...patch, slug } as Plan;
  await writePlan(next);

  revalidatePath(`/plans/${slug}`);
  revalidatePath("/plans");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type { Plan, PlanPatch } from "@/lib/fmdb/types";

// ─── Supplement sources ────────────────────────────────────────────────────────

export interface SupplementSource {
  brand?: string;
  url?: string;
  code?: string;
  vitaone_ref?: string;
}

export type SupplementSourcesMap = Record<string, SupplementSource>;

function supplementSourcesPath(): string {
  return path.join(getPlansRoot(), "supplement-sources.yaml");
}

export async function loadSupplementSources(): Promise<SupplementSourcesMap> {
  try {
    const raw = await fs.readFile(supplementSourcesPath(), "utf-8");
    return (yaml.load(raw) as SupplementSourcesMap) ?? {};
  } catch {
    return {};
  }
}

/**
 * Merge updates into the shared supplement-sources.yaml.
 * Only the keys present in `updates` are touched; others are preserved.
 */
export async function saveSupplementSources(
  updates: SupplementSourcesMap
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const current = await loadSupplementSources();
    const merged = { ...current };
    for (const [slug, src] of Object.entries(updates)) {
      merged[slug] = { ...(current[slug] ?? {}), ...src };
    }
    await fs.writeFile(supplementSourcesPath(), yaml.dump(merged, { sortKeys: true }), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

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
  patch: PlanPatch
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

/**
 * Like updatePlan but also allows ready_to_publish plans — reverts them to draft
 * so the coach can continue editing via chat. Published/revoked/superseded are blocked.
 */
export async function updatePlanForChat(
  slug: string,
  patch: PlanPatch
): Promise<{ ok: true; revertedToDraft?: boolean } | { ok: false; error: string }> {
  const current = await loadPlanBySlug(slug);
  if (!current) return { ok: false, error: `Plan ${slug} not found` };

  const status = (current.status ?? current._bucket) as string;
  const editableStatuses = ["draft", "ready_to_publish", "ready"];
  if (!editableStatuses.includes(status)) {
    return {
      ok: false,
      error: `Plan is ${status} — only draft and ready-to-publish plans can be edited via chat.`,
    };
  }

  const { _bucket, _file, ...rest } = current;
  void _bucket;
  void _file;

  const revertedToDraft = status !== "draft";
  const next: Plan = {
    ...rest,
    ...patch,
    slug,
    // Revert to draft if currently in ready_to_publish
    ...(revertedToDraft ? { status: "draft" } : {}),
  } as Plan;

  await writePlan(next);
  revalidatePath(`/plans/${slug}`);
  revalidatePath("/plans");
  return { ok: true, revertedToDraft };
}

/**
 * Permanently delete a plan file from disk.
 * Published plans cannot be deleted — use Revoke instead.
 */
export async function deletePlan(
  slug: string
): Promise<{ ok: false; error: string } | never> {
  const plan = await loadPlanBySlug(slug);
  if (!plan) return { ok: false, error: `Plan ${slug} not found` };

  const status = plan.status ?? plan._bucket;
  if (status === "published") {
    return {
      ok: false,
      error: "Published plans cannot be deleted. Use Revoke instead.",
    };
  }

  await fs.unlink(plan._file);
  revalidatePath("/plans");
  // redirect() throws internally — it must not be inside try/catch
  redirect("/plans");
}

"use server";

import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { PYTHON, SCRIPTS_DIR, runShim } from "@/lib/fmdb/shim";
import { getCataloguePath } from "@/lib/fmdb/paths";

export type TriageBucket = "auto" | "coach_eye" | "dismiss";

export interface CleanupGroup {
  id: string;
  kind: "duplicate_topics" | "topic_is_protocol" | "topic_is_mechanism" | "topic_is_symptom";
  canonical: string;
  members: string[];
  reason: string;
  dismissed_at?: string;
  /** Pre-classified bucket from scripts/classify-cleanup.py (optional). */
  triage_bucket?: TriageBucket;
  /** Human-readable rationale for the bucket. */
  triage_note?: string;
}

export interface CleanupPlan {
  generated_at: string;
  topic_count: number;
  groups: CleanupGroup[];
}

export interface AnalyzeResult {
  ok: boolean;
  plan?: CleanupPlan;
  error?: string;
}

export interface ApplyResult {
  ok: boolean;
  summary?: {
    canonical_slug: string;
    aliases_added: string[];
    files_deleted: string[];
    warnings: string[];
  };
  needs_stub?: boolean;
  target_kind?: "protocol" | "mechanism" | "symptom";
  target_slug?: string;
  error?: string;
}

const PLAN_PATH = path.join(getCataloguePath(), "_cleanup", "latest_plan.yaml");

async function readPlan(): Promise<CleanupPlan | null> {
  try {
    const raw = await fs.readFile(PLAN_PATH, "utf-8");
    return (yaml.load(raw) as CleanupPlan) ?? null;
  } catch {
    return null;
  }
}

async function writePlan(plan: CleanupPlan): Promise<void> {
  const dir = path.dirname(PLAN_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(PLAN_PATH, yaml.dump(plan, { sortKeys: false }));
}

/** Run the Haiku analyzer. Stores plan on disk + returns it. */
export async function analyzeCleanupAction(
  opts: { dryRun?: boolean; limit?: number | null } = {}
): Promise<AnalyzeResult> {
  try {
    const result = (await runShim(
      "analyze-catalogue-duplicates.py",
      { dry_run: !!opts.dryRun, limit: opts.limit ?? null },
      180_000, // 3 min — 318 topics + structured output
    )) as AnalyzeResult;
    if (result.ok) revalidatePath("/catalogue/cleanup");
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Load the most recent plan from disk (without re-running analysis). */
export async function loadCleanupPlanAction(): Promise<CleanupPlan | null> {
  return readPlan();
}

/** Apply a single cleanup group: merge duplicates OR move topic→protocol/mech/symptom. */
export async function applyCleanupGroupAction(
  group: CleanupGroup,
  dryRun: boolean = false,
  createStub: boolean = false,
): Promise<ApplyResult> {
  try {
    const scriptPath = path.join(SCRIPTS_DIR, "apply-cleanup.py");
    const child = execFile(PYTHON, [scriptPath], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    child.stdin?.end(JSON.stringify({ group, dry_run: dryRun, create_stub: createStub }));
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c));
    child.stderr?.on("data", (c: Buffer) => (stderr += c));
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", () => resolve());
    });
    if (!stdout.trim()) {
      return { ok: false, error: `apply-cleanup.py produced no output. stderr: ${stderr.slice(0, 400)}` };
    }
    const result = JSON.parse(stdout) as ApplyResult;
    if (result.ok && !dryRun) {
      // Mark the group as applied — remove from plan
      const plan = await readPlan();
      if (plan) {
        plan.groups = plan.groups.filter((g) => g.id !== group.id);
        await writePlan(plan);
      }
      revalidatePath("/catalogue");
      revalidatePath("/catalogue/cleanup");
    }
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface BulkApplyResult {
  ok: boolean;
  applied: string[];
  failed: Array<{ id: string; canonical: string; error: string }>;
  total: number;
}

/** Apply every group whose triage_bucket === "auto". Sequential — alias
 *  unions could race across canonicals if we parallelised. Each apply
 *  rewrites latest_plan.yaml, so we re-read after every call to stay
 *  consistent with disk. */
export async function applyAllAutoAction(): Promise<BulkApplyResult> {
  const plan = await readPlan();
  if (!plan) {
    return { ok: false, applied: [], failed: [], total: 0 };
  }
  const autoGroups = plan.groups.filter((g) => g.triage_bucket === "auto");
  const applied: string[] = [];
  const failed: Array<{ id: string; canonical: string; error: string }> = [];

  for (const g of autoGroups) {
    const res = await applyCleanupGroupAction(g, false, false);
    if (res.ok) {
      applied.push(g.id);
    } else {
      failed.push({ id: g.id, canonical: g.canonical, error: res.error ?? "unknown" });
    }
  }

  revalidatePath("/catalogue");
  revalidatePath("/catalogue/cleanup");
  return { ok: failed.length === 0, applied, failed, total: autoGroups.length };
}

/** Dismiss every group whose triage_bucket === "dismiss". */
export async function dismissAllAutoAction(): Promise<{ ok: boolean; dismissed: number }> {
  const plan = await readPlan();
  if (!plan) return { ok: true, dismissed: 0 };
  const toDismiss = plan.groups.filter((g) => g.triage_bucket === "dismiss");
  for (const g of toDismiss) {
    await dismissCleanupGroupAction(g.id);
  }
  return { ok: true, dismissed: toDismiss.length };
}

/** Mark a group as dismissed (coach reviewed and rejected — keep all topics). */
export async function dismissCleanupGroupAction(
  groupId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const plan = await readPlan();
    if (!plan) return { ok: true };
    plan.groups = plan.groups.filter((g) => g.id !== groupId);
    await writePlan(plan);
    revalidatePath("/catalogue/cleanup");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

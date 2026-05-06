"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";
const WEB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database-web";
const TIMEOUT_MS = 60_000;

export interface LifecycleResult {
  ok: boolean;
  error?: string | null;
  plan?: Record<string, unknown> | null;
  written_path?: string | null;
  git_sha?: string | null;
}

export interface DiffResult {
  ok: boolean;
  diff?: string | null;
  error?: string | null;
}

export interface RenderResult {
  ok: boolean;
  content?: string | null;
  error?: string | null;
}

interface LifecyclePayload {
  action: "submit" | "publish" | "revoke" | "supersede" | "diff";
  slug: string;
  by?: string;
  reason?: string;
  slug_b?: string;
  dry_run?: boolean;
}

function runShim<T = unknown>(
  scriptName: string,
  payload: unknown
): Promise<T> {
  return new Promise<T>((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts", scriptName);
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, TIMEOUT_MS);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      timer = null;
      resolve({ ok: false, error: String(err) } as T);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `${scriptName} exited ${code} with no stdout: ${stderr.slice(0, 500)}`,
        } as T);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (e) {
        resolve({
          ok: false,
          error: `failed to parse ${scriptName} output: ${e}\nstdout: ${stdout.slice(0, 500)}`,
        } as T);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function lifecycle(payload: LifecyclePayload): Promise<LifecycleResult> {
  return runShim<LifecycleResult>("plan-lifecycle.py", payload);
}

function bust(slug: string) {
  revalidatePath("/plans");
  revalidatePath(`/plans/${slug}`, "page");
}

export async function submitPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "submit", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function publishPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "publish", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function revokePlan(
  slug: string,
  reason: string
): Promise<LifecycleResult> {
  if (!reason || !reason.trim()) {
    return { ok: false, error: "Revoke requires a non-empty reason." };
  }
  const r = await lifecycle({ action: "revoke", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function supersedePlan(
  newSlug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "supersede", slug: newSlug, reason });
  if (r.ok) bust(newSlug);
  return r;
}

export async function diffPlans(
  slugA: string,
  slugB: string
): Promise<DiffResult> {
  const r = await lifecycle({ action: "diff", slug: slugA, slug_b: slugB });
  return { ok: r.ok, diff: (r as unknown as DiffResult).diff, error: r.error };
}

export async function renderPlan(
  slug: string,
  format: "markdown" | "html"
): Promise<RenderResult> {
  return runShim<RenderResult>("plan-render.py", { slug, format });
}

/**
 * Create a successor draft plan from an existing published plan. Loads the
 * old plan, clones its YAML into drafts/<newSlug>.yaml with `supersedes`
 * pointing back at the old slug, status reset to draft, version reset to 0.
 *
 * The coach can then edit the new draft, run plan-check, submit, and
 * supersede via the published-state action panel on the NEW slug.
 */
export async function createSuccessor(
  oldSlug: string,
  newSlug: string
): Promise<{ ok: boolean; error?: string }> {
  if (!newSlug || !newSlug.trim()) {
    return { ok: false, error: "New slug is required." };
  }
  if (newSlug === oldSlug) {
    return { ok: false, error: "New slug must differ from old slug." };
  }
  const old = await loadPlanBySlug(oldSlug);
  if (!old) return { ok: false, error: `Plan ${oldSlug} not found.` };

  // Make sure the new slug is not already taken
  const existing = await loadPlanBySlug(newSlug);
  if (existing) return { ok: false, error: `Plan ${newSlug} already exists.` };

  const root = getPlansRoot();
  const draftsDir = path.join(root, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });

  // Clone, strip loader-only fields, reset lifecycle
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _bucket, _file, ...rest } = old;
  const successor: Record<string, unknown> = {
    ...rest,
    slug: newSlug,
    status: "draft",
    version: 0,
    supersedes: oldSlug,
    status_history: [],
    catalogue_snapshot: undefined,
  };
  // Use writePlan if it routes by status; otherwise write directly to drafts/
  try {
    await writePlan(successor as Parameters<typeof writePlan>[0]);
  } catch {
    // Fallback: write directly to drafts/<newSlug>.yaml
    const filePath = path.join(draftsDir, `${newSlug}.yaml`);
    await fs.writeFile(
      filePath,
      yaml.dump(successor, { noRefs: true, sortKeys: false }),
      "utf-8"
    );
  }
  bust(newSlug);
  revalidatePath("/plans");
  return { ok: true };
}

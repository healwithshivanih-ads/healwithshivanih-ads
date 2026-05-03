"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";
const WEB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database-web";
const TIMEOUT_MS = 60_000;

export interface BacklogActionResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
  code?: number;
}

function runShim(payload: unknown): Promise<BacklogActionResult> {
  return new Promise((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts", "backlog-action.py");
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, TIMEOUT_MS);
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `shim exited ${code} with no stdout: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as BacklogActionResult);
      } catch (e) {
        resolve({ ok: false, error: `parse error: ${e}` });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function promoteBacklogItem(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    action: "promote",
    id,
    kind: formData.get("kind") ? String(formData.get("kind")) : null,
    slug: formData.get("slug") ? String(formData.get("slug")) : null,
    display_name: formData.get("display_name")
      ? String(formData.get("display_name"))
      : null,
    force: formData.get("force") === "on",
    updated_by: "shivani",
  };
  const r = await runShim(payload);
  if (!r.ok) {
    console.error("[backlog promote] failed:", r.error, r.stderr);
  }
  revalidatePath("/backlog");
}

export async function rejectBacklogItem(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    action: "reject",
    id,
    note: formData.get("note") ? String(formData.get("note")) : null,
  };
  const r = await runShim(payload);
  if (!r.ok) {
    console.error("[backlog reject] failed:", r.error, r.stderr);
  }
  revalidatePath("/backlog");
}

export interface BulkResult {
  ok: boolean;
  successes: string[];
  failures: { id: string; error: string }[];
}

/**
 * Bulk-reject backlog items. Loops the single-item shim sequentially because
 * each shim spawns a Python subprocess, and parallelizing N python procs
 * tends to thrash the validator. With 50–100 items, sequential ~5–10s total
 * is fine.
 */
export async function bulkRejectBacklogItems(
  ids: string[],
  note?: string | null
): Promise<BulkResult> {
  const successes: string[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    if (!id) continue;
    const r = await runShim({ action: "reject", id, note: note ?? null });
    if (r.ok) {
      successes.push(id);
    } else {
      failures.push({ id, error: r.error ?? r.stderr ?? "unknown error" });
    }
  }
  revalidatePath("/backlog");
  return { ok: failures.length === 0, successes, failures };
}

/**
 * Mark items as added without creating a stub — used when the coach has
 * already authored the catalogue entry by hand and just wants the backlog
 * row to stop showing as open. Implemented via the shim's reject action with
 * a "(marked added — already authored)" note + we then directly flip the
 * status field. The simplest reliable path is to use `--note` on reject and
 * have the user understand "rejected" semantically here means "handled".
 *
 * To avoid that conflation we instead use the promote action with --force
 * + a marker note. But that creates a stub, which we don't want. So the
 * cleanest path is a dedicated CLI verb. For now we shell out to a tiny
 * helper script that flips status to "added" without writing any catalogue
 * file.
 */
export async function bulkMarkAddedBacklogItems(
  ids: string[]
): Promise<BulkResult> {
  const successes: string[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    if (!id) continue;
    const r = await runShim({
      action: "mark_added",
      id,
      note: "marked added without stub",
    });
    if (r.ok) {
      successes.push(id);
    } else {
      failures.push({ id, error: r.error ?? r.stderr ?? "unknown error" });
    }
  }
  revalidatePath("/backlog");
  return { ok: failures.length === 0, successes, failures };
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import type { Plan, PlanStatus } from "./types";

/**
 * Bucket-routing for plan files. Mirrors fm-database/fmdb/plan/storage.py
 * `_STATUS_DIR`. Only the `published`, `superseded`, and `revoked` buckets
 * use versioned filenames (`<slug>-v<N>.yaml`). Drafts and ready use
 * unversioned `<slug>.yaml`.
 */
const BUCKET_DIR: Record<PlanStatus, string> = {
  draft: "drafts",
  ready_to_publish: "ready",
  published: "published",
  superseded: "superseded",
  revoked: "revoked",
};

const VERSIONED_BUCKETS: PlanStatus[] = [
  "published",
  "superseded",
  "revoked",
];

function bucketDir(status: PlanStatus): string {
  return path.join(getPlansRoot(), BUCKET_DIR[status]);
}

function fileNameFor(plan: Plan, status: PlanStatus): string {
  if (VERSIONED_BUCKETS.includes(status)) {
    const v = plan.version ?? 1;
    return `${plan.slug}-v${v}.yaml`;
  }
  return `${plan.slug}.yaml`;
}

/**
 * Locate the existing on-disk file for a plan slug across all buckets.
 * Returns the absolute path, or null if not found. Used so that a Save
 * after a status change knows to delete the old bucket's file.
 */
async function findExistingPlanFile(slug: string): Promise<string | null> {
  for (const status of Object.keys(BUCKET_DIR) as PlanStatus[]) {
    const dir = bucketDir(status);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    const match = entries.find(
      (n) =>
        n === `${slug}.yaml` ||
        n.startsWith(`${slug}-v`) && n.endsWith(".yaml")
    );
    if (match) return path.join(dir, match);
  }
  return null;
}

/**
 * Persist a Plan to disk in the bucket dictated by `plan.status`.
 *
 * - Bumps `updated_at` to current ISO timestamp.
 * - Removes any pre-existing copy of this slug from any bucket BEFORE
 *   writing, so a status transition doesn't leave orphans behind.
 * - Uses js-yaml dump with sortKeys: false to roughly preserve order.
 */
export async function writePlan(plan: Plan): Promise<void> {
  const status: PlanStatus = (plan.status as PlanStatus) ?? "draft";
  const dir = bucketDir(status);
  await fs.mkdir(dir, { recursive: true });

  // Bump updated_at to now
  const next: Plan = {
    ...plan,
    status,
    updated_at: new Date().toISOString(),
  };

  const target = path.join(dir, fileNameFor(next, status));

  // Clean up any existing copy in another bucket (or with a different
  // version filename in the same bucket) so we don't leave duplicates.
  const existing = await findExistingPlanFile(plan.slug);
  if (existing && existing !== target) {
    try {
      await fs.unlink(existing);
    } catch {
      // best-effort
    }
  }

  const dump = yaml.dump(next, {
    sortKeys: false,
    lineWidth: 120,
    noRefs: true,
  });
  await fs.writeFile(target, dump, "utf-8");
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { dumpYaml } from "./yaml-dump";
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
  graduated: "graduated",
};

const VERSIONED_BUCKETS: PlanStatus[] = [
  "published",
  "superseded",
  "graduated",
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
 * One-draft-per-client policy (2026-05-12).
 *
 * When a NEW draft is written for a client, delete every OTHER draft
 * file in drafts/ that has the same `client_id`. Keeps the drafts/
 * bucket from accumulating stale empty placeholders, intermediate AI
 * synthesis output, and abandoned manual scaffolds — each of which
 * shows up as a "pendingDraft" callout on the v2 Plan tab and clutters
 * the coach's view.
 *
 * Scope:
 *   - Only `drafts/` is touched (NOT ready_to_publish, published,
 *     superseded, revoked — those are part of the audit trail).
 *   - Only runs when the caller is writing a NEW file (i.e. nothing
 *     was previously on disk under this slug). Updates to an existing
 *     draft via plan-chat / inline edit don't trigger pruning.
 *   - Reads each candidate's client_id from its YAML; skips entries
 *     that fail to parse instead of nuking the whole bucket.
 */
async function pruneOldDrafts(
  newPlanSlug: string,
  newPlanClientId: string | undefined,
): Promise<void> {
  if (!newPlanClientId) return;
  const draftsDir = bucketDir("draft");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(draftsDir);
  } catch {
    return; // no drafts dir yet — nothing to prune
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml")) continue;
    if (name === `${newPlanSlug}.yaml`) continue; // never delete the one we just wrote
    const fpath = path.join(draftsDir, name);
    try {
      const raw = await fs.readFile(fpath, "utf-8");
      const parsed = yaml.load(raw) as { client_id?: string } | null;
      if (parsed?.client_id !== newPlanClientId) continue;
      await fs.unlink(fpath);
    } catch {
      // best-effort — bad YAML or unlink failure is non-fatal
    }
  }
}

/**
 * Persist a Plan to disk in the bucket dictated by `plan.status`.
 *
 * - Bumps `updated_at` to current ISO timestamp.
 * - Removes any pre-existing copy of this slug from any bucket BEFORE
 *   writing, so a status transition doesn't leave orphans behind.
 * - Auto-prunes older drafts for the same client when this is a NEW
 *   draft file (one-draft-per-client policy).
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

  const dump = dumpYaml(next, {
    sortKeys: false,
    lineWidth: 120,
    noRefs: true,
  });
  // Atomic write: temp file then rename, so a crash or concurrent write
  // mid-write can't leave a truncated / unparseable PHI plan file
  // (audit Phase-1 M1). rename() is atomic on the same filesystem.
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, dump, "utf-8");
  await fs.rename(tmp, target);

  // One-draft-per-client: when we just wrote a NEW draft (the file didn't
  // exist anywhere before this call), purge older drafts for this client.
  // Skip when we were just updating an existing draft.
  if (status === "draft" && existing === null) {
    await pruneOldDrafts(plan.slug, plan.client_id as string | undefined);
  }
}

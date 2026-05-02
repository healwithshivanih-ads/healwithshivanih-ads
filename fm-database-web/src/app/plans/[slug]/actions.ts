"use server";

import { revalidatePath } from "next/cache";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import type { Plan } from "@/lib/fmdb/types";

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

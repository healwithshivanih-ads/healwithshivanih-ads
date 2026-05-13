"use server";

import { revalidatePath } from "next/cache";
import { runShim } from "@/lib/fmdb/shim";

export interface SaveNotesResult {
  ok: boolean;
  error?: string | null;
}

export async function saveCoachNotesAction(
  kind: string,
  slug: string,
  notes: string
): Promise<SaveNotesResult> {
  const result = (await runShim(
    "catalogue-notes-save.py",
    { kind, slug, notes },
    10_000
  )) as SaveNotesResult;

  if (result.ok) {
    revalidatePath(`/catalogue/${kind}/${slug}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reclassify / merge / delete a single catalogue entity.
//
// "move"   — move to another kind (creates a stub if target doesn't exist;
//             coach must confirm stub creation via create_stub=true).
// "merge"  — merge into an existing entity; source slug + aliases become
//             aliases on the canonical so existing references still resolve.
// "delete" — hard delete; cross-refs become non-blocking warnings.
// ---------------------------------------------------------------------------

export interface ReclassifyInput {
  action: "move" | "merge" | "delete";
  source_kind: string;
  source_slug: string;
  target_kind?: string | null;
  create_stub?: boolean;
  merge_into_kind?: string | null;
  merge_into_slug?: string | null;
  dry_run?: boolean;
}

export interface ReclassifyResult {
  ok: boolean;
  summary?: {
    action: string;
    source: string;
    target: string | null;
    aliases_added: string[];
    files_deleted: string[];
    warnings: string[];
  };
  needs_stub?: boolean;
  target_kind?: string;
  target_slug?: string;
  error?: string | null;
}

export async function reclassifyEntityAction(
  input: ReclassifyInput
): Promise<ReclassifyResult> {
  const result = (await runShim(
    "reclassify-entity.py",
    input,
    30_000
  )) as ReclassifyResult;
  if (result.ok && !input.dry_run) {
    revalidatePath(`/catalogue`);
    revalidatePath(`/catalogue/${input.source_kind}/${input.source_slug}`);
    if (input.action === "move" && input.target_kind) {
      revalidatePath(`/catalogue/${input.target_kind}/${input.source_slug}`);
    }
    if (input.action === "merge" && input.merge_into_kind && input.merge_into_slug) {
      revalidatePath(`/catalogue/${input.merge_into_kind}/${input.merge_into_slug}`);
    }
  }
  return result;
}

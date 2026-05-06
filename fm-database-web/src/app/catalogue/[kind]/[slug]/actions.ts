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

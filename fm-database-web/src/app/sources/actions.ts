"use server";

import { revalidatePath } from "next/cache";
import { runShim } from "@/lib/fmdb/shim";

export interface SourceSaveInput {
  id: string;
  title: string;
  source_type: string;
  quality: string;
  authors?: string[];
  year?: number | null;
  publisher?: string;
  url?: string;
  doi?: string;
  notes?: string;
}

export interface SourceSaveResult {
  ok: boolean;
  id?: string;
  already_existed?: boolean;
  error?: string | null;
}

export async function saveSourceAction(input: SourceSaveInput): Promise<SourceSaveResult> {
  const result = (await runShim("source-save.py", input, 20_000)) as SourceSaveResult;
  if (result.ok) {
    revalidatePath("/catalogue");
    revalidatePath("/sources");
  }
  return result;
}

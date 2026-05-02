"use server";

import {
  runAssess,
  generateDraftFromSuggestions,
  saveClientUpload,
  type AssessInput,
  type AssessResult,
  type GenerateDraftInput,
  type GenerateDraftResult,
} from "@/lib/fmdb/anthropic";

export async function runAssessAction(
  input: AssessInput
): Promise<AssessResult> {
  return runAssess(input);
}

export async function generateDraftAction(
  input: GenerateDraftInput
): Promise<GenerateDraftResult> {
  return generateDraftFromSuggestions(input);
}

export async function uploadFileAction(
  clientId: string,
  filename: string,
  bytes: Uint8Array
): Promise<string> {
  // Date-prefix to mirror the Streamlit version's collision handling.
  const today = new Date().toISOString().slice(0, 10);
  const stored = `${today}-${filename}`;
  return saveClientUpload(
    clientId,
    stored,
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  );
}

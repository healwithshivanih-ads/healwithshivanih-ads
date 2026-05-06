"use server";

import { execFile as execFileCb } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { revalidatePath } from "next/cache";

const PYTHON = "/Users/shivani/code/healwithshivanih-ads/fm-database/.venv/bin/python";
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

function runShim(scriptName: string, payload: unknown, timeoutMs = 300_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = execFileCb(PYTHON, [path.join(SCRIPTS_DIR, scriptName)], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    child.stdin?.end(JSON.stringify(payload));
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d));
    child.stderr?.on("data", (d: Buffer) => (stderr += d));
    child.on("error", reject);
    child.on("close", () => {
      if (!stdout.trim()) reject(new Error(`No output. stderr: ${stderr.slice(0, 600)}`));
      else {
        try { resolve(JSON.parse(stdout) as Record<string, unknown>); }
        catch { reject(new Error(`JSON parse error. stdout: ${stdout.slice(0, 200)}`)); }
      }
    });
  });
}

export interface IngestInput {
  // File upload mode
  fileDataBase64?: string;
  fileName?: string;
  // URL mode
  url?: string;
  // Common
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  sourceQuality: string;
  instructions?: string;
}

export interface IngestResult {
  ok: boolean;
  batchId?: string;
  stdout?: string;
  error?: string;
}

export async function runIngestAction(input: IngestInput): Promise<IngestResult> {
  // URL mode — pass URL directly to Python shim (it fetches)
  if (input.url && !input.fileDataBase64) {
    try {
      const result = await runShim("ingest-action.py", {
        action: "ingest",
        url: input.url,
        source_id: input.sourceId,
        source_title: input.sourceTitle,
        source_type: input.sourceType,
        source_quality: input.sourceQuality,
        instructions: input.instructions ?? "",
      }, 300_000);

      revalidatePath("/ingest");
      return {
        ok: result.ok as boolean,
        batchId: result.batch_id as string | undefined,
        stdout: result.stdout as string | undefined,
        error: result.error as string | undefined,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  // File upload mode — write to temp file then pass path
  if (!input.fileDataBase64 || !input.fileName) {
    return { ok: false, error: "Either a file or a URL is required" };
  }

  const ext = path.extname(input.fileName) || ".pdf";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmdb-ingest-"));
  const tmpFile = path.join(tmpDir, `upload${ext}`);

  try {
    const buf = Buffer.from(input.fileDataBase64, "base64");
    await fs.writeFile(tmpFile, buf);

    const result = await runShim("ingest-action.py", {
      action: "ingest",
      file_path: tmpFile,
      source_id: input.sourceId,
      source_title: input.sourceTitle,
      source_type: input.sourceType,
      source_quality: input.sourceQuality,
      instructions: input.instructions ?? "",
    }, 300_000);

    revalidatePath("/ingest");
    return {
      ok: result.ok as boolean,
      batchId: result.batch_id as string | undefined,
      stdout: result.stdout as string | undefined,
      error: result.error as string | undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

export interface ReviewResult {
  ok: boolean;
  stdout?: string;
  error?: string;
}

export async function reviewBatchAction(batchId: string): Promise<ReviewResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "review", batch_id: batchId });
    return { ok: true, stdout: result.stdout as string };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listBatchesAction(): Promise<ReviewResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "review", batch_id: null });
    return { ok: true, stdout: result.stdout as string };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export interface ApproveResult {
  ok: boolean;
  stdout?: string;
  error?: string;
}

export async function approveBatchAction(batchId: string, update: boolean): Promise<ApproveResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "approve", batch_id: batchId, update });
    revalidatePath("/catalogue");
    revalidatePath("/ingest");
    return {
      ok: result.ok as boolean,
      stdout: result.stdout as string | undefined,
      error: result.error as string | undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function rejectBatchAction(batchId: string): Promise<ApproveResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "reject", batch_id: batchId });
    revalidatePath("/ingest");
    return {
      ok: result.ok as boolean,
      stdout: result.stdout as string | undefined,
      error: result.error as string | undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export interface ApproveAllResult {
  ok: boolean;
  approved: number;
  failed: number;
  skipped: number;
  total: number;
  errors: string[];
  log: string[];
}

export async function approveAllPendingAction(): Promise<ApproveAllResult> {
  try {
    const result = await runShim(
      "ingest-action.py",
      { action: "approve_all" },
      1_800_000, // 30 min — could be many batches
    );
    revalidatePath("/catalogue");
    revalidatePath("/ingest");
    return result as unknown as ApproveAllResult;
  } catch (err) {
    return { ok: false, approved: 0, failed: 0, skipped: 0, total: 0, errors: [String(err)], log: [] };
  }
}

// ── Staged entity enrichment ──────────────────────────────────────────────────

export interface StagedEntity {
  entity: string;
  slug: string;
  status: string;
  display_name: string;
  linked_to_topics: string[];
  linked_to_mechanisms: string[];
  linked_to_supplements: string[];
  linked_to_claims: string[];
  notes_for_coach: string;
}

export interface ListStagedEntitiesResult {
  ok: boolean;
  entities: StagedEntity[];
  error?: string;
}

export async function listStagedEntitiesAction(batchId: string): Promise<ListStagedEntitiesResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "list_staged_entities", batch_id: batchId }, 15_000);
    return result as unknown as ListStagedEntitiesResult;
  } catch (err) {
    return { ok: false, entities: [], error: String(err) };
  }
}

export interface PatchStagedEntityResult {
  ok: boolean;
  error?: string;
}

export async function patchStagedEntityAction(
  batchId: string,
  entityKind: string,
  slug: string,
  patch: {
    linked_to_topics?: string[];
    linked_to_mechanisms?: string[];
    linked_to_supplements?: string[];
    linked_to_claims?: string[];
    notes_for_coach?: string;
  }
): Promise<PatchStagedEntityResult> {
  try {
    const result = await runShim("ingest-action.py", {
      action: "patch_staged_entity",
      batch_id: batchId,
      entity_kind: entityKind,
      slug,
      patch,
    }, 10_000);
    return result as unknown as PatchStagedEntityResult;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Source registration (mirrors /sources/actions.ts — consolidated here) ─────

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
  const result = await runShim("source-save.py", input, 20_000) as unknown as SourceSaveResult;
  if (result.ok) {
    revalidatePath("/catalogue");
    revalidatePath("/ingest");
  }
  return result;
}

export interface BatchStatusResult {
  ok: boolean;
  status: string | null;  // "approved" | "rejected" | null (pending)
  entry_count?: number;
  error?: string;
}

export async function getBatchStatusAction(batchId: string): Promise<BatchStatusResult> {
  try {
    const result = await runShim("ingest-action.py", { action: "batch_status", batch_id: batchId }, 10_000);
    return result as unknown as BatchStatusResult;
  } catch (err) {
    return { ok: false, status: null, error: String(err) };
  }
}

export async function countPendingBatchesAction(): Promise<{ count: number }> {
  try {
    const result = await runShim("ingest-action.py", { action: "count_pending" }, 15_000);
    return { count: (result.count as number) ?? 0 };
  } catch {
    return { count: 0 };
  }
}

// ── Coach knowledge ───────────────────────────────────────────────────────────

export interface CoachKnowledgeResult {
  ok: boolean;
  batchId?: string;
  stdout?: string;
  error?: string;
}

// ── Coach knowledge catalogue check ──────────────────────────────────────────

export interface CatalogueRelated {
  kind: string;
  slug: string;
  display_name: string;
  summary: string;
  notes_for_coach: string;
  evidence_tier: string;
  relation: "supports" | "conflicts" | "overlaps" | "referenced";
  relation_note: string;
}

export interface CoachKnowledgeCheckResult {
  ok: boolean;
  related: CatalogueRelated[];
  assessment: string;
  is_new_ground: boolean;
  error?: string;
}

export async function checkCoachKnowledgeAction(text: string): Promise<CoachKnowledgeCheckResult> {
  try {
    const result = await runShim("coach-knowledge-check.py", { text }, 60_000);
    return result as unknown as CoachKnowledgeCheckResult;
  } catch (err) {
    return { ok: false, related: [], assessment: "", is_new_ground: false, error: String(err) };
  }
}

/**
 * Stage a free-text clinical observation as a catalogue ingest batch.
 * The Python shim writes it to a temp file and runs it through the normal
 * fmdb ingest pipeline with source-id=coach-shivani.
 */
export async function runCoachKnowledgeAction(text: string): Promise<CoachKnowledgeResult> {
  try {
    const result = await runShim("coach-knowledge.py", { text }, 300_000);
    revalidatePath("/ingest");
    return {
      ok: result.ok as boolean,
      batchId: result.batch_id as string | undefined,
      stdout: result.stdout as string | undefined,
      error: result.error as string | undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

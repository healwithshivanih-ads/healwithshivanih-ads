import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
export type {
  AssessAttachment,
  AssessInput,
  AssessUsage,
  AssessResult,
  GenerateDraftInput,
  GenerateDraftResult,
  ChatTurn,
  ChatInput,
  ChatResult,
} from "./anthropic-types";
import type {
  AssessInput,
  AssessResult,
  GenerateDraftInput,
  GenerateDraftResult,
  ChatInput,
  ChatResult,
  ChatTurn,
} from "./anthropic-types";

const PYTHON =
  "/Users/shivani/code/healwithshivanih-ads/fm-database/.venv/bin/python";
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

async function runShim(
  scriptName: string,
  payload: unknown,
  timeoutMs = 90_000
): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const child = execFile(PYTHON, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk));
  child.stderr?.on("data", (chunk) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    throw new Error(
      `${scriptName} produced no output. stderr: ${stderr.slice(0, 800)}`
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `${scriptName} produced invalid JSON: ${(err as Error).message}\n` +
        `stdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 800)}`
    );
  }
}

export async function runAssess(input: AssessInput): Promise<AssessResult> {
  const result = (await runShim("assess.py", input, 360_000)) as AssessResult;
  return result;
}

export async function generateDraftFromSuggestions(
  input: GenerateDraftInput
): Promise<GenerateDraftResult> {
  const result = (await runShim(
    "generate-draft.py",
    input,
    30_000
  )) as GenerateDraftResult;
  return result;
}

export async function runChat(input: ChatInput): Promise<ChatResult> {
  const result = (await runShim("chat.py", input, 60_000)) as ChatResult;
  return result;
}

// ---------------------------------------------------------------------------
// Transcript symptom extraction — fast Haiku call, returns matched slugs.
// ---------------------------------------------------------------------------

export interface ExtractSymptomsInput {
  transcript_text?: string;
  transcript_path?: string;
  transcript_url?: string;   // URL (Google Doc, direct link) — fetched server-side by the script
  mime_type?: string;
  symptom_catalogue: Array<{ slug: string; label: string; aliases?: string[] }>;
  dry_run?: boolean;
}

export interface SymptomMention {
  slug: string;
  quote: string;
}

export interface ExtractedLabValue {
  test_name: string;
  value: string;
  unit: string;
  date_drawn?: string | null;
}

export interface ExtractedMeasurements {
  height_cm?: number | null;
  weight_kg?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  hr_bpm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
}

export interface ExtractedHealthData {
  lab_values: ExtractedLabValue[];
  measurements: ExtractedMeasurements;
  medications: string[];
  conditions: string[];
}

export interface ExtractSymptomsResult {
  ok: boolean;
  matched_slugs: string[];
  mentions: SymptomMention[];
  extracted_data?: ExtractedHealthData;
  error?: string | null;
}

export async function extractSymptomsFromTranscript(
  input: ExtractSymptomsInput
): Promise<ExtractSymptomsResult> {
  const result = (await runShim(
    "extract-symptoms.py",
    input,
    120_000   // large lab panels (78+ markers) need up to 2 min
  )) as ExtractSymptomsResult;
  return result;
}

// ---------------------------------------------------------------------------
// Parse free-form coach text into structured health data (no symptom catalogue needed).
// ---------------------------------------------------------------------------

export interface ParseHealthTextInput {
  text: string;
  dry_run?: boolean;
}

export interface ParseHealthTextResult {
  ok: boolean;
  extracted_data?: ExtractedHealthData;
  error?: string | null;
}

export async function parseHealthText(
  input: ParseHealthTextInput
): Promise<ParseHealthTextResult> {
  const result = (await runShim(
    "parse-health-text.py",
    input,
    30_000
  )) as ParseHealthTextResult;
  return result;
}

// ---------------------------------------------------------------------------
// Session chat-log rehydrate — reads the persisted chat_log from a session
// YAML so the Assess chat panel can preload prior turns on page reload.
// ---------------------------------------------------------------------------

export interface LoadSessionChatInput {
  client_id: string;
  session_id: string;
  dry_run?: boolean;
}

export interface LoadSessionChatResult {
  ok: boolean;
  chat_log: ChatTurn[];
  error?: string | null;
}

export async function loadSessionChatHistory(
  input: LoadSessionChatInput
): Promise<LoadSessionChatResult> {
  const result = (await runShim(
    "load-session-chat.py",
    input,
    15_000
  )) as LoadSessionChatResult;
  return result;
}

// ---------------------------------------------------------------------------
// File upload helper — saves an uploaded File to the client's files/ dir,
// mirroring fmdb.plan.storage.save_client_file (dedup by numeric suffix).
// ---------------------------------------------------------------------------

function plansRoot(): string {
  const env = process.env.FMDB_PLANS_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-plans");
}

export async function saveClientUpload(
  clientId: string,
  filename: string,
  data: ArrayBuffer
): Promise<string> {
  const dir = path.join(plansRoot(), "clients", clientId, "files");
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let target = path.join(dir, filename);
  let n = 2;
  while (true) {
    try {
      await fs.access(target);
      target = path.join(dir, `${stem}-${n}${ext}`);
      n += 1;
    } catch {
      break;
    }
  }
  await fs.writeFile(target, Buffer.from(data));
  return target;
}

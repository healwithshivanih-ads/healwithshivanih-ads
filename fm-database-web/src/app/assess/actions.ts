"use server";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { loadClientSessions, type ClientSession } from "@/lib/fmdb/loader-extras";
import {
  runAssess,
  generateDraftFromSuggestions,
  runChat,
  saveClientUpload,
  loadSessionChatHistory,
  extractSymptomsFromTranscript,
  parseHealthText,
  type AssessInput,
  type AssessResult,
  type GenerateDraftInput,
  type GenerateDraftResult,
  type ChatInput,
  type ChatResult,
  type LoadSessionChatInput,
  type LoadSessionChatResult,
  type ExtractSymptomsInput,
  type ExtractSymptomsResult,
  type ExtractedMeasurements,
  type ParseHealthTextInput,
  type ParseHealthTextResult,
} from "@/lib/fmdb/anthropic";
import { PROTOCOL_TEMPLATES } from "@/lib/fmdb/protocol-templates";

/** Slim shape sent across the Server Action boundary — excludes heavy AI analysis payload */
export interface SessionDriver {
  mechanism?: string;
  mechanism_slug?: string;
  confidence?: string | number;
  reasoning?: string;
}

export interface SessionSupplement {
  name?: string;
  supplement_slug?: string;
  rationale?: string;
  dose?: string;
  timing?: string;
}

export interface SessionSummary {
  session_id?: string;
  date?: string;
  presenting_complaints?: string;
  selected_symptoms?: string[];
  selected_topics?: string[];
  generated_plan_slug?: string | null;
  plan_exists: boolean;
  driver_count: number;
  supplement_count: number;
  synthesis_notes?: string;
  /** Parsed from the [session_type: ...] prefix in presenting_complaints */
  session_type: "discovery_consultation" | "pre_intake" | "full_assessment" | "check_in" | "quick_note";
  /** Parsed from the [Requested labs: ...] marker in coach_notes */
  requested_labs: string[];
  /** Five pillars snapshot captured during this session (if any) */
  five_pillars?: {
    sleep_hours?: number;
    sleep_quality?: number;
    stress_level?: number;
    movement_days_per_week?: number;
    nutrition_quality?: number;
    connection_quality?: number;
  };
  /** Key drivers for the session brief export */
  likely_drivers?: SessionDriver[];
  /** Supplement suggestions for the session brief export */
  supplement_suggestions?: SessionSupplement[];
}

// ── Session field parsers (internal — import from @/lib/fmdb/session-utils externally) ──
import { parseSessionType, parseRequestedLabs } from "@/lib/fmdb/session-utils";

async function planExists(slug: string): Promise<boolean> {
  const root = getPlansRoot();
  const buckets = ["drafts", "ready", "published", "superseded", "revoked"];
  for (const bucket of buckets) {
    try {
      // published uses versioned filenames; try both slug.yaml and slug-v*.yaml
      const dir = path.join(root, bucket);
      const entries = await fs.readdir(dir);
      if (entries.some(e => e === `${slug}.yaml` || e.startsWith(`${slug}-v`))) return true;
    } catch { /* bucket dir missing */ }
  }
  return false;
}

export async function loadClientSessionsAction(clientId: string): Promise<SessionSummary[]> {
  if (!clientId) return [];
  const sessions = await loadClientSessions(clientId);

  type Analysis = {
    likely_drivers?: unknown[];
    supplement_suggestions?: unknown[];
    synthesis_notes?: string;
    suggestions?: {
      likely_drivers?: unknown[];
      supplement_suggestions?: unknown[];
      synthesis_notes?: string;
    };
  };

  return Promise.all(sessions.map(async (s): Promise<SessionSummary> => {
    const analysis = ((s as { ai_analysis?: Analysis }).ai_analysis ?? {}) as Analysis;
    const drivers = analysis.likely_drivers ?? analysis.suggestions?.likely_drivers ?? [];
    const supps = analysis.supplement_suggestions ?? analysis.suggestions?.supplement_suggestions ?? [];
    const notes = analysis.synthesis_notes ?? analysis.suggestions?.synthesis_notes ?? "";
    const slug = s.generated_plan_slug ?? null;
    const coach_notes = (s as Record<string, unknown>).coach_notes as string | undefined;
    const rawFp = (s as Record<string, unknown>).five_pillars as Record<string, unknown> | undefined;
    const driversArr = Array.isArray(drivers) ? (drivers as Array<Record<string, unknown>>) : [];
    const suppsArr = Array.isArray(supps) ? (supps as Array<Record<string, unknown>>) : [];
    return {
      session_id: s.session_id,
      date: s.date,
      presenting_complaints: s.presenting_complaints,
      selected_symptoms: s.selected_symptoms,
      selected_topics: s.selected_topics,
      generated_plan_slug: slug,
      plan_exists: slug ? await planExists(slug) : false,
      driver_count: driversArr.length,
      supplement_count: suppsArr.length,
      synthesis_notes: notes ? String(notes).slice(0, 400) : undefined,
      session_type: parseSessionType(s.presenting_complaints),
      requested_labs: parseRequestedLabs(coach_notes),
      five_pillars: rawFp && Object.values(rawFp).some((v) => v != null)
        ? {
            sleep_hours: rawFp.sleep_hours as number | undefined,
            sleep_quality: rawFp.sleep_quality as number | undefined,
            stress_level: rawFp.stress_level as number | undefined,
            movement_days_per_week: rawFp.movement_days_per_week as number | undefined,
            nutrition_quality: rawFp.nutrition_quality as number | undefined,
            connection_quality: rawFp.connection_quality as number | undefined,
          }
        : undefined,
      likely_drivers: driversArr.length > 0
        ? driversArr.map((d) => ({
            mechanism: typeof d.mechanism === "string" ? d.mechanism : (typeof d.mechanism_slug === "string" ? d.mechanism_slug : undefined),
            mechanism_slug: typeof d.mechanism_slug === "string" ? d.mechanism_slug : undefined,
            confidence: (d.confidence as string | number | undefined),
            reasoning: typeof d.reasoning === "string" ? d.reasoning.slice(0, 200) : undefined,
          }))
        : undefined,
      supplement_suggestions: suppsArr.length > 0
        ? suppsArr.map((s) => ({
            name: typeof s.name === "string" ? s.name : (typeof s.supplement_slug === "string" ? s.supplement_slug : undefined),
            supplement_slug: typeof s.supplement_slug === "string" ? s.supplement_slug : undefined,
            rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 200) : undefined,
            dose: typeof s.dose === "string" ? s.dose : undefined,
            timing: typeof s.timing === "string" ? s.timing : undefined,
          }))
        : undefined,
    };
  }));
}

const PYTHON =
  path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

export async function runAssessAction(
  input: AssessInput
): Promise<AssessResult> {
  return runAssess(input);
}

export async function generateDraftAction(
  input: GenerateDraftInput
): Promise<GenerateDraftResult> {
  // Resolve the protocol template (if any) from TypeScript data and embed it
  // so the Python shim doesn't need to know about the TS templates file.
  let resolved: GenerateDraftInput = input;
  if (input.plan_brief?.protocol_template_id) {
    const tpl = PROTOCOL_TEMPLATES.find((t) => t.id === input.plan_brief!.protocol_template_id);
    if (tpl) {
      resolved = {
        ...input,
        plan_brief: {
          ...input.plan_brief,
          // @ts-expect-error — extra field for Python; not part of the TS type
          resolved_template: tpl,
        },
      };
    }
  }
  return generateDraftFromSuggestions(resolved);
}

/**
 * Regenerate a draft plan from a session whose plan was deleted.
 * Passes empty picks so all AI suggestions are included (each pick defaults to true).
 */
export async function regeneratePlanFromSessionAction(
  clientId: string,
  sessionId: string
): Promise<GenerateDraftResult> {
  const result = await generateDraftFromSuggestions({
    client_id: clientId,
    session_id: sessionId,
    picks: {},
  });
  if (result.ok && result.slug) {
    revalidatePath("/assess");
    revalidatePath("/plans");
  }
  return result;
}

export async function chatAction(input: ChatInput): Promise<ChatResult> {
  return runChat(input);
}

export async function loadSessionChatAction(
  input: LoadSessionChatInput
): Promise<LoadSessionChatResult> {
  return loadSessionChatHistory(input);
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

/**
 * Extract symptoms/health data from a file that is already saved on disk.
 * Accepts a filePath (returned by uploadFileAction) instead of raw bytes so
 * that no binary data crosses the Server Action serialization boundary.
 */
export async function extractTranscriptAction(
  filePath: string,
  mimeType: string,
  symptomCatalogue: Array<{ slug: string; label: string; aliases?: string[] }>,
  dryRun = false
): Promise<ExtractSymptomsResult> {
  try {
    const input: ExtractSymptomsInput = {
      transcript_path: filePath,
      mime_type: mimeType,
      symptom_catalogue: symptomCatalogue,
      dry_run: dryRun,
    };
    const result = await extractSymptomsFromTranscript(input);
    if (!result.ok) {
      console.error("[extractTranscriptAction] extraction returned ok:false", result.error);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extractTranscriptAction] threw:", msg);
    return { ok: false, matched_slugs: [], mentions: [], error: msg.slice(0, 400) };
  }
}

/** Extract symptoms from a URL (Google Doc, direct link, etc.) */
export async function extractTranscriptUrlAction(
  url: string,
  symptomCatalogue: Array<{ slug: string; label: string; aliases?: string[] }>,
  dryRun = false
): Promise<ExtractSymptomsResult> {
  if (!url.trim()) {
    return { ok: false, matched_slugs: [], mentions: [], error: "URL is required" };
  }
  try {
    const input: ExtractSymptomsInput = {
      transcript_url: url.trim(),
      symptom_catalogue: symptomCatalogue,
      dry_run: dryRun,
    };
    return await extractSymptomsFromTranscript(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, matched_slugs: [], mentions: [], error: msg.slice(0, 400) };
  }
}

// ---------------------------------------------------------------------------
// Parse free-form coach text into structured health data.
// ---------------------------------------------------------------------------

export async function parseHealthTextAction(
  input: ParseHealthTextInput
): Promise<ParseHealthTextResult> {
  try {
    return await parseHealthText(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 400) };
  }
}

// ---------------------------------------------------------------------------
// Apply transcript-extracted health data (measurements, medications, conditions)
// to the client's YAML profile via the update-client-data.py shim.
// ---------------------------------------------------------------------------

export interface ApplyClientDataInput {
  client_id: string;
  measurements?: ExtractedMeasurements;
  lab_values?: Array<{ test_name: string; value: string; unit: string; date_drawn?: string | null }>;
  medications?: string[];
  conditions?: string[];
  source?: string;
}

export interface ApplyClientDataResult {
  ok: boolean;
  updated_fields?: string[];
  message?: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Compute FM lab ratios from extracted lab values (no AI call — pure Python).
// ---------------------------------------------------------------------------

export interface ComputeRatiosInput {
  lab_values: Array<{ test_name: string; value: string; unit: string; date_drawn?: string | null }>;
}

export interface ComputeRatiosResult {
  ok: boolean;
  ratios: Array<{
    marker_name: string;
    value: number;
    unit: string;
    reference_range: string;
    flag: string;
    fm_interpretation: string;
    panel?: string;
    computed?: boolean;
  }>;
  error?: string | null;
}

export async function computeRatiosAction(
  input: ComputeRatiosInput
): Promise<ComputeRatiosResult> {
  if (!input.lab_values?.length) {
    return { ok: true, ratios: [] };
  }

  const scriptPath = path.join(SCRIPTS_DIR, "compute-ratios.py");
  const child = execFile(PYTHON, [scriptPath], {
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  child.stdin?.end(JSON.stringify(input));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    return { ok: false, ratios: [], error: `compute-ratios.py produced no output. stderr: ${stderr.slice(0, 300)}` };
  }

  try {
    return JSON.parse(stdout) as ComputeRatiosResult;
  } catch {
    return { ok: false, ratios: [], error: `compute-ratios.py returned invalid JSON: ${stdout.slice(0, 200)}` };
  }
}

export async function applyTranscriptDataAction(
  input: ApplyClientDataInput
): Promise<ApplyClientDataResult> {
  const scriptPath = path.join(SCRIPTS_DIR, "update-client-data.py");

  const child = execFile(PYTHON, [scriptPath], {
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  child.stdin?.end(JSON.stringify(input));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    return {
      ok: false,
      error: `update-client-data.py produced no output. stderr: ${stderr.slice(0, 400)}`,
    };
  }

  try {
    const result = JSON.parse(stdout) as ApplyClientDataResult;
    if (result.ok) {
      revalidatePath(`/clients/${input.client_id}`);
    }
    return result;
  } catch {
    return {
      ok: false,
      error: `update-client-data.py produced invalid JSON: ${stdout.slice(0, 200)}`,
    };
  }
}

// ── Lightweight session save (pre-intake / check-in) ────────────────────────

export interface FivePillarsData {
  sleep_hours?: number;
  sleep_quality?: number;            // 1-5
  stress_level?: number;             // 1-5 (1=calm, 5=high stress)
  movement_days_per_week?: number;   // 0-7
  nutrition_quality?: number;        // 1-5
  connection_quality?: number;       // 1-5
}

export interface SaveSessionInput {
  client_id: string;
  session_type: "discovery_consultation" | "pre_intake" | "check_in" | "quick_note";
  session_date?: string;               // ISO YYYY-MM-DD; defaults to today
  selected_symptoms?: string[];
  presenting_complaints?: string;
  coach_notes?: string;
  requested_labs?: string[];
  five_pillars?: FivePillarsData;
}

export interface SaveSessionResult {
  ok: boolean;
  session_id?: string;
  error?: string | null;
}

export async function saveSessionAction(input: SaveSessionInput): Promise<SaveSessionResult> {
  const scriptPath = path.join(SCRIPTS_DIR, "save-session.py");

  const child = execFile(PYTHON, [scriptPath], {
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  child.stdin?.end(JSON.stringify(input));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    return { ok: false, error: `save-session.py produced no output. stderr: ${stderr.slice(0, 400)}` };
  }

  try {
    const result = JSON.parse(stdout) as SaveSessionResult;
    if (result.ok) {
      revalidatePath(`/clients/${input.client_id}`);
    }
    return result;
  } catch {
    return { ok: false, error: `save-session.py invalid JSON: ${stdout.slice(0, 200)}` };
  }
}

// ── Load raw AI analysis for IFM trend scoring ──────────────────────────────

export interface SessionAnalysisData {
  session_id: string;
  date?: string;
  likely_drivers: Array<{ mechanism_slug: string; rank?: number; reasoning?: string }>;
  topics_in_play: Array<{ topic_slug: string; role: string }>;
  selected_symptoms: string[];
}

/**
 * Read raw session YAMLs and return just the ai_analysis fields needed for
 * IFM node scoring. Filters to full_assessment sessions only.
 * Used by the IFM trend component — only called when ≥2 full sessions exist.
 */
export async function loadFullSessionAnalysisAction(
  clientId: string
): Promise<SessionAnalysisData[]> {
  if (!clientId) return [];
  const sessionsDir = path.join(getPlansRoot(), "clients", clientId, "sessions");
  let files: string[];
  try {
    const names = await fs.readdir(sessionsDir);
    files = names.filter((n) => n.endsWith(".yaml") || n.endsWith(".yml")).map((n) => path.join(sessionsDir, n));
  } catch {
    return [];
  }

  const results: SessionAnalysisData[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, "utf-8");
      const s = yaml.load(raw) as Record<string, unknown>;
      const presenting = s.presenting_complaints as string | undefined;
      const sessionType = parseSessionType(presenting);
      if (sessionType !== "full_assessment") continue;

      const ai = (s.ai_analysis as Record<string, unknown> | undefined) ?? {};
      // Drivers can be at ai.likely_drivers or ai.suggestions.likely_drivers
      const sugg = (ai.suggestions as Record<string, unknown> | undefined) ?? {};
      const rawDrivers = (ai.likely_drivers ?? sugg.likely_drivers ?? []) as Array<Record<string, unknown>>;
      const rawTopics = (ai.topics_in_play ?? sugg.topics_in_play ?? []) as Array<Record<string, unknown>>;

      results.push({
        session_id: (s.session_id as string | undefined) ?? path.basename(f, ".yaml"),
        date: s.date as string | undefined,
        likely_drivers: rawDrivers.map((d) => ({
          mechanism_slug: String(d.mechanism_slug ?? ""),
          rank: typeof d.rank === "number" ? d.rank : undefined,
          reasoning: typeof d.reasoning === "string" ? d.reasoning : undefined,
        })),
        topics_in_play: rawTopics.map((t) => ({
          topic_slug: String(t.topic_slug ?? ""),
          role: String(t.role ?? "contributing"),
        })),
        selected_symptoms: (s.selected_symptoms as string[] | undefined) ?? [],
      });
    } catch {
      // skip corrupt files
    }
  }

  // Sort by date ascending (oldest first for trend display)
  results.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return results;
}

// ── Append check-in note to an active plan ───────────────────────────────────

export interface AppendCheckInResult {
  ok: boolean;
  error?: string | null;
}

/**
 * Appends a formatted check-in note block to plan.notes_for_coach.
 * Works on draft AND published plans (check-ins happen mid-protocol).
 */
export async function appendCheckInToPlanAction(
  planSlug: string,
  note: string,
  sessionDate: string,
): Promise<AppendCheckInResult> {
  if (!planSlug || !note.trim()) return { ok: false, error: "Missing plan slug or note" };

  try {
    const plan = await loadPlanBySlug(planSlug);
    if (!plan) return { ok: false, error: `Plan ${planSlug} not found` };

    const header = `\n\n---\n📋 Check-in ${sessionDate}\n`;
    const existing = (plan.notes_for_coach as string | undefined) ?? "";
    const updated = existing + header + note.trim();

    // Drop loader-only fields before writing
    const { _bucket, _file, ...rest } = plan as typeof plan & { _bucket?: string; _file?: string };
    void _bucket;
    void _file;

    await writePlan({ ...rest, notes_for_coach: updated });

    revalidatePath(`/plans/${planSlug}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 300) };
  }
}

// ─── Custom protocol templates ─────────────────────────────────────────────────

export interface CustomTemplate {
  slug: string;
  display_name: string;
  description: string;
  icon: string;
  tags: string[];
  source_plan?: string;
  created_at?: string;
  topics?: unknown[];
  symptoms?: unknown[];
  supplement_protocol?: unknown[];
  lifestyle_practices?: unknown[];
  nutrition?: unknown;
}

/**
 * Load all custom templates saved by the coach in ~/fm-plans/custom_templates/.
 */
export async function loadCustomTemplatesAction(): Promise<CustomTemplate[]> {
  const templatesDir = path.join(getPlansRoot(), "custom_templates");
  try {
    const entries = await fs.readdir(templatesDir);
    const templates: CustomTemplate[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
      try {
        const raw = await fs.readFile(path.join(templatesDir, entry), "utf8");
        const data = yaml.load(raw) as Record<string, unknown>;
        if (!data?.slug) continue;
        templates.push({
          slug: data.slug as string,
          display_name: (data.display_name as string | undefined) ?? (data.slug as string),
          description: (data.description as string | undefined) ?? "",
          icon: (data.icon as string | undefined) ?? "📋",
          tags: (data.tags as string[] | undefined) ?? [],
          source_plan: data.source_plan as string | undefined,
          created_at: data.created_at as string | undefined,
          topics: data.topics as unknown[] | undefined,
          symptoms: data.symptoms as unknown[] | undefined,
          supplement_protocol: data.supplement_protocol as unknown[] | undefined,
          lifestyle_practices: data.lifestyle_practices as unknown[] | undefined,
          nutrition: data.nutrition,
        });
      } catch {
        // skip malformed files
      }
    }
    // Sort newest first
    templates.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return templates;
  } catch {
    return [];
  }
}

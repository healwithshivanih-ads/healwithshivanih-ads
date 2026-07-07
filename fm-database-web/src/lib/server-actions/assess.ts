"use server";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot, getCataloguePath } from "@/lib/fmdb/paths";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { loadClientSessions, loadClientById, type ClientSession } from "@/lib/fmdb/loader-extras";
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
  /** Coach observations / notes — primary body field for quick notes, and
   *  the place the coach writes free-text during check-ins and intakes. */
  coach_notes?: string;
  /** Parsed from the [session_type: ...] prefix in presenting_complaints */
  session_type: "discovery" | "intake" | "check_in" | "quick_note";
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
  /** AI-classified IFM timeline (Antecedents/Triggers/Mediators) */
  ifm_timeline?: Array<{
    year?: number;
    date?: string;
    age_at_event?: number;
    event: string;
    category?: string;
    atm: string;
    rationale?: string;
    linked_driver_slugs?: string[];
  }>;
  /** External reports the coach asked the client to bring back. Late-arriving
   *  reports (genetics, GI-MAP, DUTCH, blood panels) link to this session via
   *  HealthSnapshot.linked_session_id and FunctionalTestRecord.linked_session_id. */
  expected_reports?: string[];
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
    ifm_timeline?: unknown[];
    suggestions?: {
      likely_drivers?: unknown[];
      supplement_suggestions?: unknown[];
      synthesis_notes?: string;
      ifm_timeline?: unknown[];
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
      coach_notes,
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
      ifm_timeline: (() => {
        const raw = analysis.ifm_timeline ?? analysis.suggestions?.ifm_timeline ?? [];
        if (!Array.isArray(raw) || raw.length === 0) return undefined;
        return (raw as Array<Record<string, unknown>>).map((ev) => ({
          year: typeof ev.year === "number" ? ev.year : undefined,
          date: typeof ev.date === "string" ? ev.date : undefined,
          age_at_event: typeof ev.age_at_event === "number" ? ev.age_at_event : undefined,
          event: typeof ev.event === "string" ? ev.event : "",
          category: typeof ev.category === "string" ? ev.category : undefined,
          atm: typeof ev.atm === "string" ? ev.atm : "mediator",
          rationale: typeof ev.rationale === "string" ? ev.rationale : undefined,
          linked_driver_slugs: Array.isArray(ev.linked_driver_slugs)
            ? (ev.linked_driver_slugs as unknown[]).filter((x): x is string => typeof x === "string")
            : undefined,
        })).filter((ev) => ev.event);
      })(),
      expected_reports: Array.isArray((s as Record<string, unknown>).expected_reports)
        ? ((s as Record<string, unknown>).expected_reports as unknown[]).filter((x): x is string => typeof x === "string")
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

/**
 * Guardrail: refuse to build a full draft plan for a client who hasn't
 * signed up for the paid programme yet (e.g. foundation-call / discovery-only
 * clients) unless the coach explicitly confirms. `engagement_status` is the
 * real signal — see `loadClientJourney`'s "Sign-up" step and
 * `discovery-tier.ts`'s `resolveAppTier()`, both of which already key off it.
 * `lifecycle_state` is NOT used here — it defaults to "programme_active" for
 * every manually-created client regardless of actual signup, so it can't be
 * trusted as a gate.
 */
async function checkEngagementGuardrail(
  clientId: string
): Promise<{ blocked: boolean; engagementStatus: string; displayName: string }> {
  const client = await loadClientById(clientId);
  const engagementStatus =
    ((client as unknown as Record<string, unknown> | null)?.engagement_status as
      | string
      | undefined) || "pending";
  const displayName = client?.display_name || clientId;
  return { blocked: engagementStatus !== "signed_up", engagementStatus, displayName };
}

export async function generateDraftAction(
  input: GenerateDraftInput
): Promise<GenerateDraftResult> {
  if (!input.force) {
    const { blocked, engagementStatus, displayName } = await checkEngagementGuardrail(
      input.client_id
    );
    if (blocked) {
      return {
        ok: false,
        needs_confirmation: true,
        engagement_status: engagementStatus,
        error:
          `${displayName} hasn't signed up for the programme yet ` +
          `(engagement status: ${engagementStatus}) — this looks like a ` +
          `foundation-call / discovery-only client. Generate the full draft ` +
          `plan anyway?`,
      };
    }
  }
  // Resolve the protocol template (if any) from TypeScript data and embed it
  // so the Python shim doesn't need to know about the TS templates file.
  //
  // Three template-id shapes the coach can pick:
  //   - "<id>"            — hardcoded ProtocolTemplate (leaky-gut, …)
  //   - "custom:<slug>"   — coach-saved template from a past plan
  //   - "catalogue:<slug>" — catalogue Protocol entity (5R, AIP, …)
  //
  // Hardcoded + custom go through the existing resolved_template merge in
  // generate-draft.py. Catalogue picks instead pre-tick the right picks
  // key (`protocol_<slug>`) so the existing attached_protocols flow
  // catches it — that already pulls supplements_typically_used,
  // foods_to_emphasise/remove, phases, cautions from the YAML.
  let resolved: GenerateDraftInput = input;
  const tplId = input.plan_brief?.protocol_template_id;
  if (tplId) {
    if (tplId.startsWith("catalogue:")) {
      const protoSlug = tplId.slice("catalogue:".length);
      // Force-attach the protocol slug regardless of whether the AI's
      // suggested_protocols list contains it. The existing attached_protocols
      // catalogue-merge loop in generate-draft.py then copies the YAML's
      // supplements / foods / phases / cautions into the draft body.
      resolved = {
        ...input,
        picks: { ...input.picks, [`protocol_${protoSlug}`]: true },
        plan_brief: {
          ...input.plan_brief,
          // @ts-expect-error — extra field for Python; bare list of slugs to attach
          force_attach_protocols: [protoSlug],
        },
      };
    } else {
      const tpl = PROTOCOL_TEMPLATES.find((t) => t.id === tplId);
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

/**
 * Upload a file to a client's files/ directory.
 *
 * Accepts FormData (NOT Uint8Array) because Next 16 RSC serializes
 * Uint8Array byte-by-byte as a nested numeric array, which trips the
 * "Maximum array nesting exceeded" guard for any file > a few MB.
 * FormData streams the binary body and avoids that path entirely.
 *
 * Form fields:
 *   client_id: string
 *   file:      File
 */
export async function uploadFileAction(formData: FormData): Promise<string> {
  const clientId = formData.get("client_id");
  const file = formData.get("file");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("uploadFileAction: client_id missing");
  }
  if (!(file instanceof File)) {
    throw new Error("uploadFileAction: file missing or not a File");
  }
  // Date-prefix to mirror the Streamlit version's collision handling.
  const today = new Date().toISOString().slice(0, 10);
  const stored = `${today}-${file.name}`;
  const buf = await file.arrayBuffer();
  return saveClientUpload(clientId, stored, buf);
}

/**
 * Hash-based duplicate check. Before any upload, the UI can call this to
 * see whether the exact same file (by SHA-256 of bytes) is already on
 * disk for this client. Returns the existing path + filename so the coach
 * can choose "use the existing copy" instead of re-uploading.
 *
 * The check ignores filename — matches purely on content — so the same
 * PDF renamed twice will still be recognised as a duplicate.
 *
 * Walks ~/fm-plans/clients/<id>/files/. ~10–50 files per client; ~50ms
 * per 5MB hash. Acceptable; no caching layer needed yet.
 */
export interface DuplicateFileMatch {
  ok: true;
  duplicate: boolean;
  /** When duplicate=true: the existing file on disk that matches. */
  existing_path?: string;
  existing_filename?: string;
  existing_uploaded_at?: string; // file mtime ISO (best-effort)
}
export async function checkDuplicateUploadAction(
  clientId: string,
  base64Bytes: string,
): Promise<DuplicateFileMatch | { ok: false; error: string }> {
  try {
    const crypto = await import("node:crypto");
    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");

    const buf = Buffer.from(base64Bytes, "base64");
    const sha = crypto.createHash("sha256").update(buf).digest("hex");

    const dir = pathMod.join(getPlansRoot(), "clients", clientId, "files");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return { ok: true, duplicate: false };
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const fp = pathMod.join(dir, name);
      let stat;
      try {
        stat = await fs.stat(fp);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      // Quick win — size mismatch can't be the same file.
      if (stat.size !== buf.byteLength) continue;
      try {
        const existing = await fs.readFile(fp);
        const existingSha = crypto.createHash("sha256").update(existing).digest("hex");
        if (existingSha === sha) {
          return {
            ok: true,
            duplicate: true,
            existing_path: fp,
            existing_filename: name,
            existing_uploaded_at: stat.mtime.toISOString(),
          };
        }
      } catch {
        /* unreadable — skip */
      }
    }
    return { ok: true, duplicate: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Rebuild an extraction result as FLAT primitives before it crosses the Server
 * Action boundary back to the client. Next 16's RSC serializer rejects payloads
 * with deeply-nested arrays ("Maximum array nesting exceeded") — which an
 * AI-produced extraction can occasionally contain (a value returned as a nested
 * list, a malformed structure). Reconstructing with only the known primitive
 * fields guarantees the result always serializes (and drops junk). 2026-06-06.
 */
function sanitizeExtractResult(r: ExtractSymptomsResult): ExtractSymptomsResult {
  const str = (v: unknown): string =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v);
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const ed = r.extracted_data;
  const m = (ed?.measurements ?? {}) as Record<string, unknown>;
  return {
    ok: !!r.ok,
    matched_slugs: Array.isArray(r.matched_slugs)
      ? r.matched_slugs.map(str).slice(0, 500)
      : [],
    mentions: Array.isArray(r.mentions)
      ? r.mentions
          .map((x) => ({ slug: str((x as { slug?: unknown })?.slug), quote: str((x as { quote?: unknown })?.quote) }))
          .slice(0, 500)
      : [],
    extracted_data: ed
      ? {
          lab_values: Array.isArray(ed.lab_values)
            ? ed.lab_values
                .map((l) => {
                  const lv = l as unknown as Record<string, unknown>;
                  return {
                    test_name: str(lv?.test_name),
                    value: str(lv?.value),
                    unit: str(lv?.unit),
                    date_drawn: lv?.date_drawn == null ? null : str(lv?.date_drawn),
                  };
                })
                .slice(0, 500)
            : [],
          measurements: {
            height_cm: num(m.height_cm),
            weight_kg: num(m.weight_kg),
            bp_systolic: num(m.bp_systolic),
            bp_diastolic: num(m.bp_diastolic),
            hr_bpm: num(m.hr_bpm),
            waist_cm: num(m.waist_cm),
            hip_cm: num(m.hip_cm),
          },
          medications: Array.isArray(ed.medications) ? ed.medications.map(str).slice(0, 200) : [],
          conditions: Array.isArray(ed.conditions) ? ed.conditions.map(str).slice(0, 200) : [],
        }
      : undefined,
    error: r.error ?? null,
  };
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
    return sanitizeExtractResult(result);
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
    return sanitizeExtractResult(await extractSymptomsFromTranscript(input));
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
  /** Session this report belongs to. When the report is uploaded weeks after
   *  the session that ordered it, this links the snapshot back to that session
   *  so the session detail view shows everything ordered together. */
  linked_session_id?: string | null;
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

/**
 * Load the most recently saved lab-bearing snapshot for a client so the lab
 * upload panel can rehydrate after refresh. Returns the snapshot's
 * `lab_values` + `measurements` so the panel renders the saved state instead
 * of an empty form. Picks the snapshot with the latest `date_drawn` across
 * all health_snapshots — falls back to `date` if `date_drawn` is missing.
 */
/**
 * Returns the most recent saved session for a client that already has an
 * `ai_analysis` payload (i.e. someone hit "Run AI synthesis" and it
 * completed). Used by the full-assessment form to rehydrate the result
 * panel on mount — without this, every page navigation reset the button
 * to "🧠 Run AI synthesis" even when synthesis had clearly already been
 * run, leading the coach to double-click and burn another ~$0.20.
 */
export interface LatestSynthesis {
  ok: true;
  found: boolean;
  session_id?: string;
  date?: string;
  /** Full ISO created_at — coach can't tell multiple same-day synthesis
   *  runs apart without this. UI formats to "10:38 AM IST". */
  created_at?: string;
  ai_analysis?: Record<string, unknown>;
  generated_plan_slug?: string | null;
}
export async function loadLatestSynthesisAction(
  clientId: string,
): Promise<LatestSynthesis | { ok: false; error: string }> {
  try {
    const sessionsDir = path.join(getPlansRoot(), "clients", clientId, "sessions");
    let names: string[];
    try {
      names = await fs.readdir(sessionsDir);
    } catch {
      return { ok: true, found: false };
    }
    const yamlFiles = names
      .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
      .sort()
      .reverse(); // newest filename first (sessions are dated YYYY-MM-DD-NNN)

    for (const fn of yamlFiles) {
      const fp = path.join(sessionsDir, fn);
      try {
        const raw = await fs.readFile(fp, "utf-8");
        const s = yaml.load(raw) as Record<string, unknown> | null;
        if (!s) continue;
        const ai = (s.ai_analysis as Record<string, unknown> | undefined) ?? {};
        // Skip intake-form sessions which only carry raw_intake_payload.
        const keys = Object.keys(ai).filter((k) => k !== "raw_intake_payload");
        if (keys.length === 0) continue;
        return {
          ok: true,
          found: true,
          session_id: (s.session_id as string | undefined) ?? path.basename(fp, ".yaml"),
          date: s.date as string | undefined,
          created_at: (s.created_at as string | undefined) ?? undefined,
          ai_analysis: ai,
          generated_plan_slug: (s.generated_plan_slug as string | null | undefined) ?? null,
        };
      } catch {
        continue;
      }
    }
    return { ok: true, found: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadLatestLabSnapshotAction(
  clientId: string,
): Promise<{
  ok: true;
  date: string | null;
  source: string | null;
  lab_values: Array<{ test_name: string; value: string; unit: string; date_drawn?: string | null }>;
  measurements: Record<string, unknown> | null;
} | { ok: false; error: string }> {
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const root = getPlansRoot();
    const fp = path.join(root, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(fp, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const snaps = (data.health_snapshots as Array<Record<string, unknown>>) ?? [];
    const labSnaps = snaps.filter(
      (s) => Array.isArray(s.lab_values) && (s.lab_values as unknown[]).length > 0,
    );
    if (labSnaps.length === 0) {
      return { ok: true, date: null, source: null, lab_values: [], measurements: null };
    }
    labSnaps.sort((a, b) =>
      String(b.date ?? "").localeCompare(String(a.date ?? "")),
    );
    const latest = labSnaps[0];

    // Flatten + sanitise. React 19's RSC payload serializer threw
    // "Maximum array nesting exceeded" when handing 71 lab_values back
    // through this action boundary — likely because some YAML values
    // round-tripped as nested arrays or strings carrying YAML-list shape.
    // Coerce every cell to a plain string and strip anything else.
    const rawLabs = Array.isArray(latest.lab_values)
      ? (latest.lab_values as Array<Record<string, unknown>>)
      : [];
    const cleanLabs = rawLabs.slice(0, 200).map((lv) => ({
      test_name: String((lv?.test_name ?? lv?.name ?? "") as string),
      value: String((lv?.value ?? "") as string),
      unit: String((lv?.unit ?? "") as string),
      date_drawn: lv?.date_drawn != null ? String(lv.date_drawn as string) : null,
    }));

    // Measurements is a flat dict on disk; coerce values to primitives.
    const rawMeas = (latest.measurements as Record<string, unknown> | null) ?? null;
    let cleanMeas: Record<string, string | number | null> | null = null;
    if (rawMeas && typeof rawMeas === "object") {
      cleanMeas = {};
      for (const [k, v] of Object.entries(rawMeas)) {
        if (v == null) cleanMeas[k] = null;
        else if (typeof v === "number" || typeof v === "string") cleanMeas[k] = v;
        else cleanMeas[k] = String(v);
      }
    }

    return {
      ok: true,
      date: latest.date != null ? String(latest.date) : null,
      source: latest.source != null ? String(latest.source) : null,
      lab_values: cleanLabs,
      measurements: cleanMeas,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Auto-route a freshly uploaded report to the right structured pipeline
 * so it persists as a parseable record (not just an attached PDF).
 *
 * Filename + first-page text heuristic decides:
 *   - GI-MAP / DUTCH / Sova / BugSpeaks → parse-functional-test.py
 *   - Food sensitivity (IgG / ALCAT / MRT) → extract-report (food_sensitivity)
 *   - Genetic / SNP → extract-report (genetic_test)
 *   - OAT → extract-report (organic_acids)
 *   - Anything else → extract-symptoms + apply (lab snapshot built from
 *     date_drawn so older reports build chronological history)
 *
 * Returns the routing decision + a one-line summary so the UI can toast
 * exactly what happened (e.g. "🦠 GI-MAP parsed — 7 drivers flagged",
 * "🩸 Lab values extracted as snapshot for 2024-08-12 (14 labs)").
 */
export interface AutoRouteResult {
  ok: boolean;
  routed_to?: "functional_test" | "external_report" | "lab_snapshot" | "skipped";
  detected_kind?: string;
  summary?: string;
  saved_path?: string;
  error?: string;
}
export async function autoRouteUploadedReportAction(
  clientId: string,
  filePath: string,
  filename: string,
  mimeType: string,
): Promise<AutoRouteResult> {
  try {
    // Cheap filename + path classifier first. Falls back to body parsing
    // only when the filename is uninformative.
    const lc = filename.toLowerCase();
    const isFunctionalTest =
      /gi[-_ ]?map|dutch|sova|bugspeaks|gut\W?microbiome|stool\W?pcr|microbial\W?assay/.test(lc);
    const isFoodSensitivity =
      /food[-_ ]?(sensitiv|intoler|allerg)|igg\b|alcat|mrt|us\W?biotek|cyrex/.test(lc);
    const isGenetic = /genetic|nutrigenom|snp|mthfr|23andme/.test(lc);
    const isOAT = /\boat\b|organic\W?acids?|great\W?plains\W?oat|genova\W?organix/.test(lc);

    // ── Functional test (DUTCH / GI-MAP / Sova / BugSpeaks) ──
    if (isFunctionalTest) {
      const { parseFunctionalTestAction } = await import("@/lib/server-actions/clients");
      const r = await parseFunctionalTestAction(clientId, filePath);
      if (r.ok && r.test_type && r.test_type !== "unknown") {
        return {
          ok: true,
          routed_to: "functional_test",
          detected_kind: r.test_type,
          summary: `${r.test_type === "gi_map" ? "🦠 GI-MAP" : "🧬 DUTCH"} parsed — ${(r.flagged_drivers ?? []).length} driver${(r.flagged_drivers ?? []).length === 1 ? "" : "s"} flagged`,
          saved_path: r.file_path,
        };
      }
      // Detection failed at the parser. Fall through to lab snapshot path.
    }

    // ── External reports (food sensitivity / genetic / OAT) ──
    let reportType: "food_sensitivity" | "genetic_test" | "organic_acids" | null = null;
    if (isFoodSensitivity) reportType = "food_sensitivity";
    else if (isGenetic) reportType = "genetic_test";
    else if (isOAT) reportType = "organic_acids";

    if (reportType) {
      const fs = await import("node:fs/promises");
      const buf = await fs.readFile(filePath);
      const b64 = buf.toString("base64");
      const { uploadReportAction } = await import("@/lib/server-actions/clients");
      const r = await uploadReportAction({
        clientId,
        reportType,
        fileDataBase64: b64,
        fileName: filename,
      });
      if (r.ok) {
        return {
          ok: true,
          routed_to: "external_report",
          detected_kind: reportType,
          summary:
            reportType === "food_sensitivity"
              ? "🌾 Food sensitivity parsed — reactive foods saved"
              : reportType === "genetic_test"
                ? "🧬 Genetic report parsed"
                : "🔬 OAT parsed",
          saved_path: r.report?.file_path,
        };
      }
    }

    // ── Default: extract lab values + apply as health snapshot ──
    const EMPTY_CATALOGUE: Array<{ slug: string; label: string; aliases?: string[] }> = [];
    const ext = await extractTranscriptAction(
      filePath,
      mimeType || "application/pdf",
      EMPTY_CATALOGUE,
      false,
    );
    if (!ext.ok) {
      return {
        ok: false,
        routed_to: "skipped",
        error: ext.error ?? "Lab extraction failed",
      };
    }
    const labs = ext.extracted_data?.lab_values ?? [];
    const measurements = ext.extracted_data?.measurements ?? null;
    if (labs.length === 0 && !measurements) {
      return {
        ok: true,
        routed_to: "skipped",
        summary: "No lab values or measurements found — keeping the file attached for the AI to read inline.",
      };
    }
    const apply = await applyTranscriptDataAction({
      client_id: clientId,
      lab_values: labs.map((l) => ({
        test_name: l.test_name,
        value: l.value,
        unit: l.unit,
        date_drawn: l.date_drawn ?? null,
      })),
      measurements: measurements ?? undefined,
      source: "lab_report",
    });
    if (!apply.ok) {
      return { ok: false, routed_to: "skipped", error: apply.error ?? "apply failed" };
    }
    // Pull the earliest date_drawn for the toast (older reports → history).
    const drawnDates = labs
      .map((l) => l.date_drawn)
      .filter((d): d is string => !!d)
      .sort();
    const dateLabel = drawnDates[0] ? `drawn ${drawnDates[0]}` : "no date on file";
    return {
      ok: true,
      routed_to: "lab_snapshot",
      detected_kind: "lab_report",
      summary: `🩸 ${labs.length} lab value${labs.length === 1 ? "" : "s"} extracted (${dateLabel}) — saved to client history.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
  session_type: "discovery" | "intake" | "check_in" | "quick_note";
  session_date?: string;               // ISO YYYY-MM-DD; defaults to today
  selected_symptoms?: string[];
  presenting_complaints?: string;
  coach_notes?: string;
  requested_labs?: string[];
  five_pillars?: FivePillarsData;
  // External reports the coach has asked the client to bring back. Late-
  // arriving reports (genetics, GI-MAP, DUTCH, blood panels) link to this
  // session so the session view shows everything ordered together.
  expected_reports?: string[];
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
 * IFM node scoring. Filters to intake sessions only (these carry AI analysis).
 * Used by the IFM trend component — only called when ≥2 intake sessions exist.
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
      if (sessionType !== "intake") continue;

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

// ─── Edit existing session in place ───────────────────────────────────────────

export interface UpdateSessionFieldsInput {
  client_id: string;
  session_id: string;
  /** Updated coach_notes body. Pass undefined to leave unchanged. */
  coach_notes?: string;
  /** Updated presenting_complaints body. Pass undefined to leave unchanged. */
  presenting_complaints?: string;
  /** Patch for the measurements_snapshot (only the keys you want to change).
   *  Pass null on a key to clear that measurement. */
  measurements?: {
    weight_kg?: number | null;
    waist_cm?: number | null;
    bp_systolic?: number | null;
    bp_diastolic?: number | null;
    hr_bpm?: number | null;
  };
}

export interface UpdateSessionFieldsResult {
  ok: boolean;
  error?: string;
}

/**
 * Update a session YAML in place — used by the timeline edit affordance
 * when the coach wants to fix a check-in note, correct measurements, or
 * add information they forgot at the time of original capture.
 *
 * Safe: only edits coach_notes, presenting_complaints, and
 * measurements_snapshot. Frozen fields (session_id, client_id, date,
 * created_at, session_type) are NEVER touched.
 *
 * Doesn't re-append to plan.notes_for_coach — that would double-record.
 * Coach edits the plan separately if the change is significant enough
 * to need to flow into the active plan.
 */
export async function updateSessionFieldsAction(
  input: UpdateSessionFieldsInput,
): Promise<UpdateSessionFieldsResult> {
  if (!input.client_id || !input.session_id) {
    return { ok: false, error: "Missing client_id or session_id" };
  }

  const sessionsDir = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "sessions",
  );

  let files: string[];
  try {
    files = await fs.readdir(sessionsDir);
  } catch (err) {
    return {
      ok: false,
      error: `Sessions directory not found: ${(err as Error).message}`,
    };
  }

  const YAML = await import("js-yaml");
  let foundFile: string | null = null;
  let foundData: Record<string, unknown> | null = null;
  for (const name of files) {
    if (!name.endsWith(".yaml")) continue;
    try {
      const txt = await fs.readFile(path.join(sessionsDir, name), "utf-8");
      const data = (YAML.load(txt) as Record<string, unknown>) || {};
      if (data.session_id === input.session_id) {
        foundFile = name;
        foundData = data;
        break;
      }
    } catch {
      /* skip parse failures */
    }
  }

  if (!foundFile || !foundData) {
    return {
      ok: false,
      error: `Session ${input.session_id} not found in ${input.client_id}`,
    };
  }

  if (input.coach_notes !== undefined) {
    foundData.coach_notes = input.coach_notes;
  }
  if (input.presenting_complaints !== undefined) {
    foundData.presenting_complaints = input.presenting_complaints;
  }
  if (input.measurements) {
    const prev = (foundData.measurements_snapshot as Record<string, unknown>) || {};
    const m = input.measurements;
    const next: Record<string, unknown> = { ...prev };
    if (m.weight_kg !== undefined) next.weight_kg = m.weight_kg;
    if (m.waist_cm !== undefined) next.waist_cm = m.waist_cm;
    if (m.bp_systolic !== undefined) next.bp_systolic = m.bp_systolic;
    if (m.bp_diastolic !== undefined) next.bp_diastolic = m.bp_diastolic;
    if (m.hr_bpm !== undefined) next.hr_bpm = m.hr_bpm;
    foundData.measurements_snapshot = next;
  }

  // Audit breadcrumb — distinguishes "logged live" from "edited later".
  foundData.last_edited_at = new Date().toISOString();

  try {
    // dumpYaml so numeric-underscore chip strings stay quoted for PyYAML
    // (session YAMLs are loaded by the Python shims too).
    const dump = dumpYaml(foundData, {
      sortKeys: false,
      lineWidth: 200,
    });
    await fs.writeFile(path.join(sessionsDir, foundFile), dump, "utf-8");
  } catch (err) {
    return {
      ok: false,
      error: `Write failed: ${(err as Error).message}`,
    };
  }

  revalidatePath(`/clients-v2/${input.client_id}/sessions`);
  revalidatePath(`/clients-v2/${input.client_id}/timeline`);
  revalidatePath(`/clients-v2/${input.client_id}/analyse`);
  revalidatePath(`/clients-v2/${input.client_id}`);

  return { ok: true };
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

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue Protocols as picker entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight shape for picker entries derived from catalogue Protocol
 * entities (fm-database/data/protocols/*.yaml). Distinct from the
 * hardcoded PROTOCOL_TEMPLATES (UI starter packs) and from
 * CustomTemplate (coach-saved presets from past published plans).
 *
 * When selected, the assess flow sets `protocol_template_id` to
 * `catalogue:<slug>` and generate-draft.py adds the slug to
 * plan.attached_protocols. The catalogue-merge pass that runs after
 * (added in the prior turn) then pulls supplements_typically_used,
 * foods_to_emphasise/remove, phases, cautions from the YAML into the
 * draft. So picker selection here is functionally equivalent to
 * post-synthesis radio-picking in SuggestionsView — just lets the
 * coach bias the AI synthesis from the start.
 */
export interface CataloguePickerEntry {
  /** Catalogue slug — also used as `catalogue:<slug>` id when selecting. */
  slug: string;
  display_name: string;
  /** Plain-English one-liner pulled from `summary` (first sentence). */
  description: string;
  /** Maps category → emoji for the picker tile. */
  icon: string;
  /** Catalogue category (gut_healing / elimination_diet / etc.) so picker
   *  can group by category if it wants. */
  category?: string;
  /** Coach scan info — surfaced as small caption under the tile name. */
  typical_duration_weeks?: number;
  /** Picker pre-bias signals: when the AI is suggesting which protocol
   *  applies to a given symptom/condition cluster, having these visible
   *  on the tile helps coach pick when she opens the picker manually. */
  indications?: string[];
}

const CATEGORY_ICONS: Record<string, string> = {
  gut_healing: "🌿",
  elimination_diet: "🥗",
  hormone_balance: "🌸",
  metabolic_reset: "🔥",
  adrenal_recovery: "🌙",
  detox_liver_support: "🧬",
  anti_inflammatory: "❄️",
  mitochondrial_support: "⚡",
  thyroid_optimization: "🦋",
  blood_sugar_regulation: "📊",
};

/**
 * Load every catalogue Protocol entity, shaped for the assess-page
 * template picker. Synchronous from disk — protocols dir is small
 * (≤20 entities) and cached at the YAML layer by Next dev server.
 */
export async function loadCatalogueProtocolsAction(): Promise<CataloguePickerEntry[]> {
  const protoDir = path.join(getCataloguePath(), "protocols");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(protoDir);
  } catch {
    return [];
  }
  const out: CataloguePickerEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(protoDir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown> | null;
      if (!data?.slug || !data?.display_name) continue;
      const summaryStr =
        typeof data.summary === "string" ? data.summary.trim() : "";
      // First sentence — clean tile caption. Multi-line summaries in
      // 5R / AIP YAMLs use "|" so they end up as one trimmed string.
      const firstSentence = summaryStr
        .split(/\.[\s\n]/)[0]
        .replace(/\s+/g, " ")
        .trim();
      const category =
        typeof data.category === "string" ? data.category : undefined;
      out.push({
        slug: data.slug as string,
        display_name: data.display_name as string,
        description:
          firstSentence.length > 220
            ? firstSentence.slice(0, 218) + "…"
            : firstSentence || (data.display_name as string),
        icon: (category && CATEGORY_ICONS[category]) ?? "🏥",
        category,
        typical_duration_weeks:
          typeof data.typical_duration_weeks === "number"
            ? data.typical_duration_weeks
            : undefined,
        indications: Array.isArray(data.indications)
          ? (data.indications as unknown[])
              .filter((x): x is string => typeof x === "string")
              .slice(0, 6)
          : undefined,
      });
    } catch {
      // skip malformed YAMLs
    }
  }
  out.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return out;
}

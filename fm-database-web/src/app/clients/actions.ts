"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { loadAllClients, loadPlanBySlug } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";

const execFileP = promisify(execFile);

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

/**
 * Correct stdin-piping helper. Node's execFile doesn't actually use the
 * `input` option — you must write to child.stdin explicitly. Matches the
 * pattern in lib/fmdb/anthropic.ts:runShim.
 */
async function runScript(
  scriptName: string,
  payload: unknown,
  timeoutMs = 90_000
): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const child = execFile(PYTHON, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    cwd: FMDB_REPO,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    throw new Error(`Script produced no output. stderr: ${stderr.slice(0, 600)}`);
  }
  return JSON.parse(stdout);
}

export type CreateClientInput = {
  // client_id is auto-generated; not collected from the form
  display_name?: string;
  intake_date: string;       // YYYY-MM-DD
  date_of_birth: string;     // YYYY-MM-DD — system calculates age from this
  sex: "F" | "M" | "other";
  mobile_number: string;     // required — used for duplicate detection
  email?: string;
  conditions?: string[];     // free-text
  medications?: string[];
  allergies?: string[];
  goals?: string[];
  notes?: string;
  family_history?: string;   // hereditary diseases / family health history

  // Location / CRM
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;

  // Diet & lifestyle
  dietary_preference?: string;
  foods_to_avoid?: string;
  non_negotiables?: string;

  // FM Intake — deep clinical questions
  digestion_notes?: string;
  sleep_notes?: string;
  energy_pattern?: string;
  menstrual_notes?: string;   // only sent for female clients
  stress_response?: string;
  childhood_history?: string;
  toxic_exposures?: string;
  what_has_worked?: string;
  what_hasnt_worked?: string;

  // Five Pillars baseline
  five_pillars?: {
    sleep_hours?: number;
    sleep_quality?: number;      // 1-5
    sleep_issues?: string;
    stress_level?: number;       // 1-5
    stress_type?: string;
    movement_days_per_week?: number;
    movement_type?: string;
    movement_intensity?: string;
    nutrition_quality?: number;  // 1-5
    connection_quality?: number; // 1-5
    connection_notes?: string;
    notes?: string;
  };

  // Health timeline events
  timeline_events?: Array<{
    year?: number;
    date?: string;
    event: string;
    category?: string;
  }>;
};

export type CreateClientResult =
  | { ok: true; client_id: string }
  | { ok: false; error: string };

/** Normalise a phone number for comparison: strip spaces, dashes, parens, leading zeros */
function normaliseMobile(n: string): string {
  return n.replace(/[\s\-().+]/g, "").replace(/^0+/, "");
}

/** Auto-generate the next client ID by scanning existing cl-NNN dirs. */
async function nextClientId(): Promise<string> {
  const root = getPlansRoot();
  const clientsDir = path.join(root, "clients");
  let maxN = 0;
  try {
    const entries = await fs.readdir(clientsDir);
    for (const entry of entries) {
      const m = entry.match(/^cl-(\d+)$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
  } catch {
    // directory doesn't exist yet — start from 0
  }
  return `cl-${String(maxN + 1).padStart(3, "0")}`;
}

/**
 * Create a new client by shelling out to `fmdb client-new`.
 * Auto-generates a client ID and checks for duplicate mobile number.
 */
export async function createClient(
  input: CreateClientInput
): Promise<CreateClientResult> {
  if (!input.intake_date || !input.date_of_birth || !input.sex) {
    return { ok: false, error: "intake_date, date_of_birth, sex are required" };
  }
  if (!input.mobile_number?.trim()) {
    return { ok: false, error: "mobile_number is required" };
  }

  // Duplicate mobile check
  const norm = normaliseMobile(input.mobile_number.trim());
  if (norm.length >= 7) {
    const existing = await loadAllClients();
    const dupe = existing.find((c) => {
      const cm = (c as { mobile_number?: string }).mobile_number;
      return cm && normaliseMobile(cm) === norm;
    });
    if (dupe) {
      return {
        ok: false,
        error: `A client with this mobile number already exists: ${dupe.client_id}${
          (dupe as { display_name?: string }).display_name
            ? ` (${(dupe as { display_name?: string }).display_name})`
            : ""
        }. Check if this is the same person before creating a new record.`,
      };
    }
  }

  const clientId = await nextClientId();

  const args: string[] = [
    "-m",
    "fmdb.cli",
    "client-new",
    clientId,
    "--intake-date",
    input.intake_date,
    "--dob",
    input.date_of_birth,
    "--sex",
    input.sex,
    "--mobile",
    input.mobile_number.trim(),
  ];
  if (input.display_name) args.push("--display-name", input.display_name);
  for (const c of input.conditions ?? []) args.push("--condition", c);
  for (const m of input.medications ?? []) args.push("--medication", m);
  for (const a of input.allergies ?? []) args.push("--allergy", a);
  for (const g of input.goals ?? []) args.push("--goal", g);
  if (input.notes) args.push("--notes", input.notes);

  try {
    await execFileP(PYTHON, args, {
      cwd: FMDB_REPO,
      timeout: 15000,
    });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message?: string };
    const stderr =
      typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "";
    return { ok: false, error: stderr.trim() || e.message || "client-new failed" };
  }

  // Patch extra fields directly into the YAML using yaml.load/dump.
  // The Python client-new CLI doesn't accept these flags, so we write them
  // directly after creation. Handles scalars, objects (five_pillars), and
  // arrays (timeline_events) correctly.
  {
    const extraFields: Record<string, unknown> = {};
    const str = (v?: string) => v?.trim() || undefined;

    if (str(input.email))              extraFields.email              = input.email!.trim();
    if (str(input.family_history))     extraFields.family_history     = input.family_history!.trim();
    if (str(input.dietary_preference)) extraFields.dietary_preference = input.dietary_preference!.trim();
    if (str(input.foods_to_avoid))     extraFields.foods_to_avoid     = input.foods_to_avoid!.trim();
    if (str(input.non_negotiables))    extraFields.non_negotiables    = input.non_negotiables!.trim();

    // Location / CRM
    if (str(input.address_line1))      extraFields.address_line1      = input.address_line1!.trim();
    if (str(input.address_line2))      extraFields.address_line2      = input.address_line2!.trim();
    if (str(input.city))               extraFields.city               = input.city!.trim();
    if (str(input.state))              extraFields.state              = input.state!.trim();
    if (str(input.pincode))            extraFields.pincode            = input.pincode!.trim();
    if (str(input.country))            extraFields.country            = input.country!.trim();

    // FM Intake
    if (str(input.digestion_notes))    extraFields.digestion_notes    = input.digestion_notes!.trim();
    if (str(input.sleep_notes))        extraFields.sleep_notes        = input.sleep_notes!.trim();
    if (str(input.energy_pattern))     extraFields.energy_pattern     = input.energy_pattern!.trim();
    if (str(input.menstrual_notes))    extraFields.menstrual_notes    = input.menstrual_notes!.trim();
    if (str(input.stress_response))    extraFields.stress_response    = input.stress_response!.trim();
    if (str(input.childhood_history))  extraFields.childhood_history  = input.childhood_history!.trim();
    if (str(input.toxic_exposures))    extraFields.toxic_exposures    = input.toxic_exposures!.trim();
    if (str(input.what_has_worked))    extraFields.what_has_worked    = input.what_has_worked!.trim();
    if (str(input.what_hasnt_worked))  extraFields.what_hasnt_worked  = input.what_hasnt_worked!.trim();

    // Five Pillars (object — only write if any value is set)
    if (input.five_pillars && Object.values(input.five_pillars).some((v) => v !== undefined && v !== null && v !== "" && v !== 0)) {
      extraFields.five_pillars = input.five_pillars;
    }

    // Health timeline events (array)
    if (input.timeline_events && input.timeline_events.length > 0) {
      extraFields.timeline_events = input.timeline_events;
    }

    if (Object.keys(extraFields).length > 0) {
      try {
        const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
        const yaml = await import("js-yaml");
        const raw = await fs.readFile(clientYaml, "utf8");
        const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
        Object.assign(data, extraFields);
        await fs.writeFile(clientYaml, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");
      } catch {
        // non-fatal — fields missing is OK
      }
    }
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, client_id: clientId };
}

// ── Apply transcript-extracted data to an existing client ─────────────────

export interface UpdateClientFromTranscriptResult {
  ok: boolean;
  updated_fields?: string[];
  error?: string;
}

/**
 * Merge parsed transcript data into an existing client's YAML.
 * Only writes fields that are non-null/non-empty in the parsed data.
 * Arrays are replaced (not merged) so the coach sees what the transcript said.
 */
export async function updateClientFromTranscriptAction(
  clientId: string,
  data: ParsedClientData
): Promise<UpdateClientFromTranscriptResult> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const rec = (yaml.load(raw) as Record<string, unknown>) ?? {};

    const updated: string[] = [];
    const set = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== "") {
        rec[key] = value;
        updated.push(key);
      }
    };

    // Basic
    if (data.display_name) set("display_name", data.display_name);
    if (data.email) set("email", data.email);
    if (data.date_of_birth) set("date_of_birth", data.date_of_birth);
    if (data.mobile_number) set("mobile_number", data.mobile_number);
    if (data.city) set("city", data.city);
    if (data.state) set("state", data.state);
    if (data.country) set("country", data.country);

    // Clinical lists — only update if non-empty
    if (data.active_conditions.length > 0) set("active_conditions", data.active_conditions);
    if (data.current_medications.length > 0) {
      // Respect existing key name
      const key = "current_medications" in rec ? "current_medications" : "medications";
      set(key, data.current_medications);
    }
    if (data.known_allergies.length > 0) {
      const key = "known_allergies" in rec ? "known_allergies" : "allergies";
      set(key, data.known_allergies);
    }
    if (data.goals.length > 0) set("goals", data.goals);

    // Diet & lifestyle
    if (data.dietary_preference) set("dietary_preference", data.dietary_preference);
    if (data.foods_to_avoid) set("foods_to_avoid", data.foods_to_avoid);
    if (data.non_negotiables) set("non_negotiables", data.non_negotiables);
    if (data.reported_triggers) set("reported_triggers", data.reported_triggers);
    if (data.family_history) set("family_history", data.family_history);

    // FM intake
    if (data.digestion_notes) set("digestion_notes", data.digestion_notes);
    if (data.sleep_notes) set("sleep_notes", data.sleep_notes);
    if (data.energy_pattern) set("energy_pattern", data.energy_pattern);
    if (data.menstrual_notes) set("menstrual_notes", data.menstrual_notes);
    if (data.stress_response) set("stress_response", data.stress_response);
    if (data.childhood_history) set("childhood_history", data.childhood_history);
    if (data.toxic_exposures) set("toxic_exposures", data.toxic_exposures);
    if (data.what_has_worked) set("what_has_worked", data.what_has_worked);
    if (data.what_hasnt_worked) set("what_hasnt_worked", data.what_hasnt_worked);

    // Five pillars (merge with existing)
    if (data.five_pillars && Object.values(data.five_pillars).some((v) => v !== null && v !== undefined)) {
      const existing = (rec.five_pillars as Record<string, unknown>) ?? {};
      rec.five_pillars = { ...existing, ...data.five_pillars };
      updated.push("five_pillars");
    }

    // Timeline events (append new ones, dedup by event text)
    if (data.timeline_events && data.timeline_events.length > 0) {
      const existing = (rec.timeline_events as Array<{ event: string }>) ?? [];
      const existingTexts = new Set(existing.map((e) => e.event.toLowerCase()));
      const toAdd = data.timeline_events.filter((e) => !existingTexts.has(e.event.toLowerCase()));
      if (toAdd.length > 0) {
        rec.timeline_events = [...existing, ...toAdd];
        updated.push("timeline_events");
      }
    }

    // Notes — append rather than overwrite
    if (data.notes) {
      const existing = (rec.notes as string | undefined) ?? "";
      const tag = `\n\n[From transcript] ${data.notes}`;
      rec.notes = existing ? existing + tag : data.notes;
      updated.push("notes");
    }

    rec.updated_at = new Date().toISOString();

    await fs.writeFile(clientYaml, yaml.dump(rec, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, updated_fields: updated };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update client" };
  }
}

// ── Delete client ──────────────────────────────────────────────────────────

export type DeleteClientResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Permanently delete a client directory and all their sessions/files.
 * No plan-safety check — intended for test cleanup. Re-enable check later.
 */
export async function deleteClient(
  clientId: string
): Promise<DeleteClientResult> {
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) {
    return { ok: false, error: "Invalid client id" };
  }

  const root = getPlansRoot();
  const clientDir = path.join(root, "clients", clientId);

  try {
    await fs.rm(clientDir, { recursive: true, force: true });
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to delete client directory" };
  }

  revalidatePath("/clients");
  return { ok: true };
}

// ── Transcript parsing for client intake ──────────────────────────────────

export type ParsedClientData = {
  // Basic
  display_name?: string;
  email?: string;
  date_of_birth?: string;         // YYYY-MM-DD
  estimated_age?: number;         // if DOB not found
  sex?: "F" | "M" | "other";
  mobile_number?: string;
  city?: string;
  state?: string;
  country?: string;
  // Clinical
  active_conditions: string[];
  current_medications: string[];
  known_allergies: string[];
  goals: string[];
  key_symptoms: string[];
  // Diet & lifestyle
  dietary_preference?: string;
  foods_to_avoid?: string;
  non_negotiables?: string;
  reported_triggers?: string;
  family_history?: string;
  // FM intake
  digestion_notes?: string;
  sleep_notes?: string;
  energy_pattern?: string;
  menstrual_notes?: string;
  stress_response?: string;
  childhood_history?: string;
  toxic_exposures?: string;
  what_has_worked?: string;
  what_hasnt_worked?: string;
  // Five pillars
  five_pillars?: {
    sleep_hours?: number;
    sleep_quality?: number;        // 1-5
    sleep_issues?: string;
    stress_level?: number;         // 1-5
    stress_type?: string;
    movement_days_per_week?: number;
    movement_type?: string;
    movement_intensity?: string;
    nutrition_quality?: number;    // 1-5
    connection_quality?: number;   // 1-5
    connection_notes?: string;
  };
  // Timeline
  timeline_events?: Array<{
    year?: number;
    date?: string;
    event: string;
    category?: string;
  }>;
  // Meta
  notes: string;
  intake_date?: string;
  fields_found: number;
};

export type ParseTranscriptResult =
  | { ok: true; data: ParsedClientData }
  | { ok: false; error: string };

/**
 * Parse a consultation transcript (file upload OR URL) and extract client intake data.
 * The form uses the result to pre-populate fields; the coach fills any gaps.
 */
export async function parseTranscriptForClient(
  formData: FormData
): Promise<ParseTranscriptResult> {
  const url = formData.get("url") as string | null;
  const file = formData.get("file") as File | null;

  if (!url?.trim() && !file) {
    return { ok: false, error: "Provide a file or a URL" };
  }

  let transcript_path: string | null = null;
  let mime_type = "text/plain";
  let tmp_path: string | null = null;

  if (file && file.size > 0) {
    // Save upload to a temp file
    const os = await import("node:os");
    const ext = file.name.endsWith(".pdf") ? ".pdf" : ".txt";
    mime_type = ext === ".pdf" ? "application/pdf" : "text/plain";
    tmp_path = path.join(os.tmpdir(), `fmdb-intake-${Date.now()}${ext}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tmp_path, buf);
    transcript_path = tmp_path;
  }

  const payload = JSON.stringify({
    transcript_path: transcript_path ?? undefined,
    transcript_url: url?.trim() || undefined,
    mime_type,
    dry_run: false,
  });

  try {
    const result = await runScript(
      "extract-client-from-transcript.py",
      {
        transcript_path: transcript_path ?? undefined,
        transcript_url: url?.trim() || undefined,
        mime_type,
        dry_run: false,
      },
      90_000
    ) as { ok: boolean; error?: string; [key: string]: unknown };

    if (tmp_path) await fs.unlink(tmp_path).catch(() => {});

    if (!result.ok) {
      return { ok: false, error: result.error ?? "Script failed" };
    }
    const { ok: _ok, error: _err, ...data } = result;
    return { ok: true, data: data as ParsedClientData };
  } catch (err) {
    if (tmp_path) await fs.unlink(tmp_path).catch(() => {});
    const e = err as { message?: string };
    return { ok: false, error: e.message || "Script failed" };
  }
}

// ---------------------------------------------------------------------------
// Generate a trusted educational topic brief for a client
// ---------------------------------------------------------------------------

export interface TopicBriefResult {
  ok: boolean;
  markdown?: string | null;
  html?: string | null;
  error?: string | null;
}

export async function generateTopicBrief(
  clientId: string,
  topicSlug: string
): Promise<TopicBriefResult> {
  try {
    const result = await runScript(
      "render-topic-brief.py",
      { client_id: clientId, topic_slug: topicSlug },
      180_000   // Claude Sonnet can take 60–120s for a 1000-word doc
    ) as TopicBriefResult;
    return result;
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Script failed" };
  }
}

// ---------------------------------------------------------------------------
// Update dietary preferences for an existing client
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Update clinical profile (medications, conditions, history, allergies, goals)
// ---------------------------------------------------------------------------

export interface UpdateClientProfileInput {
  client_id: string;
  active_conditions?: string[];
  medications?: string[];
  medical_history?: string[];
  allergies?: string[];
  goals?: string[];
  notes?: string;
}

export type UpdateClientProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientProfile(
  input: UpdateClientProfileInput
): Promise<UpdateClientProfileResult> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "client.yaml"
  );
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = yaml.load(raw) as Record<string, unknown>;

    if (input.active_conditions !== undefined)
      data.active_conditions = input.active_conditions;
    // write to whichever key already exists for medications
    if (input.medications !== undefined) {
      if ("current_medications" in data) {
        data.current_medications = input.medications;
      } else {
        data.medications = input.medications;
      }
    }
    if (input.medical_history !== undefined)
      data.medical_history = input.medical_history;
    if (input.allergies !== undefined) {
      if ("known_allergies" in data) {
        data.known_allergies = input.allergies;
      } else {
        data.allergies = input.allergies;
      }
    }
    if (input.goals !== undefined) data.goals = input.goals;
    if (input.notes !== undefined) data.notes = input.notes;

    data.updated_at = new Date().toISOString();

    await fs.writeFile(
      clientYaml,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    revalidatePath(`/clients/${input.client_id}`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update client profile" };
  }
}

// ---------------------------------------------------------------------------

export interface UpdatePreferencesInput {
  client_id: string;
  dietary_preference?: string;
  foods_to_avoid?: string;
  reported_triggers?: string;
  non_negotiables?: string;
  city?: string;
  country?: string;
}

export type UpdatePreferencesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientPreferences(
  input: UpdatePreferencesInput
): Promise<UpdatePreferencesResult> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "client.yaml"
  );

  try {
    // Load YAML, patch fields, write back
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = yaml.load(raw) as Record<string, unknown>;

    if (input.dietary_preference !== undefined)
      data.dietary_preference = input.dietary_preference;
    if (input.foods_to_avoid !== undefined)
      data.foods_to_avoid = input.foods_to_avoid;
    if (input.reported_triggers !== undefined)
      data.reported_triggers = input.reported_triggers;
    if (input.non_negotiables !== undefined)
      data.non_negotiables = input.non_negotiables;
    if (input.city !== undefined)
      data.city = input.city;
    if (input.country !== undefined)
      data.country = input.country;

    // bump updated_at
    data.updated_at = new Date().toISOString();

    await fs.writeFile(
      clientYaml,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    revalidatePath(`/clients/${input.client_id}`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update client" };
  }
}

// ── External reports ──────────────────────────────────────────────────────────

export interface ExternalReport {
  id: string;
  type: string;
  display_type: string;
  file_name: string;
  file_path: string;           // absolute path on disk
  date_uploaded: string;       // ISO
  date_of_report?: string;     // ISO — from report or manually entered
  lab_name?: string;
  key_findings: string[];
  summary: string;
  extracted: Record<string, unknown>;
}

export interface UploadReportInput {
  clientId: string;
  reportType: string;
  fileDataBase64: string;
  fileName: string;
  dateOfReport?: string;       // optional manual override
}

export interface UploadReportResult {
  ok: boolean;
  report?: ExternalReport;
  error?: string;
}

export async function uploadReportAction(input: UploadReportInput): Promise<UploadReportResult> {
  try {
    const yaml = await import("js-yaml");
    const plansRoot = getPlansRoot();
    const clientDir = path.join(plansRoot, "clients", input.clientId);
    const reportsDir = path.join(clientDir, "reports");
    await fs.mkdir(reportsDir, { recursive: true });

    // Save file to disk
    const ext = path.extname(input.fileName) || ".pdf";
    const datestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const diskName = `${datestamp}-${input.reportType}-${safeName}`;
    const filePath = path.join(reportsDir, diskName);

    const buf = Buffer.from(input.fileDataBase64, "base64");
    await fs.writeFile(filePath, buf);

    // Call extraction shim
    let extracted: Record<string, unknown> = {};
    let key_findings: string[] = [];
    let summary = "";
    let date_of_report: string | undefined = input.dateOfReport;
    let lab_name: string | undefined;

    try {
      const shimResult = await runScript("extract-report.py", {
        file_path: filePath,
        report_type: input.reportType,
        file_name: input.fileName,
        client_id: input.clientId,
      }, 120_000) as Record<string, unknown>;

      if (shimResult.ok) {
        extracted = (shimResult.extracted as Record<string, unknown>) ?? {};
        key_findings = (shimResult.key_findings as string[]) ?? [];
        summary = (shimResult.summary as string) ?? "";
        if (!date_of_report) date_of_report = shimResult.date_of_report as string | undefined;
        lab_name = shimResult.lab_name as string | undefined;
      } else {
        // Extraction failed but file is saved — store with empty extracted data
        summary = `Extraction failed: ${shimResult.error ?? "unknown error"}`;
      }
    } catch (err) {
      summary = `Extraction error: ${String(err)}`;
    }

    // Build report object
    const DISPLAY_NAMES: Record<string, string> = {
      gi_stool_test: "GI Stool Analysis",
      dutch_test: "DUTCH Hormone Panel",
      dexa_scan: "DEXA Scan",
      genetic_test: "Genetic / Nutrigenomic Test",
      food_sensitivity: "Food Sensitivity Panel",
      organic_acids: "Organic Acids Test (OAT)",
      imaging: "Imaging / Radiology Report",
      other: "Other Report",
    };

    const reportId = `${Date.now()}-${input.reportType}`;
    const report: ExternalReport = {
      id: reportId,
      type: input.reportType,
      display_type: DISPLAY_NAMES[input.reportType] ?? input.reportType,
      file_name: input.fileName,
      file_path: filePath,
      date_uploaded: new Date().toISOString().slice(0, 10),
      date_of_report,
      lab_name: lab_name || undefined,
      key_findings,
      summary,
      extracted,
    };

    // Append to client.yaml
    const clientYaml = path.join(clientDir, "client.yaml");
    let data: Record<string, unknown> = {};
    try {
      const rawYaml = await fs.readFile(clientYaml, "utf8");
      data = (yaml.load(rawYaml) as Record<string, unknown>) ?? {};
    } catch { /* new client or missing yaml */ }

    const existing = (data.external_reports as ExternalReport[]) ?? [];
    data.external_reports = [...existing, report];
    await fs.writeFile(
      clientYaml,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getClientReportsAction(clientId: string): Promise<ExternalReport[]> {
  try {
    const yaml = await import("js-yaml");
    const plansRoot = getPlansRoot();
    const clientYaml = path.join(plansRoot, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    return (data.external_reports as ExternalReport[]) ?? [];
  } catch {
    return [];
  }
}

// ── Add a measurement entry to measurements_log ────────────────────────────

export interface AddMeasurementInput {
  client_id: string;
  date: string;                     // YYYY-MM-DD
  weight_kg?: number;
  waist_cm?: number;
  hip_cm?: number;
  height_cm?: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  resting_heart_rate?: number;
  notes?: string;
}

export type AddMeasurementResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Appends (or updates same-date entry) to the client's measurements_log
 * time-series array. Sorts descending by date.
 */
export async function addMeasurementAction(
  input: AddMeasurementInput
): Promise<AddMeasurementResult> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "client.yaml"
  );
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};

    // Build entry with only the non-undefined fields
    const entry: Record<string, unknown> = { date: input.date };
    if (input.weight_kg !== undefined)              entry.weight_kg              = input.weight_kg;
    if (input.waist_cm !== undefined)               entry.waist_cm               = input.waist_cm;
    if (input.hip_cm !== undefined)                 entry.hip_cm                 = input.hip_cm;
    if (input.height_cm !== undefined)              entry.height_cm              = input.height_cm;
    if (input.blood_pressure_systolic !== undefined) entry.blood_pressure_systolic = input.blood_pressure_systolic;
    if (input.blood_pressure_diastolic !== undefined) entry.blood_pressure_diastolic = input.blood_pressure_diastolic;
    if (input.resting_heart_rate !== undefined)     entry.resting_heart_rate     = input.resting_heart_rate;
    if (input.notes?.trim())                        entry.notes                  = input.notes.trim();

    const log = (data.measurements_log as Record<string, unknown>[]) ?? [];
    const idx = log.findIndex((e) => e.date === input.date);
    if (idx >= 0) {
      log[idx] = { ...log[idx], ...entry };   // merge into existing same-date row
    } else {
      log.push(entry);
    }
    // Sort newest first
    log.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    data.measurements_log = log;
    data.updated_at = new Date().toISOString();

    await fs.writeFile(clientYaml, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients/${input.client_id}`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to add measurement" };
  }
}

export async function deleteReportAction(clientId: string, reportId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const yaml = await import("js-yaml");
    const plansRoot = getPlansRoot();
    const clientDir = path.join(plansRoot, "clients", clientId);
    const clientYaml = path.join(clientDir, "client.yaml");

    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const reports = (data.external_reports as ExternalReport[]) ?? [];

    const toDelete = reports.find((r) => r.id === reportId);
    if (toDelete?.file_path) {
      try { await fs.unlink(toDelete.file_path); } catch { /* already gone */ }
    }

    data.external_reports = reports.filter((r) => r.id !== reportId);
    await fs.writeFile(clientYaml, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");

    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Parse client message (WhatsApp / AiSensy) ────────────────────────────────

export interface ParsedClientMessage {
  symptoms_improved: string[];
  symptoms_persisting: string[];
  symptoms_new: string[];
  adherence_notes: string | null;
  questions: string[];
  mood_note: string | null;
  protocol_flag: string | null;
  quick_note_text: string;
}

export interface ParseClientMessageResult {
  ok: boolean;
  data?: ParsedClientMessage;
  error?: string | null;
}

export async function parseClientMessageAction(
  messageText: string,
  clientId: string,
  dryRun = false
): Promise<ParseClientMessageResult> {
  try {
    const raw = await runScript("parse-client-message.py", {
      client_id: clientId,
      message_text: messageText,
      dry_run: dryRun,
    }, 30_000);
    const result = raw as ParsedClientMessage & { ok: boolean; error?: string };
    if (!result.ok) return { ok: false, error: result.error ?? "Parse failed" };
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 400) };
  }
}

// ── Plan items for structured protocol check-in ───────────────────────────────

export interface PlanSupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  coach_rationale?: string;
}

export interface PlanPracticeItem {
  name: string;
  cadence: string;
  details?: string;
}

export interface LoadPlanItemsResult {
  ok: boolean;
  supplements?: PlanSupplementItem[];
  practices?: PlanPracticeItem[];
  error?: string;
}

export async function loadActivePlanItemsAction(planSlug: string): Promise<LoadPlanItemsResult> {
  try {
    const plan = await loadPlanBySlug(planSlug);
    if (!plan) return { ok: false, error: "Plan not found" };
    return {
      ok: true,
      supplements: (plan.supplement_protocol ?? []) as PlanSupplementItem[],
      practices: (plan.lifestyle_practices ?? []) as PlanPracticeItem[],
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

// ── AiSensy webhook — match phone to client ───────────────────────────────────

export interface WebhookClientMatch {
  ok: boolean;
  client_id?: string;
  display_name?: string;
  error?: string;
}

export async function findClientByPhoneAction(phone: string): Promise<WebhookClientMatch> {
  try {
    const clients = await loadAllClients();
    const normalise = (p: string) => p.replace(/\D/g, "").slice(-10);
    const needle = normalise(phone);
    const match = clients.find((c) => {
      const raw = (c as Record<string, unknown>).mobile_number as string | undefined;
      return raw && normalise(raw) === needle;
    });
    if (!match) return { ok: false, error: `No client with phone ${phone}` };
    const id = (match as Record<string, unknown>).client_id as string ?? "";
    const name = (match as Record<string, unknown>).display_name as string | undefined;
    return { ok: true, client_id: id, display_name: name };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

// ── Upload client photo ───────────────────────────────────────────────────────

export interface UploadPhotoResult {
  ok: boolean;
  ext?: string;
  error?: string;
}

/**
 * Save a photo to ~/fm-plans/clients/{id}/photo.{ext}.
 * Overwrites any existing photo for this client.
 */
export async function uploadClientPhotoAction(
  clientId: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<UploadPhotoResult> {
  if (!clientId || !/^[\w-]+$/.test(clientId)) {
    return { ok: false, error: "Invalid client ID" };
  }
  if (!bytes.length) return { ok: false, error: "No file data" };

  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg":  "jpg",
    "image/png":  "png",
    "image/webp": "webp",
    "image/gif":  "gif",
  };
  const ext = extMap[mimeType.toLowerCase()] ?? "jpg";

  const dir = path.join(getPlansRoot(), "clients", clientId);
  const dest = path.join(dir, `photo.${ext}`);

  // Remove any existing photo files with other extensions
  const otherExts = ["jpg", "jpeg", "png", "webp"].filter((e) => e !== ext);
  for (const e of otherExts) {
    try { await fs.unlink(path.join(dir, `photo.${e}`)); } catch { /* ignore */ }
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(dest, Buffer.from(bytes));
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, ext };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

// ── Draft WhatsApp follow-up message after a session ─────────────────────────

export interface DraftFollowUpResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function draftFollowUpMessageAction(
  clientId: string,
  sessionId: string,
  sessionType: string,
  dryRun = false,
): Promise<DraftFollowUpResult> {
  const scriptPath = path.join(SCRIPTS_DIR, "draft-followup-message.py");
  const payload = { client_id: clientId, session_id: sessionId, session_type: sessionType, dry_run: dryRun };

  const child = execFile(PYTHON, [scriptPath], {
    timeout: 30_000,
    maxBuffer: 1 * 1024 * 1024,
    cwd: FMDB_REPO,
  });

  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    return { ok: false, error: `draft-followup-message.py produced no output. stderr: ${stderr.slice(0, 300)}` };
  }

  try {
    return JSON.parse(stdout) as DraftFollowUpResult;
  } catch {
    return { ok: false, error: `Invalid JSON from draft-followup-message.py: ${stdout.slice(0, 200)}` };
  }
}

"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { loadAllClients, loadPlanBySlug } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { validateMeasurement } from "@/lib/fmdb/measurements";

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

export interface BackOnTrackCard {
  title: string;
  intro: string;
  steps: string[];
}

/**
 * Generate (or preview) the back-on-track flare-reset card for a client from
 * their latest published plan. Deterministic — no API. dryRun=true returns the
 * draft without writing; otherwise it writes client.yaml#back_on_track_plan
 * (rendered in the client app's library floor + maintenance). The coach can edit
 * it afterwards via the normal client fields.
 */
export async function generateBackOnTrackAction(
  clientId: string,
  dryRun = false,
): Promise<{ ok: boolean; card: BackOnTrackCard | null; error?: string }> {
  if (!clientId) return { ok: false, card: null, error: "clientId required" };
  try {
    const res = (await runScript("generate-back-on-track.py", {
      client_id: clientId,
      dry_run: dryRun,
    })) as { ok: boolean; card: BackOnTrackCard | null; error?: string | null };
    if (res.ok && !dryRun) revalidatePath(`/clients-v2/${clientId}`);
    return { ok: res.ok, card: res.card, error: res.error ?? undefined };
  } catch (e) {
    return { ok: false, card: null, error: e instanceof Error ? e.message : "generation failed" };
  }
}

export interface MonthlyCard {
  month: string; // YYYY-MM
  title: string;
  dos: string[];
  donts: string[];
}

/**
 * Generate (or preview) the maintenance tier's monthly do's & don'ts card for a
 * client — the one living thing in maintenance. Deterministic seasonal +
 * condition template (no API). dryRun=true previews; otherwise it writes the
 * card onto the client's latest published plan at monthly_cards[month], which the
 * app's maintenance home reads. Idempotent per month — regenerating overwrites.
 */
export async function generateMonthlyCardAction(
  clientId: string,
  month?: string,
  dryRun = false,
): Promise<{ ok: boolean; card: MonthlyCard | null; error?: string }> {
  if (!clientId) return { ok: false, card: null, error: "clientId required" };
  try {
    const res = (await runScript("generate-monthly-card.py", {
      client_id: clientId,
      ...(month ? { month } : {}),
      dry_run: dryRun,
    })) as { ok: boolean; card: MonthlyCard | null; error?: string | null };
    if (res.ok && !dryRun) revalidatePath(`/clients-v2/${clientId}`);
    return { ok: res.ok, card: res.card, error: res.error ?? undefined };
  } catch (e) {
    return { ok: false, card: null, error: e instanceof Error ? e.message : "generation failed" };
  }
}

export type CreateClientInput = {
  // client_id is auto-generated; not collected from the form
  display_name?: string;
  intake_date: string;       // YYYY-MM-DD
  date_of_birth?: string;    // YYYY-MM-DD — optional here; client fills via intake form
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
  /** Meal plan letter shape preference. Read by render-client-letter.py
   *  to branch between 7-day tables (detailed), categories + principles
   *  (principles), or principles-then-sample-week (hybrid, default). */
  meal_plan_style?: "detailed" | "principles" | "hybrid";

  // FM Intake — deep clinical questions
  digestion_notes?: string;
  sleep_notes?: string;
  energy_pattern?: string;
  menstrual_notes?: string;   // only sent for female clients

  // Cycle sync (women clients) — drives phase-synced nutrition/movement.
  cycle_status?: "menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable";
  last_menstrual_period?: string;     // ISO YYYY-MM-DD
  cycle_length_days?: number;          // default 28 if unset
  cycle_regularity?: "regular" | "irregular" | "very_irregular";
  menopause_started?: string;          // ISO YYYY-MM-DD

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
  if (!input.intake_date || !input.sex) {
    return { ok: false, error: "intake_date and sex are required" };
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
    "--sex",
    input.sex,
    "--mobile",
    input.mobile_number.trim(),
  ];
  if (input.date_of_birth) args.push("--dob", input.date_of_birth);
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
    // Mark engagement_status=pending so the journey strip shows the
    // "Did they sign up?" step immediately after creation. Coach can
    // flip it to "signed_up" or "declined" from the overview.
    extraFields.engagement_status = "pending";
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
    // Cycle sync — write only when something is set, gated on female sex upstream
    if (input.cycle_status)              extraFields.cycle_status            = input.cycle_status;
    if (input.last_menstrual_period)     extraFields.last_menstrual_period   = input.last_menstrual_period;
    if (input.cycle_length_days != null) extraFields.cycle_length_days       = input.cycle_length_days;
    if (input.cycle_regularity)          extraFields.cycle_regularity        = input.cycle_regularity;
    if (input.menopause_started)         extraFields.menopause_started       = input.menopause_started;
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
        await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
      } catch {
        // non-fatal — fields missing is OK
      }
    }
  }

  // ── Auto-write a Discovery session ───────────────────────────────────
  // The new-client form captures the full discovery-call content:
  // chief complaints / symptoms / goals / dietary preferences / family
  // history / five pillars / timeline. Coach feedback (2026-05-13):
  // entering all of that and then seeing "Last contact: Never" + no
  // session in the Timeline feels wrong — the intake IS the discovery.
  //
  // So if the coach captured ANY of the discovery-shaped data during
  // create, we also write a session YAML at
  // clients/<id>/sessions/<sid>.yaml tagged session_type=discovery.
  // Best-effort — a failure here doesn't roll back the client itself.
  try {
    const hasDiscoveryContent =
      (input.conditions && input.conditions.length > 0) ||
      (input.goals && input.goals.length > 0) ||
      (input.medications && input.medications.length > 0) ||
      (input.allergies && input.allergies.length > 0) ||
      !!input.digestion_notes ||
      !!input.sleep_notes ||
      !!input.energy_pattern ||
      !!input.menstrual_notes ||
      !!input.stress_response ||
      !!input.childhood_history ||
      !!input.toxic_exposures ||
      !!input.what_has_worked ||
      !!input.what_hasnt_worked ||
      !!input.notes ||
      !!input.dietary_preference ||
      !!input.foods_to_avoid ||
      !!input.non_negotiables ||
      !!input.family_history ||
      (input.timeline_events && input.timeline_events.length > 0) ||
      !!input.five_pillars;

    if (hasDiscoveryContent) {
      // Compose presenting_complaints as a one-paragraph summary so the
      // Sessions/Timeline tab shows something meaningful for this entry.
      // Marks the session as discovery via the standard [session_type:]
      // tag prefix the rest of the app uses to filter sessions.
      const summaryParts: string[] = [];
      if (input.conditions && input.conditions.length > 0) {
        summaryParts.push(`Active conditions: ${input.conditions.join(", ")}`);
      }
      if (input.goals && input.goals.length > 0) {
        summaryParts.push(`Goals: ${input.goals.join("; ")}`);
      }
      if (input.notes) summaryParts.push(input.notes.trim());
      const presenting =
        "[session_type: discovery_consultation] " +
        (summaryParts.join(" · ") || "Initial intake captured via new-client form.");

      // Build a coach_notes block that mirrors what the dedicated
      // discovery form writes. Keeps Sessions tab inspector rich.
      const coachNotesLines: string[] = [];
      if (input.digestion_notes) coachNotesLines.push(`Digestion: ${input.digestion_notes}`);
      if (input.sleep_notes) coachNotesLines.push(`Sleep: ${input.sleep_notes}`);
      if (input.energy_pattern) coachNotesLines.push(`Energy: ${input.energy_pattern}`);
      if (input.menstrual_notes) coachNotesLines.push(`Menstrual: ${input.menstrual_notes}`);
      if (input.stress_response) coachNotesLines.push(`Stress response: ${input.stress_response}`);
      if (input.childhood_history) coachNotesLines.push(`Childhood: ${input.childhood_history}`);
      if (input.toxic_exposures) coachNotesLines.push(`Toxic exposures: ${input.toxic_exposures}`);
      if (input.what_has_worked) coachNotesLines.push(`What has worked: ${input.what_has_worked}`);
      if (input.what_hasnt_worked) coachNotesLines.push(`What hasn't worked: ${input.what_hasnt_worked}`);
      if (input.family_history) coachNotesLines.push(`Family history: ${input.family_history}`);
      if (input.dietary_preference) coachNotesLines.push(`Dietary preference: ${input.dietary_preference}`);
      if (input.foods_to_avoid) coachNotesLines.push(`Foods to avoid: ${input.foods_to_avoid}`);
      if (input.non_negotiables) coachNotesLines.push(`Non-negotiables: ${input.non_negotiables}`);
      if (input.notes) coachNotesLines.push(`Notes: ${input.notes}`);
      const coachNotes = coachNotesLines.join("\n");

      // Use a stable per-day session id slug so re-creating doesn't
      // collide with itself; save-session.py appends an ordinal suffix
      // if the date already has a session.
      const sessionDate = input.intake_date || new Date().toISOString().slice(0, 10);

      // Invoke save-session.py the same way saveSessionAction does — but
      // inline here so we don't pull a circular import (assess/actions.ts
      // imports nothing from clients/actions.ts but the reverse would be
      // a new edge).
      const sessionInput: Record<string, unknown> = {
        client_id: clientId,
        session_type: "discovery",
        session_date: sessionDate,
        presenting_complaints: presenting,
        coach_notes: coachNotes,
      };
      if (input.five_pillars) sessionInput.five_pillars = input.five_pillars;

      const sessionScript = path.join(SCRIPTS_DIR, "save-session.py");
      await new Promise<void>((resolve) => {
        const child = execFile(PYTHON, [sessionScript], {
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        child.stdin?.end(JSON.stringify(sessionInput));
        // Drain output so the process doesn't deadlock; we don't care
        // about the result — this is best-effort.
        child.stdout?.on("data", () => undefined);
        child.stderr?.on("data", () => undefined);
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    }
  } catch {
    // Auto-discovery is non-fatal — if save-session fails for any
    // reason (script error, race condition, file system), the client
    // still exists and the coach can re-enter the session manually.
  }

  // Revalidate BOTH v1 and v2 routes — the new-client form redirects to
  // /clients-v2/<id> by default, so v1-only revalidation was leaving the
  // v2 detail page serving a stale "client not found" 404 right after
  // creation. (Reported 2026-05-13.)
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients-v2");
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/sessions`);
  revalidatePath(`/clients-v2/${clientId}/analyse`);
  revalidatePath("/dashboard-v2");
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
    if (data.meal_plan_style) set("meal_plan_style", data.meal_plan_style);

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

    await fs.writeFile(clientYaml, dumpYaml(rec, { noRefs: true, sortKeys: false }), "utf8");
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
  meal_plan_style?: "detailed" | "principles" | "hybrid";
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
  // Presenting concern
  presenting_complaints?: string;        // chief complaints in 2-4 sentences
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

/**
 * Same extraction as parseTranscriptForClient, but accepts an already-uploaded
 * file path so the assess flow can run the symptoms extractor + the full
 * client-profile extractor in parallel without re-uploading the file.
 *
 * Caller is responsible for the file lifetime (we don't delete it here — it
 * typically lives in ~/fm-plans/clients/<id>/files/).
 */
export async function parseTranscriptForClientByPath(
  filePath: string,
  mimeType: string
): Promise<ParseTranscriptResult> {
  if (!filePath) return { ok: false, error: "filePath required" };
  try {
    const result = await runScript(
      "extract-client-from-transcript.py",
      {
        transcript_path: filePath,
        mime_type: mimeType,
        dry_run: false,
      },
      90_000
    ) as { ok: boolean; error?: string; [key: string]: unknown };

    if (!result.ok) {
      return { ok: false, error: result.error ?? "Script failed" };
    }
    const { ok: _ok, error: _err, ...data } = result;
    return { ok: true, data: data as ParsedClientData };
  } catch (err) {
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

/**
 * Engagement after the discovery call:
 *   pending  — discovery done, no decision yet (default once discovery is recorded)
 *   signed_up — client is going forward; intake can be scheduled
 *   declined — politely passed; further outreach is opt-out by default
 */
export type EngagementStatus = "pending" | "signed_up" | "declined";

export interface UpdateClientProfileInput {
  client_id: string;
  // Identity (added 2026-05-13 — coach needs to fix typos / second names
  // / wrong DOB / wrong sex without re-creating the client).
  display_name?: string;
  date_of_birth?: string;
  sex?: "F" | "M" | "other";
  mobile_number?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  // Did the client sign on after discovery? Stored as
  // `engagement_status` on client.yaml. Drives the new "Engagement" step
  // on the journey strip + the stage-banner copy on Overview.
  engagement_status?: EngagementStatus;
  // Dietary / lifestyle memory — also written by plan-chat as the AI
  // learns about the client. Exposing them here so the Memory panel
  // on Overview can let the coach edit / clear them directly.
  dietary_preference?: string;
  /** Veg-spectrum clients only — whether they accept animal-derived
   *  supplements (fish oil, gelatin, collagen). "yes"|"no"|"unsure"|"". */
  animal_derived_supplements_ok?: string;
  foods_to_avoid?: string;
  non_negotiables?: string;
  reported_triggers?: string;
  family_history?: string;
  /** Per-client meal plan letter shape. Read by render-client-letter.py
   *  phase-letter builder to choose between 7-day tables (detailed),
   *  categories + principles (principles), or hybrid. */
  meal_plan_style?: "detailed" | "principles" | "hybrid";
  // Clinical
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

    // Identity fields — apply if present, including empty-string-to-clear
    // semantics. We trim before writing so trailing whitespace from copy-
    // paste doesn't pollute the YAML.
    if (input.display_name !== undefined)
      data.display_name = input.display_name.trim() || undefined;
    if (input.date_of_birth !== undefined) {
      // Accept "" to mean "clear" but only YYYY-MM-DD otherwise.
      const v = input.date_of_birth.trim();
      data.date_of_birth = v || undefined;
    }
    if (input.sex !== undefined) data.sex = input.sex;
    if (input.mobile_number !== undefined)
      data.mobile_number = input.mobile_number.trim() || undefined;
    if (input.email !== undefined)
      data.email = input.email.trim() || undefined;
    if (input.city !== undefined) data.city = input.city.trim() || undefined;
    if (input.state !== undefined) data.state = input.state.trim() || undefined;
    if (input.country !== undefined)
      data.country = input.country.trim() || undefined;
    if (input.engagement_status !== undefined)
      data.engagement_status = input.engagement_status;
    // Dietary / lifestyle memory — accept empty string as "clear".
    if (input.dietary_preference !== undefined)
      data.dietary_preference = input.dietary_preference.trim() || undefined;
    if (input.animal_derived_supplements_ok !== undefined)
      data.animal_derived_supplements_ok =
        input.animal_derived_supplements_ok.trim().toLowerCase() || undefined;
    if (input.foods_to_avoid !== undefined)
      data.foods_to_avoid = input.foods_to_avoid.trim() || undefined;
    if (input.non_negotiables !== undefined)
      data.non_negotiables = input.non_negotiables.trim() || undefined;
    if (input.reported_triggers !== undefined)
      data.reported_triggers = input.reported_triggers.trim() || undefined;
    if (input.family_history !== undefined)
      data.family_history = input.family_history.trim() || undefined;
    if (input.meal_plan_style !== undefined) {
      // Coerce unknown values to "hybrid" (the canonical default) so a
      // bad request can't corrupt the field. Pydantic on the Python side
      // also enforces this, but defending at the write boundary too.
      const v = input.meal_plan_style;
      data.meal_plan_style =
        v === "detailed" || v === "principles" || v === "hybrid"
          ? v
          : "hybrid";
    }

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
      dumpYaml(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    // Revalidate both v1 + v2 client routes so the new name / DOB / contact
    // fields refresh in the header, journey strip, and dashboard listings.
    revalidatePath(`/clients/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}/plan`);
    revalidatePath(`/clients-v2/${input.client_id}/sessions`);
    revalidatePath(`/clients-v2/${input.client_id}/communicate`);
    revalidatePath(`/clients-v2/${input.client_id}/catalogue`);
    revalidatePath("/clients-v2");
    revalidatePath("/dashboard-v2");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update client profile" };
  }
}

// ---------------------------------------------------------------------------
// Cycle tracking — coach-owned period dates (Piece B foundation). The intake
// form seeds these once; thereafter the coach refreshes them from check-ins /
// WhatsApp / calls via the CycleTrackingPanel on the client overview.
// ---------------------------------------------------------------------------

export interface UpdateCycleTrackingInput {
  client_id: string;
  last_menstrual_period?: string | null; // YYYY-MM-DD — period start (Day 1); "" clears
  last_period_end_date?: string | null;  // YYYY-MM-DD — last day of real flow; "" clears
  cycle_length_days?: number | null;
  cycle_regularity?: string | null;
}

export type UpdateCycleTrackingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateCycleTracking(
  input: UpdateCycleTrackingInput
): Promise<UpdateCycleTrackingResult> {
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

    if (input.last_menstrual_period !== undefined)
      data.last_menstrual_period =
        (input.last_menstrual_period || "").trim() || undefined;
    if (input.last_period_end_date !== undefined)
      data.last_period_end_date =
        (input.last_period_end_date || "").trim() || undefined;
    if (input.cycle_length_days !== undefined)
      data.cycle_length_days =
        input.cycle_length_days && input.cycle_length_days > 0
          ? input.cycle_length_days
          : undefined;
    if (input.cycle_regularity !== undefined)
      data.cycle_regularity = input.cycle_regularity || undefined;

    data.updated_at = new Date().toISOString();

    await fs.writeFile(
      clientYaml,
      dumpYaml(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    revalidatePath(`/clients-v2/${input.client_id}`);
    revalidatePath("/dashboard-v2");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update cycle tracking" };
  }
}

// ---------------------------------------------------------------------------

/**
 * Mind-body drip override (2026-06-16). The app auto-unlocks EFT once breathing
 * is a habit (≥3 distinct days/week); this lets the coach override per client:
 *   auto     → drip decides (default; field removed)
 *   unlocked → release EFT now, regardless of breathing
 *   locked   → hold EFT (hidden, no nudge)
 * Written to client.yaml#mindbody_eft (Client is extra=ignore, so no model
 * change); the per-minute reconcile projects it to the Fly app.
 */
export async function setMindbodyOverride(
  clientId: string,
  technique: "eft" | "sleep",
  state: "auto" | "unlocked" | "locked",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const yaml = await import("js-yaml");
    const data = yaml.load(await fs.readFile(clientYaml, "utf8")) as Record<string, unknown>;
    const key = `mindbody_${technique}`;
    if (state === "auto") delete data[key];
    else data[key] = state;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as { message?: string }).message ?? "Failed to set mind-body override" };
  }
}

/**
 * Coach override of which EFT tapping issues a client gets in the app. By
 * default the issues are auto-detected from the case (deriveEft); this lets the
 * coach curate the set explicitly — force-add "sleep" even if the keywords
 * didn't fire, or drop one. Written to client.yaml#eft_themes (a list of theme
 * keys); passing null/empty deletes it and returns to auto-detection. Client is
 * extra=ignore, so no model change; the per-minute reconcile projects it to Fly.
 */
export async function setEftThemes(
  clientId: string,
  themes: string[] | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const yaml = await import("js-yaml");
    const data = yaml.load(await fs.readFile(clientYaml, "utf8")) as Record<string, unknown>;
    if (!themes || themes.length === 0) delete data.eft_themes;
    else data.eft_themes = themes;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as { message?: string }).message ?? "Failed to set EFT issues" };
  }
}

// ---------------------------------------------------------------------------

export interface ClientTimelineEvent {
  year?: number | null;
  date?: string | null;
  event: string;
  category?: string | null;
}

export interface UpdateClientTimelineInput {
  client_id: string;
  timeline_events: ClientTimelineEvent[];
}

export type UpdateClientTimelineResult =
  | { ok: true }
  | { ok: false; error: string };

/** Overwrites client.timeline_events with the given list. Caller is
 *  responsible for merging with the existing list if doing an append. */
export async function updateClientTimeline(
  input: UpdateClientTimelineInput,
): Promise<UpdateClientTimelineResult> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "client.yaml",
  );
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = yaml.load(raw) as Record<string, unknown>;
    // Clean: drop empty/whitespace events, normalise undefined → omit.
    const cleaned = (input.timeline_events ?? [])
      .filter((e) => e && typeof e.event === "string" && e.event.trim() !== "")
      .map((e) => {
        const out: Record<string, unknown> = { event: e.event.trim() };
        if (e.year != null) out.year = e.year;
        if (e.date) out.date = e.date;
        if (e.category) out.category = e.category;
        return out;
      });
    data.timeline_events = cleaned;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(
      clientYaml,
      dumpYaml(data, { noRefs: true, sortKeys: false }),
      "utf8",
    );
    revalidatePath(`/clients/${input.client_id}`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to update timeline" };
  }
}

// ---------------------------------------------------------------------------

export interface UpdatePreferencesInput {
  client_id: string;
  dietary_preference?: string;
  /** Whether a veg-spectrum client accepts animal-derived supplements
   *  (fish oil, gelatin, collagen). "yes" | "no" | "unsure" | "".
   *  Consumed by the plan checker + plan-chat AI. */
  animal_derived_supplements_ok?: string;
  foods_to_avoid?: string;
  reported_triggers?: string;
  non_negotiables?: string;
  city?: string;
  country?: string;
  /** Per-client meal plan letter shape preference. Read by
   *  render-client-letter.py phase-letter prompt builder. */
  meal_plan_style?: "detailed" | "principles" | "hybrid";

  family_history?: string;

  // FM body-systems review (deep intake)
  digestion_notes?: string;
  sleep_notes?: string;
  energy_pattern?: string;
  menstrual_notes?: string;
  stress_response?: string;
  childhood_history?: string;
  toxic_exposures?: string;
  what_has_worked?: string;
  what_hasnt_worked?: string;

  // Cycle context (women clients)
  cycle_status?: "menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable";
  last_menstrual_period?: string;
  cycle_length_days?: number;
  cycle_regularity?: "regular" | "irregular" | "very_irregular";
  menopause_started?: string;

  // Pregnancy / lactation
  pregnancy_status?:
    | "not_applicable"
    | "not_pregnant"
    | "trying_to_conceive"
    | "pregnant_first_trimester"
    | "pregnant_second_trimester"
    | "pregnant_third_trimester"
    | "lactating";
  pregnancy_due_date?: string;
  lactation_started?: string;

  // Per-client letter preferences. Coach toggles which letter types this
  // client should receive (some refuse supplements, exercise plan is opt-in).
  // Allowed values: consolidated | meal_plan | supplement_plan |
  // lifestyle_guide | exercise_plan. Default on Python model: ["consolidated"].
  letter_types_active?: string[];

  // Ayurveda layer (opt-in per client). ayurveda_enabled is the master switch;
  // ayurveda_constitution is the coach-confirmed prakruti (from the dosha quiz).
  ayurveda_enabled?: boolean;
  ayurveda_constitution?: string;
  ayurveda_constitution_notes?: string;
  // Decoupled from the layer: whether the intake collects the dosha
  // self-assessment. Default on for new clients; coach opt-out.
  collect_dosha_quiz?: boolean;

  // Optional plan modules / layers (the newer toggle-able ones — Schüssler's
  // salts, peptides, …). Enabled module ids; full overwrite on save.
  // The registry lives in src/lib/fmdb/plan-modules.ts.
  plan_modules?: string[];
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
    if (input.animal_derived_supplements_ok !== undefined)
      data.animal_derived_supplements_ok = input.animal_derived_supplements_ok;
    if (input.foods_to_avoid !== undefined)
      data.foods_to_avoid = input.foods_to_avoid;
    if (input.reported_triggers !== undefined)
      data.reported_triggers = input.reported_triggers;
    if (input.non_negotiables !== undefined)
      data.non_negotiables = input.non_negotiables;
    if (input.city !== undefined) data.city = input.city;
    if (input.country !== undefined) data.country = input.country;
    if (input.family_history !== undefined) data.family_history = input.family_history;

    // FM body-systems
    if (input.digestion_notes !== undefined) data.digestion_notes = input.digestion_notes;
    if (input.sleep_notes !== undefined) data.sleep_notes = input.sleep_notes;
    if (input.energy_pattern !== undefined) data.energy_pattern = input.energy_pattern;
    if (input.menstrual_notes !== undefined) data.menstrual_notes = input.menstrual_notes;
    if (input.stress_response !== undefined) data.stress_response = input.stress_response;
    if (input.childhood_history !== undefined) data.childhood_history = input.childhood_history;
    if (input.toxic_exposures !== undefined) data.toxic_exposures = input.toxic_exposures;
    if (input.what_has_worked !== undefined) data.what_has_worked = input.what_has_worked;
    if (input.what_hasnt_worked !== undefined) data.what_hasnt_worked = input.what_hasnt_worked;

    // Cycle context
    if (input.cycle_status !== undefined) data.cycle_status = input.cycle_status;
    if (input.last_menstrual_period !== undefined) data.last_menstrual_period = input.last_menstrual_period;
    if (input.cycle_length_days !== undefined) data.cycle_length_days = input.cycle_length_days;
    if (input.cycle_regularity !== undefined) data.cycle_regularity = input.cycle_regularity;
    if (input.menopause_started !== undefined) data.menopause_started = input.menopause_started;

    // Pregnancy / lactation
    if (input.pregnancy_status !== undefined) data.pregnancy_status = input.pregnancy_status;
    if (input.pregnancy_due_date !== undefined) data.pregnancy_due_date = input.pregnancy_due_date;
    if (input.lactation_started !== undefined) data.lactation_started = input.lactation_started;

    if (input.letter_types_active !== undefined) data.letter_types_active = input.letter_types_active;

    // Ayurveda layer
    if (input.ayurveda_enabled !== undefined) data.ayurveda_enabled = input.ayurveda_enabled;
    if (input.ayurveda_constitution !== undefined) data.ayurveda_constitution = input.ayurveda_constitution;
    if (input.ayurveda_constitution_notes !== undefined)
      data.ayurveda_constitution_notes = input.ayurveda_constitution_notes;
    if (input.collect_dosha_quiz !== undefined) data.collect_dosha_quiz = input.collect_dosha_quiz;

    // Optional plan modules (newer toggle-able layers)
    if (input.plan_modules !== undefined) data.plan_modules = input.plan_modules;

    // bump updated_at
    data.updated_at = new Date().toISOString();

    await fs.writeFile(
      clientYaml,
      dumpYaml(data, { noRefs: true, sortKeys: false }),
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
      dumpYaml(data, { noRefs: true, sortKeys: false }),
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

    // Sanity-validate every provided metric value before writing — a value in
    // the wrong unit (36 cm waist) or corrupt (-1.5 cm hip) is rejected here
    // even if the UI let it through. Storage is always metric.
    const toValidate: [string, number | undefined][] = [
      ["weight_kg", input.weight_kg],
      ["height_cm", input.height_cm],
      ["waist_cm", input.waist_cm],
      ["hip_cm", input.hip_cm],
      ["blood_pressure_systolic", input.blood_pressure_systolic],
      ["blood_pressure_diastolic", input.blood_pressure_diastolic],
      ["resting_heart_rate", input.resting_heart_rate],
    ];
    for (const [key, val] of toValidate) {
      if (val === undefined) continue;
      const v = validateMeasurement(key, val);
      if (!v.ok) return { ok: false, error: v.error };
    }

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

    await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    // Revalidate both v1 + v2 client routes — the v2 dashboard / Overview
    // / Plan / Analyse tabs all need a fresh body-comp read. Forgetting
    // the v2 paths was the original reason "+ Log entry" appeared to do
    // nothing in the UI (data saved, page kept showing the stale flat
    // measurements). Bug surfaced 2026-05-18 for cl-004.
    revalidatePath(`/clients/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}/plan`);
    revalidatePath(`/clients-v2/${input.client_id}/analyse`);
    revalidatePath(`/clients-v2/${input.client_id}/sessions`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to add measurement" };
  }
}

/**
 * B2 fix 2026-05-23 — delete a body-comp snapshot.
 *
 * Coach corrected Archana cl-007's weight 68→60 by adding a NEW snapshot;
 * the old 68 stayed on file, so the body comp tile showed "−8 kg in 10
 * days" (which was a typo correction, not a real loss). Without a delete
 * affordance the only recourse was hand-editing client.yaml.
 *
 * Handles BOTH storage paths the body-comp panel reads from:
 *   - `measurements_log[]` (FmBodyCompGrid "+ Log entry" writes here)
 *   - `health_snapshots[]` (older assess-pipeline writes here)
 *
 * Identity for a snapshot is (origin, date, source). `source` only
 * disambiguates within health_snapshots — measurements_log entries have
 * no source field, so date alone is the key there.
 */
export interface DeleteSnapshotInput {
  client_id: string;
  origin: "measurements_log" | "health_snapshots";
  date: string;
  source?: string;
}

export async function deleteMeasurementSnapshotAction(
  input: DeleteSnapshotInput,
): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    input.client_id,
    "client.yaml",
  );
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    let removed = 0;
    if (input.origin === "measurements_log") {
      const log = (data.measurements_log as Record<string, unknown>[]) ?? [];
      const next = log.filter((e) => String(e.date) !== input.date);
      removed = log.length - next.length;
      data.measurements_log = next;
    } else {
      const snaps = (data.health_snapshots as Record<string, unknown>[]) ?? [];
      const next = snaps.filter(
        (s) =>
          !(
            String(s.date) === input.date &&
            (input.source ? String(s.source ?? "") === input.source : true)
          ),
      );
      removed = snaps.length - next.length;
      data.health_snapshots = next;
    }
    if (removed === 0) {
      return { ok: false, error: "No matching snapshot found." };
    }
    data.updated_at = new Date().toISOString();
    await fs.writeFile(
      clientYaml,
      dumpYaml(data, { noRefs: true, sortKeys: false }),
      "utf8",
    );
    revalidatePath(`/clients/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}/plan`);
    revalidatePath(`/clients-v2/${input.client_id}/analyse`);
    revalidatePath(`/clients-v2/${input.client_id}/sessions`);
    return { ok: true, removed };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to delete snapshot" };
  }
}

// ── Weight loss goal CRUD ────────────────────────────────────────────────────
// Per-client commitment that drives every meal-plan letter. Set once on
// Overview, applies to all letters automatically. Per-week overrides
// handle travel / festivals / plateau breaks without re-typing the goal.

type WeightLossMode = "maintenance" | "deeper_deficit" | "skip";

export interface WeightLossGoalPayload {
  enabled?: boolean;
  starting_weight_kg?: number;
  starting_date?: string;          // YYYY-MM-DD
  goal_kg?: number;
  goal_target_date?: string;       // YYYY-MM-DD
  pace?: "slow" | "moderate" | "faster";
  activity_level?: "sedentary" | "light" | "moderate" | "active";
  exercise_current?: string;
  exercise_open_to?: string;
  exercise_days_per_week?: number;
  exercise_limitations?: string;
  notes_for_coach?: string;
}

export type WeightLossOverrideContext =
  | "travel"
  | "festival"
  | "illness"
  | "plateau_break"
  | "other";

export interface WeightLossWeekOverridePayload {
  /** Inclusive YYYY-MM-DD range. New overrides MUST use these. */
  date_from?: string;
  date_to?: string;
  mode: WeightLossMode;
  kcal_offset?: number;
  /** Semantic context. When "travel", `location` is read by the
   *  letter generator to localise meal swaps + restaurant guidance. */
  context?: WeightLossOverrideContext;
  /** Travel destination, e.g. "Sydney, Australia". */
  location?: string;
  reason?: string;
  /** Legacy: week-number based overrides. Loader preserves these
   *  but no new override is created this way. */
  weeks?: number[];
}

interface WeightLossYaml {
  enabled?: boolean;
  starting_weight_kg?: number;
  starting_date?: string;
  goal_kg?: number;
  goal_target_date?: string;
  pace?: string;
  activity_level?: string;
  exercise_current?: string;
  exercise_open_to?: string;
  exercise_days_per_week?: number;
  exercise_limitations?: string;
  notes_for_coach?: string;
  week_overrides?: WeightLossWeekOverridePayload[];
  /** Observed-TDEE correction (#3) — measured real burn that replaces the
   *  Mifflin prediction in _calc_calorie_targets / computeCaloriePhases. */
  tdee_override?: number;
  [k: string]: unknown;
}

async function readClientYaml(
  clientId: string,
): Promise<{ data: Record<string, unknown>; path: string } | { error: string }> {
  const clientYaml = path.join(
    getPlansRoot(),
    "clients",
    clientId,
    "client.yaml",
  );
  try {
    const yamlMod = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yamlMod.load(raw) as Record<string, unknown>) ?? {};
    return { data, path: clientYaml };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function writeClientYaml(
  filePath: string,
  data: Record<string, unknown>,
  clientId: string,
): Promise<void> {
  data.updated_at = new Date().toISOString();
  await fs.writeFile(
    filePath,
    // dumpYaml (not raw js-yaml) so numeric-underscore chip strings like
    // time_to_fall_asleep: "30_60" stay quoted — else PyYAML reads them as
    // int 3060 and every Python shim that loads this client crashes.
    dumpYaml(data, { sortKeys: false }),
    "utf8",
  );
  // Revalidate every surface that reads weight_loss
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/communicate`);
  revalidatePath(`/clients-v2/${clientId}/plan`);
  revalidatePath(`/clients/${clientId}`);
}

/** Create or update the entire weight_loss goal block.
 *  Merges with existing values — pass undefined for fields you don't
 *  want to touch. Existing week_overrides are preserved (use the
 *  add/remove actions to mutate the list). */
export async function updateClientWeightLossGoal(
  clientId: string,
  payload: WeightLossGoalPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  const read = await readClientYaml(clientId);
  if ("error" in read) return { ok: false, error: read.error };
  const { data, path: clientPath } = read;

  const existing = (data.weight_loss as WeightLossYaml | undefined) ?? {};
  const next: WeightLossYaml = { ...existing };

  // Trim string fields; null/undefined → leave existing as-is.
  if (payload.enabled !== undefined) next.enabled = payload.enabled;
  if (payload.starting_weight_kg !== undefined)
    next.starting_weight_kg = payload.starting_weight_kg;
  if (payload.starting_date !== undefined)
    next.starting_date = payload.starting_date.trim() || undefined;
  if (payload.goal_kg !== undefined) next.goal_kg = payload.goal_kg;
  if (payload.goal_target_date !== undefined)
    next.goal_target_date = payload.goal_target_date.trim() || undefined;
  if (payload.pace !== undefined) next.pace = payload.pace;
  if (payload.activity_level !== undefined)
    next.activity_level = payload.activity_level;
  if (payload.exercise_current !== undefined)
    next.exercise_current = payload.exercise_current.trim() || undefined;
  if (payload.exercise_open_to !== undefined)
    next.exercise_open_to = payload.exercise_open_to.trim() || undefined;
  if (payload.exercise_days_per_week !== undefined)
    next.exercise_days_per_week = payload.exercise_days_per_week;
  if (payload.exercise_limitations !== undefined)
    next.exercise_limitations = payload.exercise_limitations.trim() || undefined;
  if (payload.notes_for_coach !== undefined)
    next.notes_for_coach = payload.notes_for_coach.trim() || undefined;

  // Default-enable when the coach saves a goal block without explicit flag.
  // Coach can pause via pauseWeightLossGoal.
  if (next.enabled === undefined) next.enabled = true;

  data.weight_loss = next;

  try {
    await writeClientYaml(clientPath, data, clientId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Append a per-week override to the goal. Dedupes by weeks set — if an
 *  override already exists covering ANY of the same week numbers, it's
 *  replaced (last-write-wins). Coach intent: "wks 4-5 maintenance"
 *  overwrites whatever was there for those weeks. */
export async function addWeightLossOverride(
  clientId: string,
  override: WeightLossWeekOverridePayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  const hasDates = !!(override.date_from && override.date_to);
  const hasWeeks = override.weeks && override.weeks.length > 0;
  if (!hasDates && !hasWeeks)
    return {
      ok: false,
      error: "Override needs date_from + date_to (or legacy weeks).",
    };
  if (hasDates && override.date_from! > override.date_to!)
    return { ok: false, error: "date_from must be ≤ date_to" };
  if (override.context === "travel" && !override.location?.trim())
    return {
      ok: false,
      error: "Travel overrides need a destination so the meal plan can localise.",
    };
  const read = await readClientYaml(clientId);
  if ("error" in read) return { ok: false, error: read.error };
  const { data, path: clientPath } = read;

  const wl = (data.weight_loss as WeightLossYaml | undefined) ?? {};
  if (wl.enabled === undefined) wl.enabled = true;
  const existing = (wl.week_overrides ?? []) as WeightLossWeekOverridePayload[];

  // Drop existing overrides that overlap the new date range. (Legacy
  // week-based entries are preserved — they don't have dates to compare.)
  const filtered = hasDates
    ? existing.filter((o) => {
        if (!o.date_from || !o.date_to) return true;
        return o.date_to < override.date_from! || o.date_from > override.date_to!;
      })
    : existing;

  filtered.push({
    ...(hasDates
      ? { date_from: override.date_from!, date_to: override.date_to! }
      : { weeks: [...(override.weeks ?? [])].sort((a, b) => a - b) }),
    mode: override.mode,
    ...(override.mode === "deeper_deficit" && override.kcal_offset !== undefined
      ? { kcal_offset: override.kcal_offset }
      : {}),
    ...(override.context ? { context: override.context } : {}),
    ...(override.location?.trim() ? { location: override.location.trim() } : {}),
    ...(override.reason?.trim() ? { reason: override.reason.trim() } : {}),
  });
  // Sort by date (or first week for legacy) ascending so the UI list
  // is predictable.
  filtered.sort((a, b) => {
    const ka = a.date_from ?? (a.weeks ? String(Math.min(...a.weeks)).padStart(4, "0") : "");
    const kb = b.date_from ?? (b.weeks ? String(Math.min(...b.weeks)).padStart(4, "0") : "");
    return ka.localeCompare(kb);
  });
  wl.week_overrides = filtered;
  data.weight_loss = wl;

  try {
    await writeClientYaml(clientPath, data, clientId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** A — coach pre-authors the in-app travel food guide. Runs the shared
 *  generator against the client's active travel flag and caches the result
 *  onto it (travel_response.local_foods), so the app renders it first, ahead
 *  of the curated dataset. Needs an active travel flag + API credits; returns
 *  a clear message otherwise (the curated/generic tiers still cover the card). */
export async function generateTravelGuideAction(
  clientId: string,
): Promise<{ ok: true; guide: unknown } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  try {
    const out = (await runShim("generate-travel-guide.py", {
      client_id: clientId,
      source: "pre_authored",
    })) as { ok?: boolean; guide?: unknown; error?: string };
    if (!out.ok) {
      const msg =
        out.error === "no_api_credits"
          ? "No API credits right now — the curated guide still shows in the app."
          : out.error === "no_travel_window"
            ? "No active travel flag — flag the trip in the app first (dates + destination)."
            : out.error === "no_location"
              ? "The travel flag has no destination set."
              : out.error ?? "Generation failed";
      return { ok: false, error: msg };
    }
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true, guide: out.guide };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove a per-week override by its index in the current list. */
export async function removeWeightLossOverride(
  clientId: string,
  index: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  const read = await readClientYaml(clientId);
  if ("error" in read) return { ok: false, error: read.error };
  const { data, path: clientPath } = read;

  const wl = (data.weight_loss as WeightLossYaml | undefined) ?? {};
  const existing = (wl.week_overrides ?? []) as WeightLossWeekOverridePayload[];
  if (index < 0 || index >= existing.length)
    return { ok: false, error: `Override index ${index} out of range` };
  existing.splice(index, 1);
  wl.week_overrides = existing;
  data.weight_loss = wl;

  try {
    await writeClientYaml(clientPath, data, clientId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Flip the enabled flag without touching the rest of the config —
 *  preserves goal_kg / pace / overrides so coach can re-enable later
 *  without re-entering everything. */
export async function pauseWeightLossGoal(
  clientId: string,
  paused: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  const read = await readClientYaml(clientId);
  if ("error" in read) return { ok: false, error: read.error };
  const { data, path: clientPath } = read;

  const wl = (data.weight_loss as WeightLossYaml | undefined) ?? {};
  wl.enabled = !paused;
  data.weight_loss = wl;

  try {
    await writeClientYaml(clientPath, data, clientId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Apply (or clear) the observed-TDEE correction (#3). Pass a plausible
 * kcal number to store `weight_loss.tdee_override` — it then replaces the
 * Mifflin prediction in every future calorie computation (the card ramp +
 * letter generation). Pass null to revert to the formula.
 */
export async function setWeightLossTdeeOverride(
  clientId: string,
  tdee: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "Missing clientId" };
  if (tdee != null && (!Number.isFinite(tdee) || tdee < 800 || tdee > 4500)) {
    return { ok: false, error: "TDEE must be between 800 and 4500 kcal" };
  }
  const read = await readClientYaml(clientId);
  if ("error" in read) return { ok: false, error: read.error };
  const { data, path: clientPath } = read;

  const wl = (data.weight_loss as WeightLossYaml | undefined) ?? {};
  if (tdee == null) {
    delete wl.tdee_override;
  } else {
    wl.tdee_override = Math.round(tdee);
  }
  data.weight_loss = wl;

  try {
    await writeClientYaml(clientPath, data, clientId);
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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
    await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");

    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Parse client message (WhatsApp inbound or pasted text) ───────────────────

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

// ── WhatsApp webhook — match phone to client ─────────────────────────────────

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
  formData: FormData
): Promise<UploadPhotoResult> {
  // Accepts FormData (NOT Uint8Array) — Next 16 RSC can't serialize multi-MB
  // Uint8Array (hits "Maximum array nesting exceeded"). FormData streams.
  // Fields: client_id (string), file (File)
  const clientId = formData.get("client_id");
  const file = formData.get("file");
  if (typeof clientId !== "string" || !/^[\w-]+$/.test(clientId)) {
    return { ok: false, error: "Invalid client ID" };
  }
  if (!(file instanceof File) || !file.size) {
    return { ok: false, error: "No file data" };
  }

  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg":  "jpg",
    "image/png":  "png",
    "image/webp": "webp",
    "image/gif":  "gif",
  };
  const ext = extMap[file.type.toLowerCase()] ?? "jpg";

  const dir = path.join(getPlansRoot(), "clients", clientId);
  const dest = path.join(dir, `photo.${ext}`);

  // Remove any existing photo files with other extensions
  const otherExts = ["jpg", "jpeg", "png", "webp"].filter((e) => e !== ext);
  for (const e of otherExts) {
    try { await fs.unlink(path.join(dir, `photo.${e}`)); } catch { /* ignore */ }
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(dest, buf);
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

// ── Lab Reference Ranges ──────────────────────────────────────────────────────

export interface LabReferenceRange {
  optimal_low?: number;
  optimal_high?: number;
  unit?: string;
}

export type LabReferenceRanges = Record<string, LabReferenceRange>;

export type SaveLabReferenceRangesResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Save FM-optimal reference ranges for a client's lab markers.
 * Writes `lab_reference_ranges` into client.yaml.
 */
export async function saveLabReferenceRangesAction(
  clientId: string,
  ranges: LabReferenceRanges
): Promise<SaveLabReferenceRangesResult> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    data.lab_reference_ranges = ranges;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(clientYaml, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to save reference ranges" };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Lab test catalogue — surfaces FM-optimal AND conventional ranges next to
// every lab value the coach views. Loaded once on health-trends mount.
// ────────────────────────────────────────────────────────────────────────────

export interface CatalogueLabRange {
  slug: string;
  display_name: string;
  full_name?: string;
  units?: string;
  conventional_low?: number | null;
  conventional_high?: number | null;
  fm_optimal_low?: number | null;
  fm_optimal_high?: number | null;
  interpretation_low?: string;
  interpretation_high?: string;
  /** Client-app Lab Vault visibility. undefined/true = shown to the client;
   *  false = coach-only (sensitive marker). Coach surfaces ignore this. */
  client_visible?: boolean;
  /** Lowercased: slug + display_name + full_name + aliases. Used by matchLabTest(). */
  match_keys: string[];
}

let _labCatalogueCache: CatalogueLabRange[] | null = null;

export async function loadLabTestsCatalogueAction(): Promise<CatalogueLabRange[]> {
  if (_labCatalogueCache) return _labCatalogueCache;
  try {
    const { loadAllOfKind } = await import("@/lib/fmdb/loader");
    type LT = {
      slug: string;
      display_name: string;
      full_name?: string;
      aliases?: string[];
      units?: string;
      conventional_low?: number | null;
      conventional_high?: number | null;
      fm_optimal_low?: number | null;
      fm_optimal_high?: number | null;
      interpretation_low?: string;
      interpretation_high?: string;
      client_visible?: boolean;
    };
    const tests = await loadAllOfKind<LT>("lab_tests");
    _labCatalogueCache = tests.map((t) => {
      const keys = new Set<string>();
      const add = (s?: string) => { if (s) keys.add(s.trim().toLowerCase()); };
      add(t.slug);
      add(t.display_name);
      add(t.full_name);
      for (const a of t.aliases ?? []) add(a);
      return {
        slug: t.slug,
        display_name: t.display_name,
        full_name: t.full_name,
        units: t.units,
        conventional_low: t.conventional_low ?? null,
        conventional_high: t.conventional_high ?? null,
        fm_optimal_low: t.fm_optimal_low ?? null,
        fm_optimal_high: t.fm_optimal_high ?? null,
        interpretation_low: t.interpretation_low,
        interpretation_high: t.interpretation_high,
        client_visible: t.client_visible !== false,
        match_keys: Array.from(keys).filter(Boolean),
      } satisfies CatalogueLabRange;
    });
    return _labCatalogueCache;
  } catch (e) {
    console.error("[loadLabTestsCatalogueAction] failed:", e);
    return [];
  }
}

/**
 * Load FM-optimal reference ranges for a client.
 */
export async function loadLabReferenceRangesAction(
  clientId: string
): Promise<LabReferenceRanges> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    return (data.lab_reference_ranges as LabReferenceRanges) ?? {};
  } catch {
    return {};
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Session-tab marker chart picks — sticky per-client list of marker names the
// coach has chosen to display as trend tiles on the v2 Sessions tab. Stored at
// `~/fm-plans/clients/<id>/ui_preferences.yaml` under `session_chart_markers`.
// File is created on first save; reads tolerate missing file.
// ────────────────────────────────────────────────────────────────────────────

function uiPreferencesPath(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "ui_preferences.yaml");
}

export async function loadSessionChartMarkersAction(
  clientId: string,
): Promise<string[]> {
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(uiPreferencesPath(clientId), "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const arr = data.session_chart_markers;
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

export async function saveSessionChartMarkersAction(
  clientId: string,
  markers: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const yaml = await import("js-yaml");
    const filePath = uiPreferencesPath(clientId);
    let data: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(filePath, "utf8");
      data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    } catch {
      // file doesn't exist yet — start fresh
    }
    data.session_chart_markers = markers;
    data.updated_at = new Date().toISOString();
    // Ensure parent dir exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to save chart markers" };
  }
}

/**
 * Resolve an existing file already in `~/fm-plans/clients/<id>/files/<name>`
 * to its absolute path + mime type, so the assess flow can attach a
 * previously-uploaded lab report or food journal without re-uploading.
 *
 * Returns ok:false if the file doesn't exist (or escapes the files dir).
 */
export async function resolveClientFileAction(
  clientId: string,
  filename: string
): Promise<{ ok: true; filePath: string; mimeType: string } | { ok: false; error: string }> {
  if (!clientId || !filename) {
    return { ok: false, error: "clientId and filename are required" };
  }
  // Path-traversal guard: filename must not contain slashes or .. segments
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return { ok: false, error: "invalid filename" };
  }
  const filesDir = path.join(getPlansRoot(), "clients", clientId, "files");
  const filePath = path.join(filesDir, filename);
  // Ensure the resolved path stays inside filesDir (defence-in-depth)
  if (!path.resolve(filePath).startsWith(path.resolve(filesDir) + path.sep)) {
    return { ok: false, error: "invalid path" };
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: "not a file" };
  } catch {
    return { ok: false, error: "file not found" };
  }
  const lower = filename.toLowerCase();
  const mimeType =
    lower.endsWith(".pdf")  ? "application/pdf"
    : lower.endsWith(".png")  ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
    : lower.endsWith(".webp") ? "image/webp"
    : lower.endsWith(".md")   ? "text/markdown"
    : "text/plain";
  return { ok: true, filePath, mimeType };
}

/**
 * List filenames already saved under `~/fm-plans/clients/<id>/files/`.
 *
 * Used by the assess / full-assessment forms so the coach can re-attach
 * a transcript / lab / report from a prior session without re-uploading.
 * Returns name + size + mtime (ISO) so the UI can sort newest-first and
 * show a hint of recency. Hidden files (dotfiles) are skipped.
 */
export async function listClientFilesAction(
  clientId: string,
): Promise<{ ok: true; files: Array<{ filename: string; size: number; mtime: string }> } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "clientId is required" };
  const filesDir = path.join(getPlansRoot(), "clients", clientId, "files");
  try {
    const entries = await fs.readdir(filesDir);
    const out: Array<{ filename: string; size: number; mtime: string }> = [];
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = path.join(filesDir, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        out.push({ filename: name, size: st.size, mtime: st.mtime.toISOString() });
      } catch { /* skip unreadable */ }
    }
    // Newest first
    out.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { ok: true, files: out };
  } catch {
    // No files dir yet — return empty rather than error
    return { ok: true, files: [] };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Drug-nutrient depletion auto-flag — matches client.current_medications
// (or client.medications) against the drug-depletion catalogue and returns
// the matched records. Used by the Client Overview '💊 Medication impact'
// panel. Match is case-insensitive substring on drug_name + drug_aliases.
// ────────────────────────────────────────────────────────────────────────────

export interface MedicationImpactMatch {
  client_med_text: string;            // raw entry from client.current_medications
  drug_slug: string;
  drug_name: string;
  drug_class?: string;
  matched_alias: string;              // which alias / name caused the match
  summary?: string;
  depletes: Array<{
    nutrient: string;
    severity?: string;
    mechanism?: string;
    monitoring_recommendation?: string;
    typical_supplement_dose?: string;
  }>;
  timing_separations?: string[];
  contraindicated_supplements?: string[];
  monitoring_labs?: string[];
  coach_notes?: string;
  evidence_tier?: string;
}

export interface MedicationImpactResult {
  ok: boolean;
  matches: MedicationImpactMatch[];
  unmatched: string[];                // client meds with no catalogue record
  error?: string;
}

export async function checkMedicationImpactsAction(
  clientId: string,
): Promise<MedicationImpactResult> {
  try {
    const { loadAllOfKind } = await import("@/lib/fmdb/loader");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const yaml = await import("js-yaml");

    // Load client YAML directly (small file; no need to shell out)
    const root = getPlansRoot();
    const clientPath = path.join(root, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientPath, "utf-8").catch(() => null);
    if (!raw) return { ok: false, matches: [], unmatched: [], error: "Client not found" };

    const client = yaml.load(raw) as Record<string, unknown> | null;
    if (!client || typeof client !== "object") {
      return { ok: false, matches: [], unmatched: [], error: "Client YAML invalid" };
    }
    const meds: string[] = [
      ...((client.current_medications as string[] | undefined) ?? []),
      ...((client.medications as string[] | undefined) ?? []),
    ].map((m) => (m ?? "").trim()).filter(Boolean);

    if (meds.length === 0) {
      return { ok: true, matches: [], unmatched: [] };
    }

    // Dedup case-insensitively
    const seen = new Set<string>();
    const dedupedMeds = meds.filter((m) => {
      const k = m.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const records = await loadAllOfKind<{
      slug: string;
      drug_name: string;
      drug_aliases?: string[];
      drug_class?: string;
      summary?: string;
      depletes?: Array<{ nutrient: string; severity?: string; mechanism?: string; monitoring_recommendation?: string; typical_supplement_dose?: string }>;
      timing_separations?: string[];
      contraindicated_supplements?: string[];
      monitoring_labs?: string[];
      coach_notes?: string;
      evidence_tier?: string;
    }>("drug_depletions");

    const matches: MedicationImpactMatch[] = [];
    const unmatched: string[] = [];

    for (const med of dedupedMeds) {
      const medLower = med.toLowerCase().trim();
      // GUARD: substring matching with a short med string would match
      // almost every catalogue drug alias by accident. Archana cl-007 hit
      // this 2026-05-23 — her current_medications had been corrupted
      // into 49 single-character entries by an upstream string-spread
      // bug ('a','c','i','d',…). Each single-char satisfied
      // `cLower.includes(medLower)` against the first alphabetical drug
      // containing that letter, producing 18 phantom matches (ACE
      // Inhibitors / ARBs ×15, Antibiotics ×3, etc.). The upstream fix
      // hardened _merge_lists to reject string inputs, but defending at
      // this matcher too prevents any future garbage-medication entry
      // from creating spurious depletion warnings.
      //
      // 3 chars is the smallest legitimate medication keyword we care
      // about (e.g. "PPI", "OCP", "NAC", "HRT"). Anything shorter is
      // junk.
      if (medLower.length < 3) {
        unmatched.push(med);
        continue;
      }
      let hit: typeof records[number] | null = null;
      let matchedAlias = "";

      outer: for (const rec of records) {
        const candidates = [rec.drug_name, ...(rec.drug_aliases ?? [])].filter(Boolean);
        for (const c of candidates) {
          const cLower = c.toLowerCase().trim();
          // Both sides also need to clear the 3-char floor — a 1-char
          // alias would re-introduce the same bug from the other side.
          if (cLower.length < 3) continue;
          // Match if EITHER side is contained in the other (handles
          // "Eltroxin 50mcg" vs alias "eltroxin"). The 3-char floor
          // above means a med like "AB" can't trigger this.
          if (medLower.includes(cLower) || cLower.includes(medLower)) {
            hit = rec;
            matchedAlias = c;
            break outer;
          }
        }
      }

      if (hit) {
        matches.push({
          client_med_text: med,
          drug_slug: hit.slug,
          drug_name: hit.drug_name,
          drug_class: hit.drug_class,
          matched_alias: matchedAlias,
          summary: hit.summary,
          depletes: (hit.depletes ?? []).map((d) => ({ ...d })),
          timing_separations: hit.timing_separations,
          contraindicated_supplements: hit.contraindicated_supplements,
          monitoring_labs: hit.monitoring_labs,
          coach_notes: hit.coach_notes,
          evidence_tier: hit.evidence_tier,
        });
      } else {
        unmatched.push(med);
      }
    }

    return { ok: true, matches, unmatched };
  } catch (e) {
    return { ok: false, matches: [], unmatched: [], error: String(e) };
  }
}

/**
 * Inline depletion check — takes a list of medication strings directly,
 * returns matches against the drug_depletions catalogue. Unlike
 * checkMedicationImpactsAction this does NOT read client.yaml, so it can
 * preview against meds being typed into the Intake form before save.
 */
/** Walk all of a client's health_snapshots → run compute_ratios on the
 *  flattened lab_values → write back to client.lab_markers + date.
 *  Returns { ok, markers_count, lab_markers_date }. */
export async function recomputeLabMarkersAction(clientId: string): Promise<{
  ok: boolean;
  markers_count?: number;
  lab_markers_date?: string | null;
  error?: string;
}> {
  if (!clientId) return { ok: false, error: "client_id missing" };
  try {
    const res = (await runScript("recompute-lab-markers.py", {
      client_id: clientId,
    })) as {
      ok: boolean;
      markers_count?: number;
      lab_markers_date?: string | null;
      error?: string;
      message?: string;
    };
    if (res.ok) {
      // Refresh any page using the client's lab_markers.
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients/${clientId}`);
    }
    return res;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function checkMedsAgainstCatalogueAction(
  medications: string[],
): Promise<MedicationImpactResult> {
  try {
    const { loadAllOfKind } = await import("@/lib/fmdb/loader");
    const dedupedMeds = (() => {
      const seen = new Set<string>();
      return medications
        .map((m) => (m ?? "").trim())
        .filter(Boolean)
        .filter((m) => {
          const k = m.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
    })();
    if (dedupedMeds.length === 0) {
      return { ok: true, matches: [], unmatched: [] };
    }

    const records = await loadAllOfKind<{
      slug: string;
      drug_name: string;
      drug_aliases?: string[];
      drug_class?: string;
      summary?: string;
      depletes?: Array<{
        nutrient: string;
        severity?: string;
        mechanism?: string;
        monitoring_recommendation?: string;
        typical_supplement_dose?: string;
      }>;
      timing_separations?: string[];
      contraindicated_supplements?: string[];
      monitoring_labs?: string[];
      coach_notes?: string;
      evidence_tier?: string;
    }>("drug_depletions");

    const matches: MedicationImpactMatch[] = [];
    const unmatched: string[] = [];

    for (const med of dedupedMeds) {
      const medLower = med.toLowerCase().trim();
      // Same 3-char floor as checkMedicationImpactsAction — prevents
      // garbage single-character entries from substring-matching the
      // whole catalogue (see Archana cl-007 phantom-match incident
      // 2026-05-23).
      if (medLower.length < 3) {
        unmatched.push(med);
        continue;
      }
      let hit: typeof records[number] | null = null;
      let matchedAlias = "";

      outer: for (const rec of records) {
        const candidates = [rec.drug_name, ...(rec.drug_aliases ?? [])].filter(Boolean);
        for (const c of candidates) {
          const cLower = c.toLowerCase().trim();
          if (cLower.length < 3) continue;
          if (medLower.includes(cLower) || cLower.includes(medLower)) {
            hit = rec;
            matchedAlias = c;
            break outer;
          }
        }
      }

      if (hit) {
        matches.push({
          client_med_text: med,
          drug_slug: hit.slug,
          drug_name: hit.drug_name,
          drug_class: hit.drug_class,
          matched_alias: matchedAlias,
          summary: hit.summary,
          depletes: (hit.depletes ?? []).map((d) => ({ ...d })),
          timing_separations: hit.timing_separations,
          contraindicated_supplements: hit.contraindicated_supplements,
          monitoring_labs: hit.monitoring_labs,
          coach_notes: hit.coach_notes,
          evidence_tier: hit.evidence_tier,
        });
      } else {
        unmatched.push(med);
      }
    }
    return { ok: true, matches, unmatched };
  } catch (e) {
    return { ok: false, matches: [], unmatched: [], error: String(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pregnancy / lactation safety overlay — flags supplements in active plans
// that conflict with the client's PregnancyStatus.
// ────────────────────────────────────────────────────────────────────────────

export interface PregnancySafetyFlag {
  supplement_slug: string;
  supplement_name: string;
  pregnancy_safety: string;            // contraindicated / caution / unknown / safe / likely_safe
  lactation_safety: string;
  note: string;
  source_plan_slug: string;            // which plan brought this supp into the picture
}

export interface PregnancySafetyResult {
  ok: boolean;
  status?: string;                     // client's pregnancy_status
  isActiveStatus: boolean;             // true if status warrants overlay (pregnant / TTC / lactating)
  flags: PregnancySafetyFlag[];        // supplements with relevant safety notes
  unknownSupplements: PregnancySafetyFlag[];  // supps with `unknown` safety — coach should investigate
  error?: string;
}

const ACTIVE_PREGNANCY_STATUSES = new Set([
  "trying_to_conceive",
  "pregnant_first_trimester",
  "pregnant_second_trimester",
  "pregnant_third_trimester",
  "lactating",
]);

export async function checkPregnancySafetyAction(
  clientId: string,
): Promise<PregnancySafetyResult> {
  try {
    const yaml = await import("js-yaml");
    const { getCataloguePath } = await import("@/lib/fmdb/paths");
    const root = getPlansRoot();
    const clientPath = path.join(root, "clients", clientId, "client.yaml");

    const rawC = await fs.readFile(clientPath, "utf-8").catch(() => null);
    if (!rawC) return { ok: false, isActiveStatus: false, flags: [], unknownSupplements: [], error: "Client not found" };
    const client = yaml.load(rawC) as Record<string, unknown> | null;
    if (!client) return { ok: false, isActiveStatus: false, flags: [], unknownSupplements: [], error: "Client YAML invalid" };

    const status = String((client.pregnancy_status as string | undefined) ?? "");
    const isActive = ACTIVE_PREGNANCY_STATUSES.has(status);
    if (!isActive) {
      return { ok: true, status, isActiveStatus: false, flags: [], unknownSupplements: [] };
    }

    // Gather supplement slugs from active (published or draft) plans
    const planSlugs = new Set<string>();
    for (const bucket of ["published", "drafts", "ready"]) {
      const dir = path.join(root, bucket);
      try {
        const files = await fs.readdir(dir);
        for (const f of files) {
          if (!f.endsWith(".yaml")) continue;
          const planPath = path.join(dir, f);
          const planRaw = await fs.readFile(planPath, "utf-8").catch(() => null);
          if (!planRaw) continue;
          const plan = yaml.load(planRaw) as Record<string, unknown> | null;
          if (!plan || plan.client_id !== clientId) continue;
          const supps = (plan.supplement_protocol ?? []) as Array<Record<string, unknown>>;
          for (const s of supps) {
            const slug = s.supplement_slug as string | undefined;
            if (slug) planSlugs.add(`${slug}|${plan.slug}`);
          }
        }
      } catch { /* bucket missing */ }
    }

    const flags: PregnancySafetyFlag[] = [];
    const unknownSupps: PregnancySafetyFlag[] = [];

    const cataloguePath = getCataloguePath();
    for (const key of planSlugs) {
      const [slug, sourcePlan] = key.split("|");
      const fp = path.join(cataloguePath, "supplements", `${slug}.yaml`);
      const sRaw = await fs.readFile(fp, "utf-8").catch(() => null);
      if (!sRaw) continue;
      const supp = yaml.load(sRaw) as Record<string, unknown> | null;
      if (!supp) continue;
      const preg = String((supp.pregnancy_safety as string | undefined) ?? "unknown");
      const lact = String((supp.lactation_safety as string | undefined) ?? "unknown");
      const note = String((supp.pregnancy_safety_note as string | undefined) ?? "");
      const flag: PregnancySafetyFlag = {
        supplement_slug: slug,
        supplement_name: String((supp.display_name as string | undefined) ?? slug),
        pregnancy_safety: preg,
        lactation_safety: lact,
        note,
        source_plan_slug: sourcePlan,
      };
      // Show in flags if non-trivial (anything except `safe`)
      if (preg === "contraindicated" || preg === "caution" || lact === "contraindicated" || lact === "caution") {
        flags.push(flag);
      } else if (preg === "unknown" || lact === "unknown") {
        unknownSupps.push(flag);
      }
    }

    // Sort by severity — contraindicated first
    flags.sort((a, b) => {
      const order = { contraindicated: 0, caution: 1, unknown: 2 } as Record<string, number>;
      return (order[a.pregnancy_safety] ?? 3) - (order[b.pregnancy_safety] ?? 3);
    });

    return { ok: true, status, isActiveStatus: true, flags, unknownSupplements: unknownSupps };
  } catch (e) {
    return { ok: false, isActiveStatus: false, flags: [], unknownSupplements: [], error: String(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Functional test PDF parsing — DUTCH / GI-MAP / OAT
// ────────────────────────────────────────────────────────────────────────────

export interface FunctionalTestResult {
  ok: boolean;
  test_type?: "dutch" | "gi_map" | "unknown";
  summary?: string;
  findings?: Record<string, unknown>;
  flagged_drivers?: string[];
  clinical_recommendations?: string[];
  file_path?: string;
  /** True when the parser recognised this exact PDF was already on file
   *  (by SHA-256 of source bytes) and returned the existing record
   *  instead of re-parsing. No new $0.30–0.60 Sonnet call charged. */
  duplicate?: boolean;
  error?: string;
}

export async function parseFunctionalTestAction(
  clientId: string,
  filePath: string,
  options?: { dryRun?: boolean; testType?: "dutch" | "gi_map" },
): Promise<FunctionalTestResult> {
  try {
    const result = (await runScript(
      "parse-functional-test.py",
      {
        client_id: clientId,
        file_path: filePath,
        dry_run: !!options?.dryRun,
        test_type: options?.testType ?? "",
      },
      300_000, // 5 min — Sonnet on PDF can take a minute+
    )) as FunctionalTestResult;

    // Link the saved test record back to the session that ordered it. Maps
    // dutch → dutch_complete report type, gi_map → gi_map. Falls back to most
    // recent session within 60 days if no session explicitly expected it.
    if (result.ok && result.test_type && result.test_type !== "unknown" && result.file_path) {
      const reportType =
        result.test_type === "dutch" ? "dutch_complete" :
        result.test_type === "gi_map" ? "gi_map" :
        null;
      if (reportType) {
        try {
          const link = await findExpectingSessionAction(clientId, reportType);
          if (link.ok && link.session_id) {
            // Append linked_session_id to the saved test YAML in-place.
            const yaml = await import("js-yaml");
            const fs = await import("node:fs/promises");
            const raw = await fs.readFile(result.file_path, "utf-8");
            const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
            data.linked_session_id = link.session_id;
            await fs.writeFile(result.file_path, dumpYaml(data, { sortKeys: false }));
          }
        } catch {
          // Linking is best-effort — don't fail the parse if it errors.
        }
      }
    }

    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface FunctionalTestSummary {
  test_type: string;
  test_date?: string;
  extracted_at?: string;
  summary?: string;
  flagged_drivers?: string[];
  clinical_recommendations?: string[];
  findings?: Record<string, unknown>;
  file_path: string;        // .yaml location on disk
  source_file?: string;     // original PDF filename
}

export async function loadFunctionalTestsAction(
  clientId: string,
): Promise<{ ok: boolean; tests: FunctionalTestSummary[]; error?: string }> {
  try {
    const root = getPlansRoot();
    const dir = path.join(root, "clients", clientId, "functional_tests");
    const yaml = await import("js-yaml");

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return { ok: true, tests: [] };
    }

    const tests: FunctionalTestSummary[] = [];
    for (const name of entries) {
      if (!name.endsWith(".yaml")) continue;
      const fp = path.join(dir, name);
      try {
        const raw = await fs.readFile(fp, "utf-8");
        const parsed = yaml.load(raw) as Record<string, unknown> | null;
        if (!parsed || typeof parsed !== "object") continue;
        tests.push({
          test_type: String(parsed.test_type ?? "unknown"),
          test_date: parsed.test_date as string | undefined,
          extracted_at: parsed.extracted_at as string | undefined,
          summary: parsed.summary as string | undefined,
          flagged_drivers: parsed.flagged_drivers as string[] | undefined,
          clinical_recommendations: parsed.clinical_recommendations as string[] | undefined,
          findings: parsed,
          file_path: fp,
          source_file: parsed.source_file as string | undefined,
        });
      } catch {
        // skip malformed file
      }
    }

    // Sort newest first by test_date or extracted_at
    tests.sort((a, b) => {
      const da = (a.test_date || a.extracted_at || "");
      const db = (b.test_date || b.extracted_at || "");
      return db.localeCompare(da);
    });

    return { ok: true, tests };
  } catch (e) {
    return { ok: false, tests: [], error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// findExpectingSessionAction — given a clientId + reportType (e.g. "gi_map"),
// returns the session_id of the most recent session whose expected_reports
// includes that type. Falls back to the most recent session within 60 days.
// Used by upload panels to auto-link a late-arriving report to the session
// that ordered it.
// ---------------------------------------------------------------------------

export async function findExpectingSessionAction(
  clientId: string,
  reportType: string
): Promise<{ ok: boolean; session_id?: string | null; error?: string }> {
  try {
    const { loadClientSessions } = await import("@/lib/fmdb/loader-extras");
    const sessions = await loadClientSessions(clientId);
    // First pass — most recent session that explicitly expected this type
    for (const s of sessions) {
      const rec = s as Record<string, unknown>;
      const exp = rec.expected_reports;
      if (Array.isArray(exp) && exp.includes(reportType) && typeof rec.session_id === "string") {
        return { ok: true, session_id: rec.session_id };
      }
    }
    // Fallback — most recent session within last 60 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    for (const s of sessions) {
      const rec = s as Record<string, unknown>;
      const date = rec.date;
      if (typeof date === "string" && new Date(date) >= cutoff && typeof rec.session_id === "string") {
        return { ok: true, session_id: rec.session_id };
      }
    }
    return { ok: true, session_id: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// AI plan-rework suggester
// ---------------------------------------------------------------------------
//
// Fires after a check-in / quick note / functional test / lab snapshot is
// saved. Compares the new event against the client's active plan and outputs
// {benefit_pct, rationale, suggested_changes}. Banner on client overview
// surfaces high-benefit suggestions.

export interface ReworkSuggestionResult {
  ok: boolean;
  suggestion?: {
    generated_at: string;
    triggered_by: string;
    benefit_pct: number;
    confidence: "low" | "medium" | "high";
    rationale: string;
    suggested_changes: Array<{
      op: "add" | "remove" | "escalate" | "deescalate" | "swap";
      target_kind: "supplement" | "topic" | "practice" | "lab_order" | "education";
      target_slug?: string | null;
      description: string;
      reason: string;
    }>;
    dismissed_at?: string;
    snoozed_until?: string;
  } | null;
  error?: string;
}

export async function assessReworkBenefitAction(input: {
  clientId: string;
  triggeredBy: "check_in" | "quick_note" | "functional_test" | "lab_snapshot" | "genetic_report";
  eventSummary: string;
  dryRun?: boolean;
}): Promise<ReworkSuggestionResult> {
  try {
    const result = (await runScript(
      "assess-rework.py",
      {
        client_id: input.clientId,
        triggered_by: input.triggeredBy,
        event_summary: input.eventSummary,
        dry_run: !!input.dryRun,
      },
      90_000,
    )) as ReworkSuggestionResult;
    if (result.ok) {
      revalidatePath(`/clients/${input.clientId}`);
    }
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Mark the current rework_suggestion as dismissed (coach reviewed and rejected). */
export async function dismissReworkSuggestionAction(
  clientId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const yaml = await import("js-yaml");
    const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientYaml, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const sug = (data.rework_suggestion ?? null) as Record<string, unknown> | null;
    if (!sug) return { ok: true };
    sug.dismissed_at = new Date().toISOString();
    data.rework_suggestion = sug;
    await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }));
    // Coach bug 2026-05-19: banner kept reappearing after Dismiss
    // because we only revalidated v1 paths. v2 (the surface coach
    // actually uses) cached the old banner. Revalidate every place
    // the rework banner renders: v1 client, v2 overview, v2 analyse,
    // v2 sessions (which mounts ReworkBanner via SessionsBrowser).
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/analyse`);
    revalidatePath(`/clients-v2/${clientId}/sessions`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Apply the stored rework_suggestion: clone the active plan (or scaffold a new
 * one) as a fresh draft and layer in the AI-suggested supplements / topics /
 * lab orders / education / practices. Returns the new draft slug so the UI can
 * navigate directly to the plan editor.
 */
export interface ApplyReworkResult {
  ok: boolean;
  slug?: string | null;
  successor?: boolean;
  applied_count?: number;
  parent_slug?: string | null;
  error?: string | null;
}

export async function applyReworkSuggestionAction(input: {
  clientId: string;
  newSlug?: string;
  phaseWeeks?: number;
}): Promise<ApplyReworkResult> {
  try {
    const result = (await runScript(
      "apply-rework.py",
      {
        client_id: input.clientId,
        new_slug: input.newSlug ?? null,
        phase_weeks: input.phaseWeeks ?? null,
      },
      60_000,
    )) as ApplyReworkResult;
    if (result.ok) {
      // Mark the rework_suggestion as applied so the rework banner stops
      // nagging. apply-rework.py created/updated a draft with the AI
      // changes — the rework is now baked into that draft, so re-showing
      // "AI suggests plan rework" is just noise. ReworkBanner +
      // AIReadCard both hide when applied_at is set. (Coach 2026-05-20.)
      try {
        const yaml = await import("js-yaml");
        const clientYaml = path.join(
          getPlansRoot(),
          "clients",
          input.clientId,
          "client.yaml",
        );
        const raw = await fs.readFile(clientYaml, "utf-8");
        const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
        const sug = (data.rework_suggestion ?? null) as Record<
          string,
          unknown
        > | null;
        if (sug) {
          sug.applied_at = new Date().toISOString();
          if (result.slug) sug.applied_to_plan = result.slug;
          data.rework_suggestion = sug;
          await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }));
        }
      } catch {
        /* non-fatal — the draft was created; worst case the banner
         * lingers and the coach dismisses it manually. */
      }
      // Same v2 fix as the dismiss action — coach lives on v2.
      revalidatePath(`/clients/${input.clientId}`);
      revalidatePath(`/clients-v2/${input.clientId}`);
      revalidatePath(`/clients-v2/${input.clientId}/analyse`);
      revalidatePath(`/clients-v2/${input.clientId}/sessions`);
      revalidatePath(`/clients-v2/${input.clientId}/plan`);
      revalidatePath("/plans");
      if (result.slug) revalidatePath(`/plans/${result.slug}`);
    }
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Snooze the current rework_suggestion for N days (default 7). */
export async function snoozeReworkSuggestionAction(
  clientId: string,
  days: number = 7
): Promise<{ ok: boolean; error?: string }> {
  try {
    const yaml = await import("js-yaml");
    const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientYaml, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const sug = (data.rework_suggestion ?? null) as Record<string, unknown> | null;
    if (!sug) return { ok: true };
    const until = new Date();
    until.setDate(until.getDate() + days);
    sug.snoozed_until = until.toISOString().slice(0, 10);
    data.rework_suggestion = sug;
    await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }));
    // Same v2 revalidation fix as dismiss/apply actions (2026-05-19).
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/analyse`);
    revalidatePath(`/clients-v2/${clientId}/sessions`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Genetic report parser (MTHFR, COMT, APOE, etc.)
// ---------------------------------------------------------------------------

export interface GeneticSnp {
  gene: string;
  rsid?: string;
  variant?: string;
  genotype: string;
  zygosity: "homozygous_risk" | "heterozygous" | "homozygous_wild" | "unknown";
  implication: string;
  fm_relevance: string;
}

export interface GeneticReportResult {
  ok: boolean;
  test_type?: "genetic";
  test_date?: string;
  summary?: string;
  snps?: GeneticSnp[];
  clinical_implications?: string[];
  fm_recommendations?: string[];
  flagged_drivers?: string[];
  file_path?: string;
  error?: string;
}

export async function parseGeneticReportAction(
  clientId: string,
  filePath: string,
  options?: { dryRun?: boolean }
): Promise<GeneticReportResult> {
  try {
    const result = (await runScript(
      "parse-genetic-report.py",
      {
        client_id: clientId,
        file_path: filePath,
        dry_run: !!options?.dryRun,
      },
      300_000, // 5 min — Sonnet on PDF
    )) as GeneticReportResult;

    // Link the saved record back to the session that ordered it.
    if (result.ok && result.file_path) {
      try {
        const link = await findExpectingSessionAction(clientId, "genetics");
        if (link.ok && link.session_id) {
          const yaml = await import("js-yaml");
          const raw = await fs.readFile(result.file_path, "utf-8");
          const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
          data.linked_session_id = link.session_id;
          await fs.writeFile(result.file_path, dumpYaml(data, { sortKeys: false }));
        }
      } catch {
        // Linking is best-effort
      }
    }

    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Load all saved genetic reports for a client. */
export async function loadGeneticReportsAction(
  clientId: string
): Promise<{ ok: boolean; reports: GeneticReportResult[]; error?: string }> {
  try {
    const yaml = await import("js-yaml");
    const dir = path.join(getPlansRoot(), "clients", clientId, "functional_tests");
    const reports: GeneticReportResult[] = [];
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.startsWith("genetic-") || !entry.endsWith(".yaml")) continue;
        const fp = path.join(dir, entry);
        try {
          const raw = await fs.readFile(fp, "utf-8");
          const parsed = (yaml.load(raw) as Record<string, unknown>) ?? {};
          reports.push({
            ok: true,
            test_type: "genetic",
            test_date: parsed.test_date as string | undefined,
            summary: parsed.summary as string | undefined,
            snps: (parsed.snps as GeneticSnp[] | undefined) ?? [],
            clinical_implications: (parsed.clinical_implications as string[] | undefined) ?? [],
            fm_recommendations: (parsed.fm_recommendations as string[] | undefined) ?? [],
            flagged_drivers: (parsed.flagged_drivers as string[] | undefined) ?? [],
            file_path: fp,
          });
        } catch {
          // skip malformed
        }
      }
    } catch {
      // directory doesn't exist yet
    }
    reports.sort((a, b) => (b.test_date ?? "").localeCompare(a.test_date ?? ""));
    return { ok: true, reports };
  } catch (e) {
    return { ok: false, reports: [], error: String(e) };
  }
}

// ── v0.75.3 physical_exam_findings[] ────────────────────────────────────────

/**
 * A coach-led in-session assessment, stored on client.physical_exam_findings.
 * Append-only — each save adds a new entry. SOAP Objective shows the most
 * recent entry per `kind`. Trend preserved across sessions for rechecks.
 */
export interface PhysicalExamFinding {
  /** e.g. "beighton" | "nasa_lean_test" — extensible. */
  kind: string;
  /** ISO timestamp. Set server-side. */
  assessed_at: string;
  /** Optional link to the session being conducted when this was captured. */
  session_id?: string;
  /** Free-shape per kind. React panels enforce structure on write. */
  result: Record<string, unknown>;
  /** Coach notes. */
  notes?: string;
  /** Who saved (default 'shivani'). */
  by?: string;
}

/**
 * Append a physical exam finding to client.yaml. Used by NASA lean test
 * panel + Beighton verify panel.
 */
export async function saveExamFindingAction(input: {
  client_id: string;
  finding: Omit<PhysicalExamFinding, "assessed_at" | "by"> & {
    assessed_at?: string;
    by?: string;
  };
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const yaml = await import("js-yaml");
    const clientYaml = path.join(
      getPlansRoot(),
      "clients",
      input.client_id,
      "client.yaml",
    );
    const raw = await fs.readFile(clientYaml, "utf8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const existing = Array.isArray(data.physical_exam_findings)
      ? (data.physical_exam_findings as PhysicalExamFinding[])
      : [];
    const entry: PhysicalExamFinding = {
      kind: input.finding.kind,
      assessed_at: input.finding.assessed_at ?? new Date().toISOString(),
      session_id: input.finding.session_id,
      result: input.finding.result,
      notes: input.finding.notes,
      by: input.finding.by ?? "shivani",
    };
    existing.push(entry);
    data.physical_exam_findings = existing;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false, lineWidth: 120 }), "utf8");
    return { ok: true, count: existing.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Check a supplement / home-remedy for a client (one-click suitability) ──
export interface SupplementCheckCaution {
  severity: "avoid" | "caution";
  kind: string;
  detail: string;
}
export interface SupplementCheckResult {
  found: boolean;
  query?: string;
  suggestions?: string[];
  kind?: "supplement" | "home_remedy";
  slug?: string;
  display_name?: string;
  verdict?: "avoid" | "caution" | "good_fit" | "neutral";
  evidence_tier?: string;
  virya?: string;
  balances_dosha?: string[];
  aggravates_dosha?: string[];
  client_vikruti?: string[];
  client_prakruti?: string[];
  cautions?: SupplementCheckCaution[];
  supports?: string[];
  catalogue_contraindications?: string[];
  indications?: string[];
}

/**
 * Deterministic (no-API) suitability check for one supplement/remedy against
 * one client: catalogue contraindications + medication interactions + dosha
 * match across BOTH vikruti (current imbalance) and prakruti (constitution).
 * Powers the "🔍 Check supplement for this client" widget.
 */
export async function checkSupplementForClientAction(
  clientId: string,
  query: string
): Promise<{ ok: true; result: SupplementCheckResult } | { ok: false; error: string }> {
  try {
    const raw = (await runShim(
      "check-supplement-for-client.py",
      { client_id: clientId, query },
      60_000
    )) as { ok: boolean; result?: SupplementCheckResult; error?: string };
    if (!raw.ok || !raw.result) {
      return { ok: false, error: raw.error ?? "Check failed" };
    }
    return { ok: true, result: raw.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Maintenance status (plan end-game) ──────────────────────────────────────
// Dedicated write path for the four maintenance fields, mirroring the
// updatePlanStartDates bypass pattern (plans.ts): touch ONLY these fields so we
// can never accidentally rewrite the rest of client.yaml. Writes raw YAML (no
// Pydantic round-trip), and Client is extra="ignore", so this is additive and
// safe. The app-state resolver (lib/fmdb/app-mode.ts) derives MAINTENANCE /
// GRACE / LIBRARY from `maintenance_paid_through`. See docs/PLAN_END_GAME_SPEC.md.
export interface SetMaintenanceStatusInput {
  client_id: string;
  maintenance_status?: "none" | "active" | "lapsed";
  maintenance_started_on?: string | null;   // YYYY-MM-DD or null to clear
  maintenance_paid_through?: string | null;  // YYYY-MM-DD or null to clear
  maintenance_term_months?: number;
}

export async function setMaintenanceStatus(
  input: SetMaintenanceStatusInput
): Promise<{ ok: true } | { ok: false; error: string }> {
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

    if (input.maintenance_status !== undefined)
      data.maintenance_status = input.maintenance_status;
    if (input.maintenance_started_on !== undefined)
      data.maintenance_started_on = input.maintenance_started_on || undefined;
    if (input.maintenance_paid_through !== undefined)
      data.maintenance_paid_through = input.maintenance_paid_through || undefined;
    if (input.maintenance_term_months !== undefined)
      data.maintenance_term_months = input.maintenance_term_months;

    data.updated_at = new Date().toISOString();

    await fs.writeFile(
      clientYaml,
      dumpYaml(data, { noRefs: true, sortKeys: false }),
      "utf8"
    );

    revalidatePath(`/clients-v2/${input.client_id}`);
    revalidatePath(`/clients-v2/${input.client_id}/plan`);
    revalidatePath("/dashboard-v2");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

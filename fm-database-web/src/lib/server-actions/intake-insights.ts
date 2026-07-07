"use server";

import { execFile } from "child_process";
import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

async function runScript(
  scriptName: string,
  payload: unknown,
  timeoutMs = 60_000
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
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Script returned invalid JSON: ${stdout.slice(0, 400)}`);
  }
}

// ── Public TS shape that mirrors Pydantic IntakeInsights ──────────────────────

export interface IntakeInsightHypothesis {
  driver: string;
  confidence: number; // 0-1
  reasoning: string;
}

/**
 * Fix B 2026-05-23 — FM root cause. The upstream driver from which the
 * client's other conditions cascade. Optional + backward-compatible: legacy
 * records without root_cause continue to load + render fine.
 */
export interface IntakeRootCause {
  label: string;
  reasoning: string;
  downstream_effects: string[];
  confidence: number; // 0-1
}

export interface IntakeInsights {
  generated_at: string;
  model: string;
  root_cause?: IntakeRootCause | null;
  patterns: string[];
  red_flags: string[];
  top_hypotheses: IntakeInsightHypothesis[];
  verify_in_session: string[];
  coach_notes_for_ai: string;
}

type GenerateOk = {
  ok: true;
  client_id: string;
  insights: IntakeInsights;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
};
type GenerateErr = { ok: false; error: string };

/**
 * Generate (or refresh) the AI clinical summary of a client's structured
 * intake form. Runs Haiku with tool_use → writes the structured result
 * back to client.intake_insights. Coach's pre-existing coach_notes_for_ai
 * is preserved across regeneration.
 *
 * Refuses if intake_submitted_at is null.
 */
export async function generateIntakeInsights(
  clientId: string,
  dryRun?: boolean,
  coachNotesForAi?: string,
): Promise<GenerateOk | GenerateErr> {
  try {
    const res = (await runScript(
      "generate-intake-insights.py",
      {
        client_id: clientId,
        dry_run: dryRun ?? false,
        // Fresh notes from the UI win over what's stored on disk. The Python
        // shim treats this as the authoritative coach_notes_for_ai for this
        // run AND persists it back so subsequent regenerations see it too.
        coach_notes_for_ai: (coachNotesForAi ?? "").trim() || undefined,
      },
      120_000,
    )) as GenerateOk | GenerateErr;
    if ((res as GenerateOk).ok) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/intake-view`);
      revalidatePath(`/clients/${clientId}`);
    }
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read-only loader — cheap, no Haiku call. Returns null if not generated. */
export async function loadIntakeInsights(
  clientId: string,
): Promise<IntakeInsights | null> {
  try {
    const root = getPlansRoot();
    const yamlPath = path.join(root, "clients", clientId, "client.yaml");
    let text: string;
    try {
      text = await fs.readFile(yamlPath, "utf8");
    } catch {
      // legacy flat layout fallback
      text = await fs.readFile(
        path.join(root, "clients", `${clientId}.yaml`),
        "utf8",
      );
    }
    const parsed = yaml.load(text) as Record<string, unknown> | null;
    const insights = parsed?.intake_insights as IntakeInsights | undefined;
    if (!insights) return null;
    // Defensive normalisation — older records may be missing fields.
    const rc = (insights as { root_cause?: unknown }).root_cause;
    const normRootCause: IntakeRootCause | null =
      rc && typeof rc === "object"
        ? {
            label: String((rc as Record<string, unknown>).label ?? ""),
            reasoning: String((rc as Record<string, unknown>).reasoning ?? ""),
            downstream_effects: Array.isArray(
              (rc as Record<string, unknown>).downstream_effects,
            )
              ? ((rc as Record<string, unknown>)
                  .downstream_effects as string[])
              : [],
            confidence: Number(
              (rc as Record<string, unknown>).confidence ?? 0.5,
            ),
          }
        : null;
    return {
      generated_at: String(insights.generated_at ?? ""),
      model: String(insights.model ?? "claude-haiku-4-5"),
      root_cause: normRootCause && normRootCause.label ? normRootCause : null,
      patterns: Array.isArray(insights.patterns) ? insights.patterns : [],
      red_flags: Array.isArray(insights.red_flags) ? insights.red_flags : [],
      top_hypotheses: Array.isArray(insights.top_hypotheses)
        ? insights.top_hypotheses
        : [],
      verify_in_session: Array.isArray(insights.verify_in_session)
        ? insights.verify_in_session
        : [],
      coach_notes_for_ai: String(insights.coach_notes_for_ai ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Update ONLY the coach_notes_for_ai sub-field — no AI call, no overwrite
 * of patterns / red_flags / top_hypotheses / verify_in_session. Coach edits
 * flow into every downstream AI call without losing the AI's own analysis.
 */
export async function updateInsightsCoachNotes(
  clientId: string,
  coachNotes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const root = getPlansRoot();
    const yamlPath = path.join(root, "clients", clientId, "client.yaml");
    let actualPath = yamlPath;
    let text: string;
    try {
      text = await fs.readFile(yamlPath, "utf8");
    } catch {
      actualPath = path.join(root, "clients", `${clientId}.yaml`);
      text = await fs.readFile(actualPath, "utf8");
    }
    const parsed = (yaml.load(text) as Record<string, unknown>) ?? {};
    const insights = (parsed.intake_insights as Record<string, unknown> | undefined) ?? null;
    if (!insights) {
      return {
        ok: false,
        error: "no intake_insights to edit — generate the AI summary first",
      };
    }
    insights.coach_notes_for_ai = coachNotes ?? "";
    parsed.intake_insights = insights;
    // dumpYaml so numeric-underscore chip strings (e.g. "30_60") stay quoted
    // for PyYAML — this rewrites the whole client.yaml, so a plain js-yaml
    // dump here would silently strip the quotes off intake chip fields.
    const dumped = dumpYaml(parsed, { sortKeys: false, lineWidth: 120 });
    await fs.writeFile(actualPath, dumped, "utf8");
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/intake-view`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

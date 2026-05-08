"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";

const FMDB_ROOT = path.resolve(process.cwd(), "..", "fm-database");
const WEB_ROOT = process.cwd();
const TIMEOUT_MS = 60_000;

export interface LifecycleResult {
  ok: boolean;
  error?: string | null;
  plan?: Record<string, unknown> | null;
  written_path?: string | null;
  git_sha?: string | null;
}

export interface DiffResult {
  ok: boolean;
  diff?: string | null;
  error?: string | null;
}

export interface RenderResult {
  ok: boolean;
  content?: string | null;
  error?: string | null;
}

interface LifecyclePayload {
  action: "submit" | "publish" | "revoke" | "supersede" | "diff";
  slug: string;
  by?: string;
  reason?: string;
  slug_b?: string;
  dry_run?: boolean;
}

function runShim<T = unknown>(
  scriptName: string,
  payload: unknown,
  timeoutMs: number = TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts", scriptName);
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      timer = null;
      resolve({ ok: false, error: String(err) } as T);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `${scriptName} exited ${code} with no stdout: ${stderr.slice(0, 500)}`,
        } as T);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (e) {
        resolve({
          ok: false,
          error: `failed to parse ${scriptName} output: ${e}\nstdout: ${stdout.slice(0, 500)}`,
        } as T);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function lifecycle(payload: LifecyclePayload): Promise<LifecycleResult> {
  return runShim<LifecycleResult>("plan-lifecycle.py", payload);
}

function bust(slug: string) {
  revalidatePath("/plans");
  revalidatePath(`/plans/${slug}`, "page");
}

export async function submitPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "submit", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function publishPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "publish", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function revokePlan(
  slug: string,
  reason: string
): Promise<LifecycleResult> {
  if (!reason || !reason.trim()) {
    return { ok: false, error: "Revoke requires a non-empty reason." };
  }
  const r = await lifecycle({ action: "revoke", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function supersedePlan(
  newSlug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "supersede", slug: newSlug, reason });
  if (r.ok) bust(newSlug);
  return r;
}

export async function diffPlans(
  slugA: string,
  slugB: string
): Promise<DiffResult> {
  const r = await lifecycle({ action: "diff", slug: slugA, slug_b: slugB });
  return { ok: r.ok, diff: (r as unknown as DiffResult).diff, error: r.error };
}

export async function renderPlan(
  slug: string,
  format: "markdown" | "html"
): Promise<RenderResult> {
  return runShim<RenderResult>("plan-render.py", { slug, format });
}

export async function renderLabOrders(
  slug: string,
  format: "markdown" | "html"
): Promise<RenderResult> {
  const plan = await loadPlanBySlug(slug);
  if (!plan) return { ok: false, error: `Plan ${slug} not found.` };

  interface LabOrder { test: string; reason?: string }
  const labs = (plan.lab_orders as LabOrder[] | undefined) ?? [];
  if (labs.length === 0) {
    return { ok: false, error: "No lab orders on this plan yet." };
  }

  const clientName = (plan.client_id as string | undefined) ?? "Client";
  const date = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  const md = [
    `# Lab Order Sheet — ${clientName}`,
    `*Prepared by Functional Health Coach Shivani Hari · ${date}*`,
    "",
    "Please get the following tests done **before your next session**.",
    "Go to a diagnostic lab of your choice (SRL, Dr Lal, Metropolis, or your local lab).",
    "",
    "---",
    "",
    "## Tests to order",
    "",
    ...labs.map((l: LabOrder) => {
      const reason = l.reason ? `\n  > *${l.reason}*` : "";
      return `- **${l.test}**${reason}`;
    }),
    "",
    "---",
    "",
    "**Important:**",
    "- Most tests require a **fasting blood draw** (10–12 hours, water only). Check with your lab.",
    "- If you have your period, note it on the requisition — some hormone tests need cycle-day context.",
    "- Share the soft copy report with me as soon as you receive it.",
    "",
    "*Questions? WhatsApp me directly.*",
  ].join("\n");

  if (format === "markdown") {
    return { ok: true, content: md };
  }

  // Simple HTML version
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lab Order Sheet — ${clientName}</title>
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 48px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  h2 { font-size: 1.15rem; margin-bottom: 12px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 10px; }
  li strong { font-size: 1rem; }
  .reason { display: block; color: #555; font-size: 0.875rem; font-style: italic; margin-top: 2px; }
  .note { background: #fafaf8; border: 1px solid #e5e5e0; border-radius: 6px; padding: 16px 20px; font-size: 0.9rem; }
  .note ul { margin: 8px 0 0 0; }
  @media print { body { margin: 24px; } }
</style>
</head>
<body>
  <h1>Lab Order Sheet — ${clientName}</h1>
  <p class="subtitle">Prepared by Functional Health Coach Shivani Hari &middot; ${date}</p>
  <p>Please get the following tests done <strong>before your next session</strong>.<br>
  Go to a diagnostic lab of your choice (SRL, Dr Lal, Metropolis, or your local lab).</p>
  <hr>
  <h2>Tests to order</h2>
  <ul>
    ${labs.map((l: LabOrder) => `<li><strong>${l.test}</strong>${l.reason ? `<span class="reason">${l.reason}</span>` : ""}</li>`).join("\n    ")}
  </ul>
  <hr>
  <div class="note">
    <strong>Important:</strong>
    <ul>
      <li>Most tests require a <strong>fasting blood draw</strong> (10–12 hours, water only). Check with your lab.</li>
      <li>If you have your period, note it on the requisition — some hormone tests need cycle-day context.</li>
      <li>Share the soft copy report with me as soon as you receive it.</li>
    </ul>
    <p style="margin-bottom:0"><em>Questions? WhatsApp me directly.</em></p>
  </div>
</body>
</html>`;

  return { ok: true, content: html };
}

/**
 * Create a successor draft plan from an existing published plan. Loads the
 * old plan, clones its YAML into drafts/<newSlug>.yaml with `supersedes`
 * pointing back at the old slug, status reset to draft, version reset to 0.
 *
 * The coach can then edit the new draft, run plan-check, submit, and
 * supersede via the published-state action panel on the NEW slug.
 */
export async function createSuccessor(
  oldSlug: string,
  newSlug: string
): Promise<{ ok: boolean; error?: string }> {
  if (!newSlug || !newSlug.trim()) {
    return { ok: false, error: "New slug is required." };
  }
  if (newSlug === oldSlug) {
    return { ok: false, error: "New slug must differ from old slug." };
  }
  const old = await loadPlanBySlug(oldSlug);
  if (!old) return { ok: false, error: `Plan ${oldSlug} not found.` };

  // Make sure the new slug is not already taken
  const existing = await loadPlanBySlug(newSlug);
  if (existing) return { ok: false, error: `Plan ${newSlug} already exists.` };

  const root = getPlansRoot();
  const draftsDir = path.join(root, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });

  // Clone, strip loader-only fields, reset lifecycle
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _bucket, _file, ...rest } = old;
  const successor: Record<string, unknown> = {
    ...rest,
    slug: newSlug,
    status: "draft",
    version: 0,
    supersedes: oldSlug,
    status_history: [],
    catalogue_snapshot: undefined,
  };
  // Use writePlan if it routes by status; otherwise write directly to drafts/
  try {
    await writePlan(successor as Parameters<typeof writePlan>[0]);
  } catch {
    // Fallback: write directly to drafts/<newSlug>.yaml
    const filePath = path.join(draftsDir, `${newSlug}.yaml`);
    await fs.writeFile(
      filePath,
      yaml.dump(successor, { noRefs: true, sortKeys: false }),
      "utf-8"
    );
  }
  bust(newSlug);
  revalidatePath("/plans");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Generate AI follow-up plan (next phase, adjusted from previous plan)
// ---------------------------------------------------------------------------

const FMDB_PLANS_DIR = process.env.FMDB_PLANS_DIR ?? `${process.env.HOME}/fm-plans`;

async function loadClientData(clientId: string): Promise<Record<string, unknown>> {
  try {
    const clientFile = path.join(FMDB_PLANS_DIR, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientFile, "utf-8");
    return (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export interface FollowUpResult {
  ok: boolean;
  newSlug?: string;
  adjustmentSummary?: string;
  error?: string;
}

/**
 * Clone old plan → run AI to adjust for next phase → save as new draft.
 * The AI reads the previous plan + check-in notes from notes_for_coach
 * and returns a patch (changed fields only) for the follow-up phase.
 */
export async function generateFollowUpPlan(
  oldSlug: string,
  newSlug: string,
  phaseWeeks: string,
  clientId: string
): Promise<FollowUpResult> {
  if (!newSlug?.trim()) return { ok: false, error: "New plan slug is required." };
  if (newSlug === oldSlug) return { ok: false, error: "New slug must differ from old slug." };

  const old = await loadPlanBySlug(oldSlug);
  if (!old) return { ok: false, error: `Plan ${oldSlug} not found.` };

  const existing = await loadPlanBySlug(newSlug);
  if (existing) return { ok: false, error: `Plan ${newSlug} already exists.` };

  const clientData = await loadClientData(clientId);

  // Strip loader-only fields
  const { _bucket, _file, ...oldRest } = old;
  void _bucket; void _file;

  // Call AI to generate adjustments
  const shimResult = await runShim("generate-follow-up.py", {
    old_plan_data: oldRest,
    client_data: clientData,
    new_slug: newSlug,
    phase_weeks: phaseWeeks,
    check_in_notes: "", // AI will extract from notes_for_coach
  }, 120_000);

  const result = shimResult as {
    ok: boolean;
    plan_patch?: Record<string, unknown>;
    adjustment_summary?: string;
    error?: string;
  };

  if (!result.ok) return { ok: false, error: result.error ?? "AI generation failed" };

  const patch = result.plan_patch ?? {};
  const summary = result.adjustment_summary ?? "";

  // Build successor: clone old plan + apply AI patch
  const today = new Date().toISOString().slice(0, 10);
  const successor: Record<string, unknown> = {
    ...oldRest,
    ...patch,
    slug: newSlug,
    status: "draft",
    version: 0,
    supersedes: oldSlug,
    status_history: [],
    catalogue_snapshot: undefined,
    updated_at: today,
    // Prepend AI summary to notes_for_coach
    notes_for_coach: summary
      ? `[Phase ${phaseWeeks} adjustments]\n${summary}\n\n---\n\n${(oldRest.notes_for_coach as string) ?? ""}`
      : (patch.notes_for_coach as string ?? (oldRest.notes_for_coach as string) ?? ""),
  };

  const root = getPlansRoot();
  const draftsDir = path.join(root, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });

  try {
    await writePlan(successor as Parameters<typeof writePlan>[0]);
  } catch {
    const filePath = path.join(draftsDir, `${newSlug}.yaml`);
    await fs.writeFile(
      filePath,
      yaml.dump(successor, { noRefs: true, sortKeys: false }),
      "utf-8"
    );
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${newSlug}`);
  return { ok: true, newSlug, adjustmentSummary: summary };
}

// ---------------------------------------------------------------------------
// Generate AI client letter (friendly, personalised, meal-plan + recipes)
// ---------------------------------------------------------------------------

export interface ClientLetterResult {
  ok: boolean;
  markdown?: string | null;
  html?: string | null;
  error?: string | null;
}

export interface WeightLossParams {
  enabled: boolean;
  goal_kg?: number;
  goal_weeks?: number;
  activity_level?: "sedentary" | "light" | "moderate" | "active";
  pace?: "slow" | "moderate" | "faster";
  exercise_current?: string;
  exercise_open_to?: string;
  exercise_days_per_week?: number;
  exercise_limitations?: string;
}

export interface RefinedLetterResult {
  ok: boolean;
  markdown?: string | null;
  html?: string | null;
  reply?: string | null;
  error?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function refineLetter(
  currentMarkdown: string,
  message: string,
  history: ChatTurn[],
  planSlug?: string,
  clientId?: string
): Promise<RefinedLetterResult> {
  const result = await runShim<RefinedLetterResult>(
    "refine-letter.py",
    {
      markdown: currentMarkdown,
      message,
      history,
      plan_slug: planSlug ?? "",
      client_id: clientId ?? "",
    },
    180_000
  );
  // Auto-save refined version to disk
  if (result.ok && result.markdown && planSlug && clientId) {
    await saveMealPlan(planSlug, clientId, result.markdown, result.html ?? null);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Meal plan persistence — save/load to clients/<id>/meal-plans/<slug>.md|html
// ---------------------------------------------------------------------------

export interface MealPlanData {
  ok: boolean;
  markdown?: string;
  html?: string;
  savedAt?: string;   // ISO timestamp of last save
  error?: string;
}

async function getMealPlanDir(clientId: string): Promise<string> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", clientId, "meal-plans");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export type LetterType = "consolidated" | "meal_plan" | "supplement_plan" | "lifestyle_guide";

/** File stem for a given letter type — consolidated keeps the bare planSlug for backwards compat. */
function letterFileStem(planSlug: string, letterType: LetterType): string {
  return letterType === "consolidated" ? planSlug : `${planSlug}-${letterType}`;
}

export async function saveMealPlan(
  planSlug: string,
  clientId: string,
  markdown: string,
  html: string | null,
  letterType: LetterType = "consolidated"
): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = await getMealPlanDir(clientId);
    const stem = letterFileStem(planSlug, letterType);
    await fs.writeFile(path.join(dir, `${stem}.md`), markdown, "utf-8");
    if (html) {
      await fs.writeFile(path.join(dir, `${stem}.html`), html, "utf-8");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadMealPlan(
  planSlug: string,
  clientId: string,
  letterType: LetterType = "consolidated"
): Promise<MealPlanData> {
  try {
    const root = getPlansRoot();
    const stem = letterFileStem(planSlug, letterType);
    const mdPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.md`);
    const htmlPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.html`);

    const markdown = await fs.readFile(mdPath, "utf-8");
    const stat = await fs.stat(mdPath);
    let html: string | undefined;
    try { html = await fs.readFile(htmlPath, "utf-8"); } catch { /* html optional */ }

    return { ok: true, markdown, html, savedAt: stat.mtime.toISOString() };
  } catch {
    return { ok: false };
  }
}

export async function generateClientLetter(
  planSlug: string,
  clientId: string,
  weightLoss?: WeightLossParams,
  letterType: LetterType = "consolidated",
  coachNotes?: string
): Promise<ClientLetterResult> {
  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      weight_loss: weightLoss ?? null,
      letter_type: letterType,
      coach_notes: coachNotes ?? "",
    },
    240_000   // 12-week plan is larger — 4 min ceiling
  );
  // Auto-save to disk so the coach can navigate away and come back
  if (result.ok && result.markdown) {
    await saveMealPlan(planSlug, clientId, result.markdown, result.html ?? null, letterType);
  }
  return result;
}

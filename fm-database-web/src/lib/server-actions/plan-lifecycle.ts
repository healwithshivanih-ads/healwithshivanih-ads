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
  if (r.ok) {
    bust(slug);
    // Fire plan-letter WhatsApp + queue +6h supplement nudge. Guarded by
    // FM_AUTO_PUBLISH_FOLLOWUPS so dev publishes don't spam clients.
    // Failures don't block the publish; they surface in logs.
    if (process.env.FM_AUTO_PUBLISH_FOLLOWUPS === "1") {
      try {
        await firePlanPublishFollowupsForSlug(slug);
      } catch (e) {
        console.warn(
          `[publish-followups] non-fatal failure for ${slug}: ${(e as Error).message}`,
        );
      }
    }
  }
  return r;
}

/** Look up client info for a freshly-published plan, then fire the
 *  follow-up sends. Separate function so the publishPlan happy-path
 *  stays linear and easy to read. */
async function firePlanPublishFollowupsForSlug(slug: string): Promise<void> {
  const { loadPlanBySlug, loadAllClients } = await import("@/lib/fmdb/loader");
  const plan = await loadPlanBySlug(slug);
  if (!plan) return;
  const clientId = plan.client_id;
  if (!clientId) return;
  const clients = await loadAllClients();
  const client = clients.find(
    (c) => (c as Record<string, unknown>).client_id === clientId,
  ) as Record<string, unknown> | undefined;
  if (!client) return;
  const phone = (client.mobile_number as string | undefined) ?? "";
  const displayName = (client.display_name as string | undefined) ?? clientId;
  if (!phone) {
    console.warn(`[publish-followups] no mobile_number for ${clientId}, skipping`);
    return;
  }
  const { firePlanPublishFollowups } = await import("./plan-publish-followups");
  const res = await firePlanPublishFollowups({
    clientId,
    planSlug: slug,
    displayName,
    phone,
  });
  if (res.errors.length > 0) {
    console.warn(`[publish-followups] ${slug}: ${res.errors.join("; ")}`);
  }
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

/**
 * Structured diff of two plan versions — replaces the unified-diff text
 * with section-grouped, field-by-field cards for the "Compare versions"
 * UI in the v2 plan editor.
 *
 * Reads both plans as YAML objects directly (no Python shim) and runs the
 * pure-TypeScript compareTwoPlanVersions() walker.
 */
import { compareTwoPlanVersions, type SectionDiff } from "@/lib/fmdb/plan-version-compare";

export interface ComparePlansResult {
  ok: boolean;
  sections?: SectionDiff[];
  error?: string;
}

export async function comparePlanVersions(
  slugA: string,
  slugB: string
): Promise<ComparePlansResult> {
  if (!slugA || !slugB) {
    return { ok: false, error: "Both plan slugs are required." };
  }
  if (slugA === slugB) {
    return { ok: false, error: "Plan A and Plan B must be different plans." };
  }
  const [a, b] = await Promise.all([loadPlanBySlug(slugA), loadPlanBySlug(slugB)]);
  if (!a) return { ok: false, error: `Plan A (${slugA}) not found.` };
  if (!b) return { ok: false, error: `Plan B (${slugB}) not found.` };
  const sections = compareTwoPlanVersions(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>
  );
  return { ok: true, sections };
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
/** "next_phase" = continue active care with adjustments (default).
 *  "maintenance" = graduation; lighter plan with anchored habits + quarterly
 *  check-ins. Branches the AI prompt to apply different rules. */
export type FollowUpIntent = "next_phase" | "maintenance";

export async function generateFollowUpPlan(
  oldSlug: string,
  newSlug: string,
  phaseWeeks: string,
  clientId: string,
  intent: FollowUpIntent = "next_phase",
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
    intent,
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
    // Prepend AI summary to notes_for_coach. Header reflects intent so
    // coach can scan and see whether this draft is a next-phase
    // continuation or a maintenance graduation.
    notes_for_coach: summary
      ? `[${intent === "maintenance" ? "Maintenance graduation" : `Next phase (${phaseWeeks})`} adjustments]\n${summary}\n\n---\n\n${(oldRest.notes_for_coach as string) ?? ""}`
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

export interface LetterValidationChange {
  original_tip: string;
  score: number;
  reason: string;
  rewrite?: string;
}

export interface ClientLetterResult {
  ok: boolean;
  markdown?: string | null;
  html?: string | null;
  validation_report?: LetterValidationChange[] | null;
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
  /** "discuss" — chat-only, no save. "finalise" — full rewrite + save. */
  mode?: "discuss" | "finalise";
  markdown?: string | null;
  html?: string | null;
  reply?: string | null;
  /** Pending-edits list maintained by the discuss prompt. Empty in finalise mode. */
  pending?: string[];
  /** True when we deliberately didn't write to disk (discuss reply, or
   *  finalise that came back too short to trust). */
  no_update?: boolean;
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
  clientId?: string,
  mode: "discuss" | "finalise" = "discuss",
): Promise<RefinedLetterResult> {
  const result = await runShim<RefinedLetterResult>(
    "refine-letter.py",
    {
      markdown: currentMarkdown,
      message,
      history,
      mode,
      plan_slug: planSlug ?? "",
      client_id: clientId ?? "",
    },
    180_000
  );
  // Only saves on finalise mode AND when a real document came back.
  if (
    result.ok &&
    result.mode === "finalise" &&
    result.markdown &&
    !result.no_update &&
    planSlug &&
    clientId
  ) {
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
  validationReport?: LetterValidationChange[];
  error?: string;
}

async function getMealPlanDir(clientId: string): Promise<string> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", clientId, "meal-plans");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export type LetterType =
  | "consolidated"
  | "meal_plan"
  | "meal_plan_phase"
  | "supplement_plan"
  | "lifestyle_guide"
  | "exercise_plan"
  // Standalone recipe pack — full ingredients + method for every ✦ dish.
  // Served publicly at /recipes/<planSlug>. Split out of the consolidated
  // letter (post-reformat) so the main letter stays under 7 pages.
  | "recipes";

/** File stem for a given letter type — consolidated keeps the bare planSlug for backwards compat.
 *  Phase letters get a -wk{start}-{end} suffix so each phase has its own file. */
function letterFileStem(
  planSlug: string,
  letterType: LetterType,
  phase?: { startWeek: number; endWeek: number } | null,
): string {
  if (letterType === "consolidated") return planSlug;
  if (letterType === "meal_plan_phase" && phase) {
    return `${planSlug}-meal_plan-wk${phase.startWeek}-${phase.endWeek}`;
  }
  return `${planSlug}-${letterType}`;
}

export async function saveMealPlan(
  planSlug: string,
  clientId: string,
  markdown: string,
  html: string | null,
  letterType: LetterType = "consolidated",
  validationReport?: LetterValidationChange[] | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = await getMealPlanDir(clientId);
    const stem = letterFileStem(planSlug, letterType);
    await fs.writeFile(path.join(dir, `${stem}.md`), markdown, "utf-8");
    if (html) {
      await fs.writeFile(path.join(dir, `${stem}.html`), html, "utf-8");
    }
    // Persist the Haiku QA report alongside the letter so the rewrites
    // survive a page reload. Empty/null report → delete any stale file.
    const reportPath = path.join(dir, `${stem}.validation.json`);
    if (validationReport && validationReport.length > 0) {
      await fs.writeFile(reportPath, JSON.stringify(validationReport, null, 2), "utf-8");
    } else {
      try { await fs.unlink(reportPath); } catch { /* not present is fine */ }
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
    const reportPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.validation.json`);

    const markdown = await fs.readFile(mdPath, "utf-8");
    const stat = await fs.stat(mdPath);
    let html: string | undefined;
    try { html = await fs.readFile(htmlPath, "utf-8"); } catch { /* html optional */ }

    let validationReport: LetterValidationChange[] | undefined;
    try {
      const raw = await fs.readFile(reportPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) validationReport = parsed as LetterValidationChange[];
    } catch { /* report optional — older letters won't have one */ }

    return { ok: true, markdown, html, savedAt: stat.mtime.toISOString(), validationReport };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Phase / continuation meal-plan letters — generate mid-cycle meal plan for
// weeks N–M of an active published plan WITHOUT creating a successor.
// Supplements + protocol stay locked; the AI just produces a fresh 7-day
// meal-plan grid for the requested phase.
// ---------------------------------------------------------------------------

export interface PhaseMealPlanData {
  ok: boolean;
  markdown?: string;
  html?: string;
  savedAt?: string;
  startWeek: number;
  endWeek: number;
  error?: string;
}

export interface SavedPhase {
  startWeek: number;
  endWeek: number;
  savedAt: string; // ISO mtime
}

/** Path stem helper exposed so the UI can build deep-links to a phase
 *  letter when needed. Internal to this module otherwise. */
function phaseStem(planSlug: string, startWeek: number, endWeek: number): string {
  return `${planSlug}-meal_plan-wk${startWeek}-${endWeek}`;
}

/**
 * Generate a phase meal-plan letter for the active plan. Same caching
 * pattern as generateClientLetter — cache hit returns existing file
 * unless forceRegenerate=true. Python letter_type="meal_plan_phase"
 * builds a focused prompt that references the active routine but only
 * outputs meal tables for the requested week range.
 */
export async function generatePhaseMealPlanAction(
  planSlug: string,
  clientId: string,
  startWeek: number,
  endWeek: number,
  coachNotes?: string,
  forceRegenerate = false,
): Promise<PhaseMealPlanData> {
  if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error: "startWeek and endWeek must be numbers",
    };
  }
  if (startWeek < 1 || endWeek < startWeek || endWeek - startWeek > 4) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error:
        "Phase must span 1–5 weeks. For a longer continuation, generate two phases.",
    };
  }

  const dir = await getMealPlanDir(clientId);
  const stem = phaseStem(planSlug, startWeek, endWeek);
  const mdPath = path.join(dir, `${stem}.md`);
  const htmlPath = path.join(dir, `${stem}.html`);

  // 1. Cache hit
  if (!forceRegenerate) {
    try {
      const cached = await fs.readFile(mdPath, "utf-8");
      let cachedHtml: string | undefined;
      try {
        cachedHtml = await fs.readFile(htmlPath, "utf-8");
      } catch {
        /* html optional */
      }
      const stat = await fs.stat(mdPath);
      return {
        ok: true,
        markdown: cached,
        html: cachedHtml,
        savedAt: stat.mtime.toISOString(),
        startWeek,
        endWeek,
      };
    } catch {
      /* cache miss — generate fresh */
    }
  }

  // 2. Fresh AI generation
  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      letter_type: "meal_plan_phase",
      phase_start: startWeek,
      phase_end: endWeek,
      coach_notes: coachNotes ?? "",
      weight_loss: null, // pulled from plan metadata if needed
    },
    600_000, // 10 min
  );

  if (!result.ok || !result.markdown) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error: result.error ?? "Phase letter generation failed",
    };
  }

  // 3. Persist md + html
  await fs.writeFile(mdPath, result.markdown, "utf-8");
  if (result.html) {
    await fs.writeFile(htmlPath, result.html, "utf-8");
  }
  const stat = await fs.stat(mdPath);

  revalidatePath(`/clients-v2/${clientId}/communicate`);
  return {
    ok: true,
    markdown: result.markdown,
    html: result.html ?? undefined,
    savedAt: stat.mtime.toISOString(),
    startWeek,
    endWeek,
  };
}

/**
 * List every saved phase meal-plan letter on disk for this plan.
 * Reads filenames matching `<planSlug>-meal_plan-wk{N}-{M}.md` and
 * pulls the mtime as savedAt. Sorted by start week ascending so the
 * UI can render in protocol order.
 */
export async function listSavedPhasesAction(
  planSlug: string,
  clientId: string,
): Promise<SavedPhase[]> {
  const dir = path.join(getPlansRoot(), "clients", clientId, "meal-plans");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  // Filename pattern: <planSlug>-meal_plan-wk<start>-<end>.md
  const re = new RegExp(
    `^${planSlug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}-meal_plan-wk(\\d+)-(\\d+)\\.md$`,
  );
  const out: SavedPhase[] = [];
  for (const name of entries) {
    const m = name.match(re);
    if (!m) continue;
    const startWeek = parseInt(m[1], 10);
    const endWeek = parseInt(m[2], 10);
    if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) continue;
    try {
      const stat = await fs.stat(path.join(dir, name));
      out.push({
        startWeek,
        endWeek,
        savedAt: stat.mtime.toISOString(),
      });
    } catch {
      /* skip if stat fails */
    }
  }
  out.sort((a, b) => a.startWeek - b.startWeek);
  return out;
}

// ---------------------------------------------------------------------------
// Letter staleness — has the plan been edited since the letter was saved?
// ---------------------------------------------------------------------------

export interface LetterStalenessEntry {
  type: LetterType;
  savedAt: string; // ISO
  stale: boolean;
}

export interface LetterStalenessResult {
  ok: true;
  anyStale: boolean;
  staleCount: number;
  entries: LetterStalenessEntry[];
  planUpdatedAt: string | null;
}

const ALL_LETTER_TYPES: LetterType[] = [
  "consolidated",
  "meal_plan",
  "supplement_plan",
  "lifestyle_guide",
  "exercise_plan",
  "recipes",
];

/**
 * For a given plan, walk all 5 letter file stems and check whether each saved
 * letter's mtime is older than the plan's updated_at. Returns the list of
 * existing letters with a stale flag per type.
 *
 * "Stale" = the plan YAML was edited after the letter was generated, so the
 * letter content no longer reflects the current plan. The coach should
 * regenerate before sending.
 */
export async function getLetterStalenessAction(
  planSlug: string,
  clientId: string,
): Promise<LetterStalenessResult> {
  const plan = await loadPlanBySlug(planSlug);
  const planUpdatedRaw =
    (plan?.updated_at as string | undefined) ??
    (plan?.created_at as string | undefined) ??
    null;
  const planUpdatedAt = planUpdatedRaw ? new Date(planUpdatedRaw).toISOString() : null;
  const planUpdatedMs = planUpdatedAt ? new Date(planUpdatedAt).getTime() : 0;

  const entries: LetterStalenessEntry[] = [];
  for (const t of ALL_LETTER_TYPES) {
    const data = await loadMealPlan(planSlug, clientId, t);
    if (!data.ok || !data.savedAt) continue;
    const savedMs = new Date(data.savedAt).getTime();
    entries.push({
      type: t,
      savedAt: data.savedAt,
      // Allow 2-second slack — saveMealPlan + plan write may race on the same
      // user action, and filesystem mtime resolution can produce a false
      // positive of < 1s. Real edits are typically minutes apart.
      stale: planUpdatedMs > 0 && savedMs + 2000 < planUpdatedMs,
    });
  }

  const staleCount = entries.filter((e) => e.stale).length;
  return {
    ok: true,
    anyStale: staleCount > 0,
    staleCount,
    entries,
    planUpdatedAt,
  };
}

/**
 * Pull the content of one section out of a consolidated markdown letter.
 * Section markers look like:
 *   <!-- SECTION_BEGIN: meal_plan -->
 *   ...content...
 *   <!-- SECTION_END: meal_plan -->
 * Returns the inner content trimmed, or null if the markers aren't present.
 */
function extractSectionFromConsolidated(md: string, section: string): string | null {
  // [\s\S] = "any char including newline" (no /s flag in this TS target)
  const re = new RegExp(
    `<!--\\s*SECTION_BEGIN:\\s*${section}\\s*-->([\\s\\S]*?)<!--\\s*SECTION_END:\\s*${section}\\s*-->`,
    "i",
  );
  const m = md.match(re);
  if (!m) return null;
  const inner = m[1].trim();
  return inner.length > 20 ? inner : null;
}

const PARTIAL_TYPES: Exclude<LetterType, "consolidated">[] = [
  "meal_plan",
  "supplement_plan",
  "lifestyle_guide",
];

/**
 * Generate (or return cached) a letter for one of the four types.
 *
 * Cross-reference rules:
 *   - If the requested file already exists on disk → return it (cache hit, no AI call).
 *   - Requested partial AND consolidated exists with section markers → extract
 *     the relevant section, save as the partial, return without AI call.
 *   - Requested consolidated AND any partials exist → load them and pass into
 *     the AI prompt as "use verbatim" instructions for those sections.
 *   - Otherwise → fresh AI generation.
 *
 * After a fresh consolidated generation, the rendered markdown is also scanned
 * for section markers and any extractable section is saved as a sidecar
 * partial file — keeping the four documents in sync automatically.
 */
export async function generateClientLetter(
  planSlug: string,
  clientId: string,
  weightLoss?: WeightLossParams,
  letterType: LetterType = "consolidated",
  coachNotes?: string,
  forceRegenerate = false,
): Promise<ClientLetterResult & { fromCache?: boolean; extractedFromConsolidated?: boolean }> {
  const dir = await getMealPlanDir(clientId);
  const stem = letterFileStem(planSlug, letterType);
  const targetMdPath = path.join(dir, `${stem}.md`);

  // 1. Cache hit — file already on disk. (Skipped when forceRegenerate=true.)
  if (!forceRegenerate) {
    try {
      const cached = await fs.readFile(targetMdPath, "utf-8");
      let cachedHtml: string | null = null;
      try { cachedHtml = await fs.readFile(path.join(dir, `${stem}.html`), "utf-8"); } catch { /* missing html is ok */ }
      return { ok: true, markdown: cached, html: cachedHtml ?? undefined, fromCache: true };
    } catch { /* not in cache, continue */ }
  }

  // 2. Cross-reference: requested partial, consolidated already exists with markers.
  // Skipped when forceRegenerate=true so the AI rebuilds the partial from scratch.
  if (!forceRegenerate && letterType !== "consolidated") {
    const consolidatedPath = path.join(dir, `${planSlug}.md`);
    try {
      const consolidatedMd = await fs.readFile(consolidatedPath, "utf-8");
      const extracted = extractSectionFromConsolidated(consolidatedMd, letterType);
      if (extracted) {
        await saveMealPlan(planSlug, clientId, extracted, null, letterType);
        return {
          ok: true,
          markdown: extracted,
          extractedFromConsolidated: true,
        };
      }
    } catch { /* consolidated doesn't exist or unreadable — fall through */ }
  }

  // 3. Cross-reference: generating consolidated, partials exist. Load them.
  // Always done (even when forceRegenerate=true) — consolidated still
  // benefits from finalised partial content.
  let existingPartials: Record<string, string> = {};
  let hasExercisePlan = false;
  if (letterType === "consolidated") {
    for (const partial of PARTIAL_TYPES) {
      const partialPath = path.join(dir, `${planSlug}-${partial}.md`);
      try {
        const md = await fs.readFile(partialPath, "utf-8");
        if (md.trim().length > 0) existingPartials[partial] = md;
      } catch { /* missing partial is fine */ }
    }
    // exercise_plan is NOT a partial (different content from consolidated's
    // simple inline schedule) — but we tell the AI whether one exists so it
    // can add the "See your detailed exercise plan" cross-reference.
    try {
      const exPath = path.join(dir, `${planSlug}-exercise_plan.md`);
      const exMd = await fs.readFile(exPath, "utf-8");
      hasExercisePlan = exMd.trim().length > 0;
    } catch { /* no exercise plan */ }
  }

  // 4. Fresh AI generation.
  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      weight_loss: weightLoss ?? null,
      letter_type: letterType,
      coach_notes: coachNotes ?? "",
      existing_partials: existingPartials,
      has_exercise_plan: hasExercisePlan,
    },
    600_000, // 10-min ceiling — Sonnet streaming on a 12-week plan can run 3–5 min
  );

  if (!result.ok || !result.markdown) return result;

  // 5. Persist the requested file (with validation report sidecar).
  await saveMealPlan(
    planSlug,
    clientId,
    result.markdown,
    result.html ?? null,
    letterType,
    result.validation_report ?? null,
  );

  // 6. After a successful consolidated generation, extract each section and
  // save as a sidecar partial — keeps the four docs in sync.
  if (letterType === "consolidated") {
    for (const partial of PARTIAL_TYPES) {
      const extracted = extractSectionFromConsolidated(result.markdown, partial);
      if (extracted) {
        try { await saveMealPlan(planSlug, clientId, extracted, null, partial); } catch { /* best-effort */ }
      }
    }
  }

  return result;
}


// ---------------------------------------------------------------------------
// v0.73 — Letter inline section extraction.
//
// The plan tab's GeneratedLettersPanel now embeds each week's meal grid +
// the supplement schedule directly in collapsible iframes (no detour to a
// new tab). This action reads the saved branded HTML once and reports the
// section IDs present so the client component can render one iframe per
// section, each scoped via `body[data-print-week="N"]` or
// `body[data-print-supplement]` to leverage the existing brand-CSS
// isolation rules in scripts/brand_html.py.
//
// Returns the full HTML untouched. The client component injects the body
// attribute per iframe at render time — see plan/letter-inline-viewer.tsx.
// ---------------------------------------------------------------------------

/**
 * One slot in the inline viewer — either a week (with its source HTML
 * for the iframe srcdoc) or the supplement schedule. `sourceLabel` is a
 * coach-readable tag like "consolidated" / "weeks 3–4 phase letter" so
 * the UI can show provenance per section.
 */
export interface LetterWeekSource {
  weekNumber: number;             // 1, 2, 3, …
  html: string;                   // the full HTML doc this week lives in
  sourceLabel: string;            // "consolidated" | "phase weeks 3–4" | …
  savedAt: string;                // ISO mtime of the source file
}

export interface LetterSupplementsSource {
  html: string;                   // typically from the consolidated letter
  sourceLabel: string;
  savedAt: string;
}

export interface LetterSectionsResult {
  ok: boolean;
  /** All week-N sections aggregated from consolidated + every phase letter,
   *  deduped so each weekNumber appears at most once (phase letter wins on
   *  conflict — it's the more recent / specific edit). Sorted ascending. */
  weekSources?: LetterWeekSource[];
  supplements?: LetterSupplementsSource | null;
  /** When `ok=false` AND the consolidated letter exists as markdown-only,
   *  caller can still link out. */
  consolidatedSavedAt?: string;
  error?: string;
}

/**
 * Helper — extract week IDs (1, 2, …) present in a letter HTML string by
 * scanning for `id="print-week-N"` anchors emitted by brand_html.py.
 */
function extractWeekIds(html: string): number[] {
  return Array.from(
    new Set(
      Array.from(html.matchAll(/id="print-week-(\d+)"/g)).map((m) => parseInt(m[1], 10)),
    ),
  )
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export async function getLetterSectionsAction(
  planSlug: string,
  clientId: string,
  letterType: LetterType = "consolidated",
): Promise<LetterSectionsResult> {
  // 1. Load the primary letter (consolidated, by default). This is the
  //    canonical source of the supplement schedule + weeks 1-2.
  const primary = await loadMealPlan(planSlug, clientId, letterType);
  if (!primary.ok || !primary.html) {
    return {
      ok: false,
      error: primary.ok ? "No HTML letter saved (markdown-only)" : "Letter not found",
      consolidatedSavedAt: primary.savedAt,
    };
  }

  // 2. Seed weekSources from the consolidated letter.
  const weekMap = new Map<number, LetterWeekSource>();
  for (const n of extractWeekIds(primary.html)) {
    weekMap.set(n, {
      weekNumber: n,
      html: primary.html,
      sourceLabel: "consolidated letter",
      savedAt: primary.savedAt ?? "",
    });
  }

  // 3. Discover phase letters (weeks 3-4, 5-6, …) and merge their week
  //    HTMLs in. Phase letters live on disk as
  //    `{planSlug}-meal_plan-wk{N}-{M}.html` — read each one directly so
  //    we don't have to special-case loadMealPlan's phase signature.
  try {
    const phases = await listSavedPhasesAction(planSlug, clientId);
    const dir = path.join(getPlansRoot(), "clients", clientId, "meal-plans");
    for (const phase of phases) {
      const stem = `${planSlug}-meal_plan-wk${phase.startWeek}-${phase.endWeek}`;
      const htmlPath = path.join(dir, `${stem}.html`);
      let phaseHtml: string;
      try {
        phaseHtml = await fs.readFile(htmlPath, "utf-8");
      } catch {
        // No HTML for this phase (markdown-only generation) — skip.
        continue;
      }
      const label = `phase ${phase.startWeek}–${phase.endWeek}`;
      for (const n of extractWeekIds(phaseHtml)) {
        // Phase letter wins over consolidated for the same week (phase
        // letters are the most recent / targeted regeneration).
        weekMap.set(n, {
          weekNumber: n,
          html: phaseHtml,
          sourceLabel: label,
          savedAt: phase.savedAt,
        });
      }
    }
  } catch (e) {
    // Phase-discovery failure is non-fatal — coach still gets weeks 1-2.
    console.error("getLetterSectionsAction: phase discovery failed", e);
  }

  // 4. Supplements section — comes from the consolidated letter only.
  //    Phase letters intentionally don't restate the schedule (it
  //    shouldn't drift between phases).
  const supplements: LetterSupplementsSource | null = /id="supplement-schedule"/.test(primary.html)
    ? {
        html: primary.html,
        sourceLabel: "consolidated letter",
        savedAt: primary.savedAt ?? "",
      }
    : null;

  const weekSources = Array.from(weekMap.values()).sort(
    (a, b) => a.weekNumber - b.weekNumber,
  );

  return {
    ok: true,
    weekSources,
    supplements,
    consolidatedSavedAt: primary.savedAt,
  };
}

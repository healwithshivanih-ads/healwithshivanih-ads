"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type { Plan, PlanPatch } from "@/lib/fmdb/types";
import { runShim } from "@/lib/fmdb/shim";

// ─── Supplement sources ────────────────────────────────────────────────────────

export interface SupplementSource {
  brand?: string;
  url?: string;
  code?: string;
  vitaone_ref?: string;
}

export type SupplementSourcesMap = Record<string, SupplementSource>;

function supplementSourcesPath(): string {
  return path.join(getPlansRoot(), "supplement-sources.yaml");
}

export async function loadSupplementSources(): Promise<SupplementSourcesMap> {
  try {
    const raw = await fs.readFile(supplementSourcesPath(), "utf-8");
    return (yaml.load(raw) as SupplementSourcesMap) ?? {};
  } catch {
    return {};
  }
}

/**
 * Merge updates into the shared supplement-sources.yaml.
 * Only the keys present in `updates` are touched; others are preserved.
 */
export async function saveSupplementSources(
  updates: SupplementSourcesMap
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const current = await loadSupplementSources();
    const merged = { ...current };
    for (const [slug, src] of Object.entries(updates)) {
      merged[slug] = { ...(current[slug] ?? {}), ...src };
    }
    await fs.writeFile(supplementSourcesPath(), yaml.dump(merged, { sortKeys: true }), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface PlanCheckFinding {
  severity: "CRITICAL" | "WARNING" | "INFO";
  section: string;
  field: string;
  detail: string;
  target: string;
  ack_id: string;
}

export interface PlanCheckResult {
  ok: boolean;
  slug?: string;
  findings?: PlanCheckFinding[];
  counts?: { CRITICAL: number; WARNING: number; INFO: number };
  error?: string | null;
}

const FMDB_ROOT = path.resolve(process.cwd(), "..", "fm-database");
const WEB_ROOT = process.cwd();

/**
 * Shell out to `scripts/plan-check.py` (which imports fmdb.plan.checker
 * directly) and parse its JSON output. Same shim pattern Agent B used for
 * scripts/assess.py last turn — keeps fm-database/ Python untouched.
 */
export async function runPlanCheck(slug: string): Promise<PlanCheckResult> {
  return new Promise((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts/plan-check.py");
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => resolve({ ok: false, error: String(err) }));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        resolve({
          ok: false,
          error: `plan-check.py exited ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PlanCheckResult;
        resolve(parsed);
      } catch (e) {
        resolve({
          ok: false,
          error: `failed to parse plan-check.py output: ${e}\nstdout: ${stdout.slice(0, 500)}`,
        });
      }
    });

    child.stdin.write(JSON.stringify({ slug }));
    child.stdin.end();
  });
}

/**
 * Apply a partial patch to a plan and persist. Always loads the current
 * canonical plan first so concurrent edits to other fields don't get
 * clobbered by a stale client snapshot.
 *
 * Lock: refuses to write if the plan's current on-disk status is anything
 * other than "draft". Lifecycle transitions (submit/publish/revoke) are
 * intentionally only available via the Python CLI for now.
 */
export async function updatePlan(
  slug: string,
  patch: PlanPatch
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await loadPlanBySlug(slug);
  if (!current) return { ok: false, error: `Plan ${slug} not found` };

  const status = current.status ?? current._bucket;
  if (status !== "draft") {
    return {
      ok: false,
      error: `Plan is ${status} — only drafts are editable from the web UI. Use the Python CLI for lifecycle transitions.`,
    };
  }

  // Drop the loader-only fields before writing
  const { _bucket, _file, ...rest } = current;
  void _bucket;
  void _file;

  const next: Plan = { ...rest, ...patch, slug } as Plan;
  await writePlan(next);

  revalidatePath(`/plans/${slug}`);
  revalidatePath("/plans");
  return { ok: true };
}

/**
 * Update only the client's effective start dates. Bypasses the draft-only
 * gate in updatePlan() — coach typically learns these AFTER publishing, when
 * the client confirms "actually started supplements on the 24th". Touches
 * NOTHING else on the plan so we can't accidentally rewrite a published
 * record. Both fields are nullable (pass null to clear back to the default
 * +3d / +7d assumption).
 *
 * See lib/fmdb/plan-timing.ts for how these flow into the effective recheck
 * date used by the dashboard / calendar / coach-nudges.
 */
export async function updatePlanStartDates(
  slug: string,
  patch: {
    meal_plan_started_on?: string | null;     // YYYY-MM-DD or null to clear
    supplements_started_on?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await loadPlanBySlug(slug);
  if (!current) return { ok: false, error: `Plan ${slug} not found` };

  // Drop the loader-only fields before writing
  const { _bucket, _file, ...rest } = current;
  void _bucket;
  void _file;

  const next: Plan = { ...rest, slug } as Plan;
  if ("meal_plan_started_on" in patch) {
    (next as unknown as Record<string, unknown>).meal_plan_started_on =
      patch.meal_plan_started_on || null;
  }
  if ("supplements_started_on" in patch) {
    (next as unknown as Record<string, unknown>).supplements_started_on =
      patch.supplements_started_on || null;
  }
  (next as unknown as Record<string, unknown>).updated_at = new Date().toISOString();

  await writePlan(next);

  revalidatePath(`/plans/${slug}`);
  revalidatePath("/plans");
  // Also revalidate the client-facing pages that show recheck dates
  if (current.client_id) {
    revalidatePath(`/clients-v2/${current.client_id}`);
    revalidatePath(`/clients-v2/${current.client_id}/plan`);
    // Letters screen reads meal_plan_started_on for its fortnight cards.
    revalidatePath(`/clients-v2/${current.client_id}/communicate`);
  }
  revalidatePath("/dashboard-v2");
  revalidatePath("/calendar");
  return { ok: true };
}

/**
 * Like updatePlan but also allows ready_to_publish plans — reverts them to draft
 * so the coach can continue editing via chat. Published/revoked/superseded are blocked.
 */
export async function updatePlanForChat(
  slug: string,
  patch: PlanPatch
): Promise<{ ok: true; revertedToDraft?: boolean } | { ok: false; error: string }> {
  const current = await loadPlanBySlug(slug);
  if (!current) return { ok: false, error: `Plan ${slug} not found` };

  const status = (current.status ?? current._bucket) as string;
  const editableStatuses = ["draft", "ready_to_publish", "ready"];
  if (!editableStatuses.includes(status)) {
    return {
      ok: false,
      error: `Plan is ${status} — only draft and ready-to-publish plans can be edited via chat.`,
    };
  }

  const { _bucket, _file, ...rest } = current;
  void _bucket;
  void _file;

  const revertedToDraft = status !== "draft";
  const next: Plan = {
    ...rest,
    ...patch,
    slug,
    // Revert to draft if currently in ready_to_publish
    ...(revertedToDraft ? { status: "draft" } : {}),
  } as Plan;

  await writePlan(next);
  revalidatePath(`/plans/${slug}`);
  revalidatePath("/plans");
  return { ok: true, revertedToDraft };
}

// ---------------------------------------------------------------------------
// Supplement interaction checker
// ---------------------------------------------------------------------------

export interface SupplementInteraction {
  supplement_slug: string;
  supplement_name: string;
  contraindication_text: string;
  matched_medications: string[];
}

export interface SupplementInteractionsResult {
  ok: boolean;
  interactions: SupplementInteraction[];
  /**
   * Drug-derived protocol cautions surfaced from the drug_depletions
   * catalogue. v0.74: when a client's medication matches a drug entry,
   * each of its `protocol_cautions[]` entries lands here so the plan-
   * editor banner + plan-check sidebar can render them.
   */
  drug_cautions?: DrugCaution[];
  error?: string;
}

export interface DrugCaution {
  drug_slug: string;
  drug_name: string;
  matched_medication: string;          // the client med string that matched
  kind: string;                        // CautionKind enum value
  severity: "critical" | "warning" | "info";
  item: string;                        // free-text constraint
  reason: string;
}

/**
 * For each supplement in the plan, load its catalogue entry and check whether
 * any of the client's medications appear in the supplement's contraindications.
 * Uses case-insensitive substring matching.
 */
export async function checkSupplementInteractionsAction(
  planSlug: string
): Promise<SupplementInteractionsResult> {
  try {
    const plan = await loadPlanBySlug(planSlug);
    if (!plan) return { ok: false, interactions: [], error: `Plan ${planSlug} not found` };

    const clientId = plan.client_id as string | undefined;
    if (!clientId) return { ok: true, interactions: [] };

    // Load client to get medications
    const clientFile = path.join(
      getPlansRoot(),
      "clients",
      clientId,
      "client.yaml"
    );
    let clientData: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(clientFile, "utf-8");
      clientData = (yaml.load(raw) as Record<string, unknown>) ?? {};
    } catch {
      return { ok: true, interactions: [] }; // no client file — can't check
    }

    const medications: string[] = [
      ...((clientData.medications as string[] | undefined) ?? []),
      ...((clientData.current_medications as string[] | undefined) ?? []),
    ];
    if (medications.length === 0) return { ok: true, interactions: [] };

    // Load each supplement from catalogue
    interface SupplementItem { supplement_slug: string }
    const supplements = (plan.supplement_protocol as SupplementItem[] | undefined) ?? [];
    const catalogueDir = path.join(
      path.resolve(process.cwd(), "..", "fm-database", "data"),
      "supplements"
    );

    const interactions: SupplementInteraction[] = [];

    await Promise.all(
      supplements.map(async (s) => {
        const slug = s.supplement_slug;
        if (!slug) return;

        let suppData: Record<string, unknown> | null = null;
        try {
          const raw = await fs.readFile(path.join(catalogueDir, `${slug}.yaml`), "utf-8");
          suppData = yaml.load(raw) as Record<string, unknown>;
        } catch {
          return; // supplement not in catalogue — skip
        }
        if (!suppData) return;

        const contraindications = suppData.contraindications;
        if (!contraindications) return;

        // Build a text blob for substring matching
        let contraindicationText = "";
        const matchedMeds: string[] = [];

        if (typeof contraindications === "string") {
          contraindicationText = contraindications;
        } else if (typeof contraindications === "object") {
          const c = contraindications as Record<string, unknown>;
          const parts: string[] = [];
          if (Array.isArray(c.conditions)) parts.push(...(c.conditions as string[]));
          if (Array.isArray(c.medications)) parts.push(...(c.medications as string[]));
          if (Array.isArray(c.life_stages)) parts.push(...(c.life_stages as string[]));
          // Also handle plain string fields
          if (typeof c.conditions === "string") parts.push(c.conditions);
          if (typeof c.medications === "string") parts.push(c.medications);
          contraindicationText = parts.join("; ");
        }

        if (!contraindicationText) return;

        const lowerText = contraindicationText.toLowerCase();
        for (const med of medications) {
          if (!med) continue;
          const normalised = med.toLowerCase().replace(/\s*\d+\s*mg.*/i, "").trim();
          if (normalised.length < 3) continue;
          if (lowerText.includes(normalised)) {
            matchedMeds.push(med);
          }
        }

        if (matchedMeds.length > 0) {
          interactions.push({
            supplement_slug: slug,
            supplement_name: (suppData.display_name as string | undefined) ?? slug,
            contraindication_text: contraindicationText,
            matched_medications: matchedMeds,
          });
        }
      })
    );

    // ── v0.74: drug_depletions → protocol_cautions pass ──
    // Match every client medication against the drug catalogue (alias-aware)
    // and surface each drug's protocol_cautions. The plan editor renders
    // these alongside supplement-contraindication interactions; the meal-
    // plan generator binds them as hard prompt constraints.
    const drugCautions: DrugCaution[] = [];
    try {
      const drugDir = path.join(
        path.resolve(process.cwd(), "..", "fm-database", "data"),
        "drug_depletions",
      );
      const drugFiles = await fs.readdir(drugDir).catch(() => [] as string[]);
      const drugs: Array<{
        slug: string;
        drug_name: string;
        drug_aliases?: string[];
        protocol_cautions?: Array<{
          kind?: string;
          item?: string;
          severity?: string;
          reason?: string;
        }>;
      }> = [];
      for (const fn of drugFiles) {
        if (!fn.endsWith(".yaml") || fn.startsWith("_")) continue;
        try {
          const raw = await fs.readFile(path.join(drugDir, fn), "utf-8");
          const d = yaml.load(raw) as Record<string, unknown>;
          if (d && typeof d === "object") drugs.push(d as never);
        } catch {
          /* skip unreadable */
        }
      }

      // Longest-alias-wins match (avoid 'metformin' inside 'metformin xr'
      // picking the shorter alias when a more specific one exists).
      const matchDrug = (medText: string) => {
        const lower = medText.toLowerCase();
        let best: { len: number; drug: (typeof drugs)[number] } | null = null;
        for (const d of drugs) {
          const aliases = [d.drug_name, ...(d.drug_aliases ?? [])]
            .filter(Boolean)
            .map((a) => String(a).toLowerCase().trim())
            .filter((a) => a.length > 0);
          for (const a of aliases) {
            if (lower.includes(a) && (!best || a.length > best.len)) {
              best = { len: a.length, drug: d };
            }
          }
        }
        return best?.drug ?? null;
      };

      const seen = new Set<string>(); // dedup (drug_slug, item) pairs
      for (const med of medications) {
        if (!med || med.trim().length < 3) continue;
        const drug = matchDrug(med);
        if (!drug) continue;
        for (const c of drug.protocol_cautions ?? []) {
          const item = (c.item ?? "").trim();
          if (!item) continue;
          const key = `${drug.slug}::${item}`;
          if (seen.has(key)) continue;
          seen.add(key);
          drugCautions.push({
            drug_slug: drug.slug,
            drug_name: drug.drug_name,
            matched_medication: med,
            kind: c.kind ?? "info",
            severity: (c.severity as "critical" | "warning" | "info") ?? "warning",
            item,
            reason: c.reason ?? "",
          });
        }
      }
    } catch (e) {
      console.error("[plans] drug_depletions caution pass failed:", e);
    }

    return { ok: true, interactions, drug_cautions: drugCautions };
  } catch (e) {
    return { ok: false, interactions: [], error: String(e) };
  }
}

// ─── Custom protocol template saving ──────────────────────────────────────────

export interface SaveAsTemplateInput {
  planSlug: string;
  templateName: string;
  description?: string;
  icon?: string;
  tags?: string[];
}

export type SaveAsTemplateResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

/**
 * Save a published plan as a reusable coach template.
 * Copies topics, symptoms, supplement_protocol, lifestyle_practices, nutrition.
 * Saves to ~/fm-plans/custom_templates/{slug}.yaml.
 */
export async function saveAsTemplateAction(
  input: SaveAsTemplateInput
): Promise<SaveAsTemplateResult> {
  try {
    const plan = await loadPlanBySlug(input.planSlug);
    if (!plan) return { ok: false, error: `Plan ${input.planSlug} not found` };

    const status = plan.status ?? plan._bucket;
    if (status !== "published") {
      return { ok: false, error: "Only published plans can be saved as templates." };
    }

    // Slugify the template name
    const templateSlug = input.templateName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    if (!templateSlug) return { ok: false, error: "Template name is required" };

    const templatesDir = path.join(getPlansRoot(), "custom_templates");
    await fs.mkdir(templatesDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);

    const template: Record<string, unknown> = {
      slug: templateSlug,
      display_name: input.templateName,
      description: input.description?.trim() || "",
      icon: input.icon?.trim() || "📋",
      tags: input.tags ?? [],
      source_plan: input.planSlug,
      created_at: today,
    };

    // Copy protocol fields (strip client-specific notes where possible)
    if (plan.topics)                template.topics                = plan.topics;
    if (plan.symptoms)              template.symptoms              = plan.symptoms;
    if (plan.supplement_protocol)   template.supplement_protocol   = plan.supplement_protocol;
    if (plan.lifestyle_practices)   template.lifestyle_practices   = plan.lifestyle_practices;
    if (plan.nutrition)             template.nutrition             = plan.nutrition;

    const outPath = path.join(templatesDir, `${templateSlug}.yaml`);
    await fs.writeFile(outPath, yaml.dump(template, { noRefs: true, sortKeys: false }), "utf8");

    return { ok: true, slug: templateSlug };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/**
 * Permanently delete a plan file from disk.
 * Published plans cannot be deleted — use Revoke instead.
 */
export async function deletePlan(
  slug: string
): Promise<{ ok: false; error: string } | never> {
  const plan = await loadPlanBySlug(slug);
  if (!plan) return { ok: false, error: `Plan ${slug} not found` };

  const status = plan.status ?? plan._bucket;
  if (status === "published") {
    return {
      ok: false,
      error: "Published plans cannot be deleted. Use Revoke instead.",
    };
  }

  await fs.unlink(plan._file);
  revalidatePath("/plans");
  // redirect() throws internally — it must not be inside try/catch
  redirect("/plans");
}

// ─── Client-facing start-date confirmation token (/start/<token>) ──────────
//
// Pattern C of the brainstormed three-pattern approach to capturing the
// client's actual meal-plan start date: a tokenised public link, no auth, no
// WhatsApp webhook needed. Companion shim is scripts/start-date-action.py.
// Mirrors the intake-token pattern but the token lives on the Plan (one
// confirmation per plan) rather than the Client.

const START_DATE_SCRIPT = "start-date-action.py";
const FMDB_REPO = path.resolve(process.cwd(), "..", "fm-database");
const PYTHON_BIN = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

async function runStartDateScript(payload: unknown, timeoutMs = 15_000): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, START_DATE_SCRIPT);
  const child = execFile(PYTHON_BIN, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
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
    throw new Error(`start-date-action produced no output. stderr: ${stderr.slice(0, 600)}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`start-date-action returned invalid JSON: ${stdout.slice(0, 400)}`);
  }
}

export type StartDateLookupOk = {
  ok: true;
  plan_slug: string;
  client_id: string;
  display_name: string;
  plan_period_start: string | null;
  plan_period_weeks: number | null;
  current_meal_plan_started_on: string | null;
  default_meal_plan_start: string | null;
};
export type StartDateLookupErr = { ok: false; error: string; message?: string };

export async function generateStartConfirmToken(
  planSlug: string,
  ttlDays = 14,
): Promise<
  { ok: true; token: string; url_path: string; expires_at: string } | { ok: false; error: string }
> {
  try {
    const res = (await runStartDateScript({
      action: "generate",
      plan_slug: planSlug,
      ttl_days: ttlDays,
    })) as
      | { ok: true; token: string; url_path: string; expires_at: string }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function lookupStartConfirmToken(
  token: string,
): Promise<StartDateLookupOk | StartDateLookupErr> {
  try {
    const res = (await runStartDateScript({
      action: "lookup",
      token,
    })) as StartDateLookupOk | StartDateLookupErr;
    return res;
  } catch (e) {
    return { ok: false, error: "script_error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Client-facing confirmation. Writes meal_plan_started_on + marks the token
 * used in one Python call, then calls the existing updatePlanStartDates to
 * fire the normal revalidation paths (dashboard / calendar / client overview).
 */
export async function confirmStartDate(
  token: string,
  date: string,
): Promise<
  | { ok: true; plan_slug: string; client_id: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await runStartDateScript({
      action: "confirm",
      token,
      date,
    })) as
      | { ok: true; plan_slug: string; client_id: string; confirmed_date: string }
      | { ok: false; error: string };
    if (!res.ok) return res;

    // Mirror the update through updatePlanStartDates so the standard
    // revalidation set (clients-v2, dashboard-v2, calendar) fires. The shim
    // already wrote the value; this call is idempotent on the YAML side.
    await updatePlanStartDates(res.plan_slug, {
      meal_plan_started_on: date,
    });

    return { ok: true, plan_slug: res.plan_slug, client_id: res.client_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeStartConfirmToken(
  planSlug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = (await runStartDateScript({
      action: "revoke",
      plan_slug: planSlug,
    })) as { ok: true } | { ok: false; error: string };
    if (res.ok) {
      revalidatePath(`/plans/${planSlug}`);
    }
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Recipe library (Phase 1) ──────────────────────────────────────────────
// Data layer for the plan-editor recipe picker + the mobile-app export.
// Pinning itself writes through the existing updatePlan path — nutrition.recipes
// is now a real NutritionPlan field, so no new write action is needed.

export interface RecipeCard {
  slug: string;
  name: string;
  meal_type: string[];
  diet: string[];
  seasons: string[];
  balances_dosha: string[];
  one_line: string;
  kcal: number | null;
  has_image: boolean;
  image_cleared: boolean; // true only if a licensed/original photo is attached
  source: string;
}

export interface ListRecipesFilter {
  search?: string;
  meal_type?: string; // breakfast|lunch|dinner|snack|side|drink
  diet?: string; // vegetarian|vegan|jain|...
  dosha?: string; // vata|pitta|kapha (matches balances_dosha)
  season?: string; // spring|summer|monsoon|autumn|winter
  slugs?: string[]; // restrict to these slugs (e.g. to hydrate already-pinned)
}

/** Search/filter the recipe library for the plan-editor recipe picker. */
export async function listRecipesAction(
  filter: ListRecipesFilter = {},
): Promise<{ ok: boolean; recipes: RecipeCard[]; total: number; error?: string }> {
  try {
    return (await runShim("list-recipes.py", filter, 30_000)) as {
      ok: boolean;
      recipes: RecipeCard[];
      total: number;
    };
  } catch (e) {
    return {
      ok: false,
      recipes: [],
      total: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Project-2 mobile-app recipe export. Drops any photo not marked licensed/original. */
export async function exportRecipesAction(
  slugs?: string[],
  requireImage = false,
): Promise<{
  ok: boolean;
  recipes: unknown[];
  total: number;
  images_dropped: number;
  error?: string;
}> {
  try {
    return (await runShim(
      "export-recipes-json.py",
      { slugs: slugs ?? [], require_image: requireImage },
      30_000,
    )) as {
      ok: boolean;
      recipes: unknown[];
      total: number;
      images_dropped: number;
    };
  } catch (e) {
    return {
      ok: false,
      recipes: [],
      total: 0,
      images_dropped: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Auto-suggest a personalized recipe set for a plan's client (dosha / season /
 * diet / condition matched). The coach PRUNES this — they never hand-pick from
 * scratch. The editor shows these as removable chips; the kept slugs are saved to
 * nutrition.recipes via the normal updatePlan path.
 */
export async function suggestRecipesAction(
  planSlug: string,
  n = 16,
): Promise<{ ok: boolean; recipes: RecipeCard[]; total: number; error?: string }> {
  try {
    const plan = await loadPlanBySlug(planSlug);
    if (!plan)
      return { ok: false, recipes: [], total: 0, error: `Plan ${planSlug} not found` };

    const clientId = plan.client_id as string | undefined;
    let clientData: Record<string, unknown> = {};
    if (clientId) {
      const clientFile = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
      try {
        const raw = await fs.readFile(clientFile, "utf-8");
        clientData = (yaml.load(raw) as Record<string, unknown>) ?? {};
      } catch {
        // no client file — suggest from the plan alone
      }
    }

    return (await runShim(
      "suggest-recipes.py",
      { client: clientData, plan, n },
      30_000,
    )) as { ok: boolean; recipes: RecipeCard[]; total: number };
  } catch (e) {
    return {
      ok: false,
      recipes: [],
      total: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

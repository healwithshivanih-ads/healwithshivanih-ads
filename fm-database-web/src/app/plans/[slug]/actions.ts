"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type { Plan, PlanPatch } from "@/lib/fmdb/types";

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

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";
const WEB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database-web";

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
  error?: string;
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
      "/Users/shivani/code/healwithshivanih-ads/fm-database/data",
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

    return { ok: true, interactions };
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

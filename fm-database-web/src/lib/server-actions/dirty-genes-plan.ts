"use server";

/**
 * applyDirtyGenesToPlan — writes a Dirty Genes screen contribution into the
 * client's DRAFT plan (coach-side only), obeying two rules:
 *
 *   1. Gene/pathway language goes ONLY into notes_for_coach (coach-only).
 *      Client-facing fields (nutrition.add, lifestyle_practices, supplement
 *      schedule) stay plain food/lifestyle language.
 *   2. De-dup against what the client is already on — including combo-formula
 *      components (the `consolidates` list) so we never re-suggest e.g.
 *      methylfolate when they're already on a homocysteine B-complex.
 *
 * Nothing auto-fires: the coach picks the pathways and clicks apply. Only draft
 * plans are writable (mirrors updatePlan's gate).
 */

import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { loadAllPlans, loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getCataloguePath } from "@/lib/fmdb/paths";
import type { Plan } from "@/lib/fmdb/types";
import type { PlanContribution, PlanSupplementSuggestion } from "@/lib/fmdb/dirty-genes-plan";

async function loadSuppYaml(slug: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(getCataloguePath(), "supplements", `${slug}.yaml`), "utf-8");
    const yaml = await import("js-yaml");
    return (yaml.load(raw) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** covered supplement identities = each plan supp's slug + aliases + consolidates
 *  + the aliases of each consolidated slug (two-hop), all lowercased. */
async function coveredSupplements(planSupps: Array<{ supplement_slug?: string }>): Promise<Set<string>> {
  const covered = new Set<string>();
  for (const s of planSupps) {
    const slug = s.supplement_slug;
    if (!slug) continue;
    covered.add(slug.toLowerCase());
    const y = await loadSuppYaml(slug);
    if (!y) continue;
    for (const a of strs(y.aliases)) covered.add(a.toLowerCase());
    for (const c of strs(y.consolidates)) {
      covered.add(c.toLowerCase());
      const cy = await loadSuppYaml(c);
      if (cy) for (const ca of strs(cy.aliases)) covered.add(ca.toLowerCase());
    }
  }
  return covered;
}

export interface ApplyDgResult {
  ok: boolean;
  planSlug?: string;
  added?: { supplements: string[]; foods: number; lifestyle: number };
  skipped?: string[]; // supplement slugs skipped as already-covered
  error?: string;
}

export async function applyDirtyGenesToPlan(input: {
  clientId: string;
  contribution: PlanContribution;
  /** optional explicit draft slug; else the client's draft is found */
  planSlug?: string;
}): Promise<ApplyDgResult> {
  try {
    const { clientId, contribution } = input;

    // resolve target draft plan
    let slug = input.planSlug;
    if (!slug) {
      const all = await loadAllPlans();
      const draft = all
        .filter((p) => p.client_id === clientId && (p.status ?? "draft") === "draft")
        .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
      if (!draft) {
        return { ok: false, error: "No draft plan for this client — create a draft plan first, then apply." };
      }
      slug = draft.slug as string;
    }

    const plan = (await loadPlanBySlug(slug)) as Record<string, unknown> | null;
    if (!plan) return { ok: false, error: `Plan ${slug} not found.` };
    if ((plan.status ?? "draft") !== "draft") {
      return { ok: false, error: `Plan ${slug} is ${plan.status} — only drafts are editable. Revert to draft first.` };
    }

    const existingSupps = (plan.supplement_protocol as Array<{ supplement_slug?: string }>) ?? [];
    const covered = await coveredSupplements(existingSupps);

    // filter supplement suggestions (de-dup vs covered + across suggestions)
    const seenSug = new Set<string>();
    const added: PlanSupplementSuggestion[] = [];
    const skipped: string[] = [];
    for (const s of contribution.supplements) {
      const k = s.supplement_slug.toLowerCase();
      if (seenSug.has(k)) continue;
      seenSug.add(k);
      let isCovered = covered.has(k);
      if (!isCovered) {
        const y = await loadSuppYaml(s.supplement_slug);
        if (y) isCovered = strs(y.aliases).some((a) => covered.has(a.toLowerCase()));
      }
      if (isCovered) skipped.push(s.supplement_slug);
      else added.push(s);
    }

    // append supplements
    const newSupps = added.map((s) => ({
      supplement_slug: s.supplement_slug,
      coach_rationale: s.coach_rationale,
      intake_evidence: ["gene-pathway screen (coach-only)"],
      start_week: 1,
    }));
    plan.supplement_protocol = [...existingSupps, ...newSupps];

    // nutrition.add (client-facing, gene-free) — dedup vs existing
    const nutrition = (plan.nutrition as Record<string, unknown>) ?? {};
    const existingAdd = strs(nutrition.add);
    const addLower = new Set(existingAdd.map((x) => x.toLowerCase()));
    const foodsAdded = contribution.nutrition_add.filter((f) => !addLower.has(f.toLowerCase()));
    nutrition.add = [...existingAdd, ...foodsAdded];
    plan.nutrition = nutrition;

    // lifestyle_practices (client-facing, gene-free) — dedup by name
    const existingLp = (plan.lifestyle_practices as Array<{ name?: string }>) ?? [];
    const lpNames = new Set(existingLp.map((x) => String(x.name ?? "").toLowerCase()));
    const lifeAdded = contribution.lifestyle.filter((l) => !lpNames.has(l.toLowerCase()));
    plan.lifestyle_practices = [...existingLp, ...lifeAdded.map((name) => ({ name }))];

    // notes_for_coach — prepend the coach-only gene block
    const prevNotes = typeof plan.notes_for_coach === "string" ? plan.notes_for_coach : "";
    plan.notes_for_coach = contribution.coach_note + (prevNotes ? "\n\n" + prevNotes : "");

    plan.updated_at = new Date().toISOString();
    plan.updated_by = "dirty-genes-screen";

    await writePlan(plan as unknown as Plan);
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/plan`);
    revalidatePath(`/plans/${slug}`);

    return {
      ok: true,
      planSlug: slug,
      added: { supplements: added.map((s) => s.supplement_slug), foods: foodsAdded.length, lifestyle: lifeAdded.length },
      skipped,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { runShim } from "@/lib/fmdb/shim";
import { loadPlanBySlug, loadAllPlans } from "@/lib/fmdb/loader";
import {
  loadPackRecipes,
  loadLibraryRecipes,
  buildLibraryRecipeResolver,
  matchPackRecipe,
  recipeConsistentWithDish,
} from "@/lib/fmdb/client-app";
import type { MenuAiRecipes, AiRecipeFlag, PromoteResult } from "@/lib/fmdb/ai-recipes-types";

/**
 * Flag every menu dish the client app serves from the AI-generated recipe pack
 * (rather than the catalogue). Uses the SAME primitives as the app's recipeFor
 * (matchPackRecipe + recipeConsistentWithDish) so the flag matches exactly what
 * the client sees — pack recipe wins, catalogue fills the gap. Returns each AI
 * recipe's body so the coach can add it to the catalogue. Defensive: any
 * failure returns an empty list so the panel simply hides.
 */
export async function getMenuAiRecipesAction(
  clientId: string,
  planSlug?: string,
): Promise<MenuAiRecipes> {
  const empty: MenuAiRecipes = { planSlug: planSlug ?? "", count: 0, recipes: [] };
  try {
    // Resolve the client's current published plan when the caller doesn't pass
    // one (at most one plan is in the published bucket per client — supersede
    // moves the old one out).
    let slug = planSlug;
    if (!slug) {
      const plans = await loadAllPlans();
      slug = plans.find(
        (p) => String(p.client_id) === clientId && p._bucket === "published",
      )?.slug;
    }
    if (!slug) return empty;
    const [plan, pack, library] = await Promise.all([
      loadPlanBySlug(slug),
      loadPackRecipes(clientId, slug),
      loadLibraryRecipes(),
    ]);
    if (!plan || !pack.length) return { ...empty, planSlug: slug };
    const resolver = buildLibraryRecipeResolver(library);
    const menu = plan.app_menu as
      | { weeks?: { days?: { slots?: { slot?: string; dish?: string }[] }[] }[] }
      | undefined;
    if (!menu || !Array.isArray(menu.weeks)) return empty;

    const seen = new Set<string>();
    const out: AiRecipeFlag[] = [];
    for (const w of menu.weeks ?? [])
      for (const d of w.days ?? [])
        for (const s of d.slots ?? []) {
          const dish = (s.dish ?? "").trim();
          if (!dish) continue;
          // per-pill: the head cookable component is what carries a recipe
          const head = dish.split(/\s\+\s|→|⇒|:/)[0]?.trim() || dish;
          const key = head.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          // Catalogue-first precedence (mirrors recipeFor): if a consistent
          // library recipe covers the dish it is SERVED from the catalogue, so
          // it is NOT an AI recipe. Only dishes the catalogue misses fall back
          // to the pack — those are the ones to flag + offer to add.
          const lib = resolver(head);
          if (lib && recipeConsistentWithDish(head, lib)) continue;
          const ai = matchPackRecipe(head, pack);
          if (!ai) continue; // no recipe at all (category card) — nothing to add
          out.push({
            dish: head,
            title: ai.title,
            ingredients: ai.ingredients ?? [],
            method: ai.method ?? [],
            alreadyInCatalogue: false,
          });
        }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return { planSlug: slug, count: out.length, recipes: out };
  } catch {
    return empty;
  }
}

/**
 * Promote an AI-generated pack recipe into the catalogue via
 * promote-generated-recipe.py. Re-call with force=true to override the
 * duplicate-name guard. Revalidates the catalogue on success.
 */
export async function promoteGeneratedRecipeAction(input: {
  name: string;
  ingredients: string[];
  steps: string[];
  mealType?: string[];
  diet?: string[];
  clientDiet?: string;
  force?: boolean;
}): Promise<PromoteResult> {
  try {
    const out = (await runShim(
      "promote-generated-recipe.py",
      {
        name: input.name,
        ingredients: input.ingredients,
        steps: input.steps,
        meal_type: input.mealType ?? [],
        diet: input.diet ?? [],
        client_diet: input.clientDiet ?? "",
        force: input.force ?? false,
      },
      60_000,
    )) as {
      ok: boolean;
      slug?: string;
      warnings?: string[];
      needs_confirm?: boolean;
      error?: string;
    };
    if (out.ok) revalidatePath("/catalogue");
    return {
      ok: out.ok,
      slug: out.slug,
      warnings: out.warnings,
      needsConfirm: out.needs_confirm,
      error: out.error,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "promote failed" };
  }
}

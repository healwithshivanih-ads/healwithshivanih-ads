"use server";

/**
 * recipe-picker — diet-filtered recipe search for the Plan-tab dish picker
 * (2026-06-15). The coach picks dishes from the structured recipe library
 * instead of free-typing, so every dish stays linked to a recipe (method +
 * photo + accurate calories + grocery).
 *
 * The diet gate MUST mirror client-app.ts `recipeAllowed` — a client must
 * never be offered a recipe outside their diet (the "eggetarian saw chicken
 * poha" bug). Kept as a faithful copy here; converge into one module if it
 * ever drifts.
 */

import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { runShim } from "@/lib/fmdb/shim";
import { labNutrientPriorities, recipeLabBoost, matchedPriorityTags } from "@/lib/fmdb/lab-nutrient-priorities";

const RECIPES_DIR = path.join(process.cwd(), "..", "fm-database", "data", "_recipes");

export interface PickerRecipe {
  slug: string;
  title: string;
  kcalPerServing: number | null;
  imageUrl: string | null;
  time: string | null;
  mains: string[];
  diet: string[];
  /** rich_in tags this recipe covers that the client is low on (lab-aware) */
  labMatchedTags?: string[];
}

const MEAT_RE = /\b(chicken|mutton|lamb|beef|pork|fish|prawn|shrimp|crab|seafood|\bmeat\b|keema|kheema|bacon|ham\b|turkey|egg whites?\b)\b/i;
const EGG_RE = /\begg(s|y)?\b|omelette|omelet|bhurji|shakshuka|frittata/i;
const JAIN_RE = /\b(onion|garlic|potato|aloo|ginger.?garlic|beetroot|radish|mooli|sweet potato|\byam\b|arbi|colocasia|shallot|spring onion|leek)\b/i;

// client tolerance: 0 vegan · 1 vegetarian · 2 eggetarian · 3 omnivore
function clientDietLevel(diet: string): number {
  if (/vegan/.test(diet)) return 0;
  if (/egg/.test(diet) && !/no.?egg|egg.?free/.test(diet)) return 2;
  if (/non.?veg|pescat|fish|chicken|\bmeat\b|omnivore/.test(diet)) return 3;
  if (/vegetarian|jain|\bveg\b/.test(diet)) return 1;
  return 3; // unknown → assume omnivore (don't over-filter)
}
function recipeDietLevel(title: string, mains: string[], ingredients: string[], diet: string[]): number {
  const text = `${title} ${mains.join(" ")} ${ingredients.join(" ")}`;
  const d = diet.map((x) => x.toLowerCase());
  if (d.some((x) => /non.?veg/.test(x)) || MEAT_RE.test(text)) return 3;
  if (d.includes("eggetarian") || EGG_RE.test(text)) return 2;
  if (d.includes("vegan")) return 0;
  return 1;
}

export async function searchRecipesAction(
  clientId: string,
  query: string,
): Promise<{ ok: boolean; recipes: PickerRecipe[]; error?: string }> {
  try {
    const client = await loadClientById(clientId);
    const dietPref = String(
      (client as { dietary_preference?: string } | null)?.dietary_preference ?? "",
    ).toLowerCase();
    const lvl = clientDietLevel(dietPref);
    const isJain = /jain/.test(dietPref);
    // lab-aware: nutrients this client is low on → boost matching rich_in dishes
    const labPriorities = labNutrientPriorities(client as { lab_markers?: unknown } | null);
    const hasLabPriorities = Object.keys(labPriorities).length > 0;

    // Foods the client avoids — never offer a recipe that uses one. The field
    // is free-form (a list, a comma string like "Onion, Garlic", or prose), so
    // split on commas/newlines, take the core food word(s) before any
    // qualifier, and drop prose/headers. Best-effort; precise for clean lists.
    const avoidRaw = (client as { foods_to_avoid?: unknown } | null)?.foods_to_avoid;
    const rawTerms: string[] = Array.isArray(avoidRaw)
      ? avoidRaw.map(String)
      : avoidRaw
        ? String(avoidRaw).split(/[,\n;]+/)
        : [];
    const PROSE = new Set([
      "avoid", "list", "until", "weeks", "week", "month", "months", "framework",
      "frameworks", "reset", "from", "runs", "through", "only", "moderation",
      "red", "yellow", "consume", "food", "intolerance", "histamine", "sova",
      "stacked", "exclusion", "primary", "cooking", "shift", "portions", "small",
      "aged", "leftover", "packaged", "excess", "confirmed", "clinical", "trigger",
    ]);
    const avoidList = rawTerms
      .map((t) =>
        t
          .split(/[(—:/]|\s[-–]\s/)[0]
          .toLowerCase()
          .replace(/[^a-z\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((t) => {
        const w = t.split(" ").filter(Boolean);
        return t.length >= 3 && w.length >= 1 && w.length <= 2 && !w.some((x) => PROSE.has(x));
      });
    const avoidRe = [...new Set(avoidList)].map(
      (a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    );

    let files: string[] = [];
    try {
      files = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    } catch {
      return { ok: true, recipes: [] };
    }

    const q = query.trim().toLowerCase();
    const qToks = q.split(/\s+/).filter(Boolean);
    const out: PickerRecipe[] = [];

    for (const f of files) {
      let r: Record<string, unknown> | null = null;
      try {
        r = yaml.load(fs.readFileSync(path.join(RECIPES_DIR, f), "utf-8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!r) continue;
      const title = String(r.name ?? "");
      if (!title) continue;
      const mains = (Array.isArray(r.main_ingredients) ? r.main_ingredients : []).map(String);
      const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).map((i) =>
        typeof i === "string" ? i : String((i as { item?: unknown })?.item ?? ""),
      );
      const diet = (Array.isArray(r.diet) ? r.diet : []).map(String);

      // ── diet safety gate (mirror client-app.ts) ──
      if (recipeDietLevel(title, mains, ingredients, diet) > lvl) continue;
      if (isJain) {
        // Full ingredient list, not just title/mains — see client-app.ts
        // recipeAllowed for why (garlic/onion often live only in the
        // tempering step, absent from main_ingredients).
        const jt = `${title} ${mains.join(" ")} ${ingredients.join(" ")}`;
        const negated = /no.?onion|no.?garlic|without (onion|garlic)|onion.?free|garlic.?free/i.test(jt);
        if (JAIN_RE.test(jt) && !negated) continue;
      }

      // ── foods-to-avoid gate ──
      if (avoidRe.length) {
        const full = `${title} ${mains.join(" ")} ${ingredients.join(" ")}`;
        if (avoidRe.some((re) => re.test(full))) continue;
      }

      // ── query filter (every token must appear in title or mains) ──
      const hay = `${title} ${mains.join(" ")}`.toLowerCase();
      if (q && !qToks.every((t) => hay.includes(t))) continue;

      const img = r.image as Record<string, unknown> | undefined;
      const imgFile = img ? String(img.file ?? "") : "";
      const imageUrl =
        imgFile && String(img?.rights_status) !== "none" ? `/recipe-images/${imgFile}` : null;
      const mins = (Number(r.prep_time_min) || 0) + (Number(r.cook_time_min) || 0);
      const richIn = (Array.isArray(r.rich_in) ? r.rich_in : []).map(String);

      out.push({
        slug: String(r.slug ?? f.replace(/\.yaml$/, "")),
        title,
        kcalPerServing: Number(r.kcal_per_serving) || null,
        imageUrl,
        time: mins ? `${mins} min` : null,
        mains,
        diet,
        labMatchedTags: hasLabPriorities ? matchedPriorityTags(richIn, labPriorities) : undefined,
        _labBoost: hasLabPriorities ? recipeLabBoost(richIn, labPriorities) : 0,
      } as PickerRecipe & { _labBoost: number });
    }

    // rank: lab-priority boost first (client's low nutrients), then query
    // prefix, then photo, then alphabetical.
    const scored = out as (PickerRecipe & { _labBoost?: number })[];
    scored.sort((a, b) => {
      const lb = (b._labBoost ?? 0) - (a._labBoost ?? 0);
      if (lb !== 0) return lb;
      const aw = q && a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bw = q && b.title.toLowerCase().startsWith(q) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      if (!!a.imageUrl !== !!b.imageUrl) return a.imageUrl ? -1 : 1;
      return a.title.localeCompare(b.title);
    });

    const recipes = scored.slice(0, 40).map(({ _labBoost, ...rest }) => {
      void _labBoost;
      return rest;
    });
    return { ok: true, recipes };
  } catch (e) {
    return { ok: false, recipes: [], error: e instanceof Error ? e.message : "search failed" };
  }
}

/**
 * AI-generate a diet-safe recipe for a dish the library doesn't have, write it
 * into _recipes/, and return it so the picker can select it immediately. The
 * recipe joins the shared library and links everywhere (method + calories +
 * grocery). Photo follows once sourced — null for now.
 */
export async function generateRecipeAction(
  clientId: string,
  dishName: string,
  opts?: { slot?: string; cuisine?: string; note?: string },
): Promise<{ ok: boolean; recipe?: PickerRecipe; error?: string }> {
  try {
    const out = (await runShim(
      "generate-recipe.py",
      {
        client_id: clientId,
        dish_name: dishName,
        slot: opts?.slot ?? "",
        cuisine: opts?.cuisine ?? "",
        note: opts?.note ?? "",
      },
      120_000,
    )) as { ok: boolean; slug?: string; title?: string; kcal_per_serving?: number; error?: string };
    if (!out.ok || !out.slug || !out.title) {
      return { ok: false, error: out.error ?? "generation failed" };
    }
    return {
      ok: true,
      recipe: {
        slug: out.slug,
        title: out.title,
        kcalPerServing: out.kcal_per_serving ?? null,
        imageUrl: null,
        time: null,
        mains: [],
        diet: [],
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "generation failed" };
  }
}

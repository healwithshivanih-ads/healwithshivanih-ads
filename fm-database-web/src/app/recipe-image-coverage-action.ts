"use server";

import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { getCataloguePath } from "@/lib/fmdb/paths";
import { loadAllPlans, loadAllClients } from "@/lib/fmdb/loader";
import {
  loadLibraryRecipes,
  buildLibraryRecipeResolver,
  snackCategoryImage,
  recipeConsistentWithDish,
} from "@/lib/fmdb/client-app";

/** One catalogue recipe that would show in the client app without a real
 *  photo — so the coach can source/generate one before any client sees it. */
export interface RecipeImageGap {
  slug: string;
  name: string;
  reason: "no_image_block" | "rights_none" | "file_missing";
}

export interface RecipeImageCoverage {
  total: number;        // recipes scanned
  imaged: number;       // recipes with a suitable, on-disk image
  gaps: RecipeImageGap[]; // the actionable list (every un-imaged recipe)
}

const EMPTY: RecipeImageCoverage = { total: 0, imaged: 0, gaps: [] };

/**
 * Recipe-image coverage guardrail. Mirrors the resolution rule in
 * client-app.ts `loadLibraryRecipes`: a recipe shows a photo only when it has
 * an `image.file` whose `rights_status` isn't "none" AND the file exists under
 * public/recipe-images/. Anything else falls back to a gradient tile in the
 * app — exactly what the coach doesn't want. Per coach decision this is a FLAG,
 * not a block: photo-less recipes still work, they're just surfaced here so new
 * images get generated periodically.
 *
 * "Suitable" = any real food photo (coach's rule) — uncleared web references
 * count; the rights_status flag only matters when explicitly set to "none".
 *
 * Defensive: any failure returns the empty coverage so the chip hides rather
 * than breaking the dashboard.
 */
export async function getRecipeImageCoverage(): Promise<RecipeImageCoverage> {
  try {
    const recipesDir = path.join(getCataloguePath(), "_recipes");
    const publicDir = path.join(process.cwd(), "public", "recipe-images");
    let files: string[];
    try {
      files = await fs.readdir(recipesDir);
    } catch {
      return EMPTY;
    }

    const gaps: RecipeImageGap[] = [];
    let total = 0;
    let imaged = 0;

    for (const f of files) {
      if (!f.endsWith(".yaml") || f.startsWith("_")) continue;
      let r: Record<string, unknown> | null = null;
      try {
        r = yaml.load(await fs.readFile(path.join(recipesDir, f), "utf8")) as Record<string, unknown>;
      } catch {
        continue; // one malformed file never breaks the scan
      }
      if (!r || typeof r.name !== "string" || !r.name) continue;
      total += 1;
      const slug = typeof r.slug === "string" && r.slug ? r.slug : f.replace(/\.yaml$/, "");
      const name = r.name;

      const img = r.image as Record<string, unknown> | undefined;
      const file = img && typeof img.file === "string" ? img.file : "";
      if (!file) {
        gaps.push({ slug, name, reason: "no_image_block" });
        continue;
      }
      if (img && img.rights_status === "none") {
        gaps.push({ slug, name, reason: "rights_none" });
        continue;
      }
      // The app serves /recipe-images/<file>; confirm the asset is on disk so a
      // dangling reference is caught here, not as a broken tile on the client.
      try {
        await fs.access(path.join(publicDir, file));
        imaged += 1;
      } catch {
        gaps.push({ slug, name, reason: "file_missing" });
      }
    }

    // Most-actionable first: missing files (broken refs) then no-image then
    // rights-blocked; alphabetical within a reason.
    const order: Record<RecipeImageGap["reason"], number> = {
      file_missing: 0,
      no_image_block: 1,
      rights_none: 2,
    };
    gaps.sort((a, b) => order[a.reason] - order[b.reason] || a.name.localeCompare(b.name));

    return { total, imaged, gaps };
  } catch {
    return EMPTY;
  }
}

/** A live published-plan menu that serves dishes which won't show a photo. */
export interface MenuImageGap {
  clientId: string;
  clientName: string;
  planSlug: string;
  dishes: string[]; // distinct dishes on this menu with no imaged recipe
}

export interface MenuImageCoverage {
  plansScanned: number;   // published plans carrying a menu
  dishGaps: number;       // total distinct (plan, dish) pairs without a photo
  menus: MenuImageGap[];  // grouped by plan/client, most gaps first
}

const EMPTY_MENU: MenuImageCoverage = { plansScanned: 0, dishGaps: 0, menus: [] };

/**
 * Live-menu image coverage. Walks every PUBLISHED plan's structured `app_menu`
 * and, for each dish a client would see, runs the SAME resolver the client app
 * uses (buildLibraryRecipeResolver) to check whether it lands on a recipe with
 * a photo. Dishes that don't — because the recipe isn't in the catalogue yet,
 * or is there without an image — are exactly the ones that render a plain
 * gradient tile. Newly AI-generated recipes are saved into the catalogue, so
 * they resolve by name here and surface as "needs a photo" until one is added.
 *
 * Bedtime slots are skipped — they're drinks/remedies folded in separately and
 * never show a meal thumbnail (mirrors client-app.ts). Resolves against the
 * FULL library (the dish was already diet-gated when picked), so this is a
 * pure "will a photo show" check.
 *
 * Defensive: any failure returns the empty coverage so the chip simply hides.
 */
export async function getMenuImageCoverage(): Promise<MenuImageCoverage> {
  try {
    const [plans, clients, library] = await Promise.all([
      loadAllPlans(),
      loadAllClients(),
      loadLibraryRecipes(),
    ]);
    const resolver = buildLibraryRecipeResolver(library);
    const nameById = new Map<string, string>(
      clients.map((c) => [String(c.id), String(c.display_name || c.id)]),
    );

    const menus: MenuImageGap[] = [];
    let plansScanned = 0;
    let dishGaps = 0;

    for (const plan of plans) {
      if (plan._bucket !== "published") continue;
      const menu = plan.app_menu as
        | { weeks?: { days?: { slots?: { slot?: string; dish?: string }[] }[] }[] }
        | undefined;
      if (!menu || !Array.isArray(menu.weeks)) continue;
      plansScanned += 1;

      const seen = new Set<string>();
      const missing: string[] = [];
      for (const w of menu.weeks ?? [])
        for (const d of w.days ?? [])
          for (const s of d.slots ?? []) {
            const slot = (s.slot ?? "").toLowerCase();
            if (slot.includes("bedtime")) continue; // drinks/remedies — no thumbnail
            const dish = (s.dish ?? "").trim();
            if (!dish || seen.has(dish)) continue;
            seen.add(dish);
            // Covered when it resolves to a recipe photo OR maps to a snack/
            // drink category photo; only truly-uncategorised dishes are flagged.
            const rec = resolver(dish);
            if ((!rec || !rec.imageUrl) && !snackCategoryImage(dish)) missing.push(dish);
          }

      if (missing.length) {
        dishGaps += missing.length;
        const clientId = String(plan.client_id ?? "");
        menus.push({
          clientId,
          clientName: nameById.get(clientId) ?? clientId ?? "—",
          planSlug: String(plan.slug ?? ""),
          dishes: missing.sort((a, b) => a.localeCompare(b)),
        });
      }
    }

    menus.sort((a, b) => b.dishes.length - a.dishes.length || a.clientName.localeCompare(b.clientName));
    return { plansScanned, dishGaps, menus };
  } catch {
    return EMPTY_MENU;
  }
}

/** A live menu dish that resolves to a recipe the consistency gate REJECTS —
 *  so the client now sees the dish name with no recipe. The coach should fix
 *  the menu wording or add a matching recipe. */
export interface MenuRecipeGap {
  clientId: string;
  clientName: string;
  planSlug: string;
  dishes: string[]; // distinct dishes whose recipe fails the consistency gate
}

export interface MenuRecipeCoverage {
  plansScanned: number;
  dishGaps: number;
  menus: MenuRecipeGap[];
}

const EMPTY_RECIPE: MenuRecipeCoverage = { plansScanned: 0, dishGaps: 0, menus: [] };

/**
 * Menu-approval PRE-FLIGHT for recipe reliability. Walks every published plan's
 * `app_menu` and, for each dish, runs the SAME library resolver the client app
 * uses, then the SAME consistency gate (recipeConsistentWithDish). It flags the
 * dishes where the resolver found a recipe that the gate REJECTS — i.e. the app
 * will now (correctly) hide it, so the client sees the dish name with no recipe.
 * These are exactly the "nonsense recipe" cases that erode trust: surfacing them
 * lets the coach fix the menu wording or add a matching recipe BEFORE a client
 * ever notices. Missing-photo (getMenuImageCoverage) and no-recipe-at-all are
 * separate, gentler signals — this one is specifically "a wrong recipe was
 * caught". Library-only (mirrors the image scan); per-client generated packs are
 * not loaded here.
 *
 * Defensive: any failure returns empty so the chip simply hides.
 */
export async function getMenuRecipeCoverage(): Promise<MenuRecipeCoverage> {
  try {
    const [plans, clients, library] = await Promise.all([
      loadAllPlans(),
      loadAllClients(),
      loadLibraryRecipes(),
    ]);
    const resolver = buildLibraryRecipeResolver(library);
    const nameById = new Map<string, string>(
      clients.map((c) => [String(c.id), String(c.display_name || c.id)]),
    );

    const menus: MenuRecipeGap[] = [];
    let plansScanned = 0;
    let dishGaps = 0;

    for (const plan of plans) {
      if (plan._bucket !== "published") continue;
      const menu = plan.app_menu as
        | { weeks?: { days?: { slots?: { slot?: string; dish?: string }[] }[] }[] }
        | undefined;
      if (!menu || !Array.isArray(menu.weeks)) continue;
      plansScanned += 1;

      const seen = new Set<string>();
      const flagged: string[] = [];
      for (const w of menu.weeks ?? [])
        for (const d of w.days ?? [])
          for (const s of d.slots ?? []) {
            const slot = (s.slot ?? "").toLowerCase();
            if (slot.includes("bedtime")) continue;
            const dish = (s.dish ?? "").trim();
            if (!dish || seen.has(dish)) continue;
            seen.add(dish);
            // Only the FIRST cookable component carries the recipe (mirrors the
            // client app's per-pill resolution); a wrong recipe there is the bug.
            const head = dish.split(/\s\+\s|→|⇒|:/)[0]?.trim() || dish;
            const rec = resolver(head);
            if (rec && !recipeConsistentWithDish(head, rec)) flagged.push(dish);
          }

      if (flagged.length) {
        dishGaps += flagged.length;
        const clientId = String(plan.client_id ?? "");
        menus.push({
          clientId,
          clientName: nameById.get(clientId) ?? clientId ?? "—",
          planSlug: String(plan.slug ?? ""),
          dishes: flagged.sort((a, b) => a.localeCompare(b)),
        });
      }
    }

    menus.sort((a, b) => b.dishes.length - a.dishes.length || a.clientName.localeCompare(b.clientName));
    return { plansScanned, dishGaps, menus };
  } catch {
    return EMPTY_RECIPE;
  }
}

"use server";

import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { getCataloguePath } from "@/lib/fmdb/paths";

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

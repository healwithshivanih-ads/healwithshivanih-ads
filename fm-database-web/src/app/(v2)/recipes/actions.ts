"use server";
import { revalidatePath } from "next/cache";
import { execFile } from "node:child_process";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";

const RECIPES_DIR = path.join(
  process.cwd(),
  "..",
  "fm-database",
  "data",
  "_recipes"
);
const WEB_IMG = path.join(
  process.cwd(),
  "public",
  "recipe-images",
  "images",
  "web"
);
const PYTHON = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

export interface RecipeImageStatus {
  slug: string;
  name: string;
  hasWebImage: boolean;
  imageUrl: string | null;
  sourceUrl: string | null;
}

export async function listRecipeImageStatuses(): Promise<RecipeImageStatus[]> {
  let files: string[] = [];
  try {
    files = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".yaml"));
  } catch {
    return [];
  }
  const results: RecipeImageStatus[] = [];
  for (const f of files) {
    const base = path.basename(f, ".yaml");
    if (base.startsWith("_")) continue;
    try {
      const raw = yaml.load(fs.readFileSync(path.join(RECIPES_DIR, f), "utf-8")) as Record<string, unknown>;
      if (!raw) continue;
      const img = raw.image as Record<string, string> | undefined;
      const hasWeb = !!(img?.file && String(img.file).includes("images/web/"));
      results.push({
        slug: base,
        name: (raw.name as string) || base,
        hasWebImage: hasWeb,
        imageUrl: hasWeb ? `/recipe-images/${img!.file}` : null,
        sourceUrl: img?.source_url || null,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function runPy(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const script = path.join(SCRIPTS_DIR, "recipe-image-from-url.py");
    const child = execFile(PYTHON, [script, ...args], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d));
    child.stderr?.on("data", (d: Buffer) => (stderr += d));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
  });
}

export async function applyImageFromUrl(
  slug: string,
  url: string,
  dish: string
): Promise<{ ok: boolean; img?: string; score?: number; why?: string; error?: string }> {
  const result = await runPy([slug, url, "--dish", dish]);
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    if (parsed.ok) revalidatePath("/(v2)/recipes");
    return parsed;
  } catch {
    return { ok: false, error: result.stdout || result.stderr };
  }
}

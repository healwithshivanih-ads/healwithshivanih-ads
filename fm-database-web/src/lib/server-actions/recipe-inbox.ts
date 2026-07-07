"use server";

/**
 * Recipe inbox — staged recipe candidates awaiting coach review.
 *
 * Candidates live at ~/fm-plans/_recipe_inbox/<rc-id>.yaml (attachments under
 * _recipe_inbox/media/). They arrive two ways:
 *   1. WhatsApp webhook (forwarded reels / photos / PDFs from numbers in
 *      RECIPE_INBOX_NUMBERS, or Instagram links from non-client numbers) —
 *      see src/app/api/whatsapp-webhook/route.ts.
 *   2. The "Add manually" card on /recipes (paste caption text, upload a
 *      cookbook photo or PDF) — createRecipeCandidateAction below.
 *
 * Parsing (AI) and approval (quality gates + library write + deterministic
 * nutrients) both run through Python shims so the recipe schema logic stays
 * in one place next to the library.
 */

import path from "path";
import os from "os";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { runShim } from "@/lib/fmdb/shim";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";

const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");
const INBOX_DIR = path.join(PLANS_ROOT, "_recipe_inbox");

const ID_RE = /^rc-[a-z0-9-]+$/;

export interface RecipeIngredient {
  item: string;
  qty: string;
  unit: string;
}

export interface ParsedRecipeDraft {
  name: string;
  meal_type: string[];
  diet: string[];
  region?: string;
  seasons: string[];
  balances_dosha?: string[];
  aggravates_dosha?: string[];
  rasa?: string[];
  main_ingredients: string[];
  contains_allergens: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  servings: string;
  prep_time_min?: number;
  cook_time_min?: number;
  one_line: string;
  headnote?: string;
  attribution_author?: string;
  parse_notes?: string;
}

export interface RecipeCandidate {
  id: string;
  received_at: string;
  source: string; // "whatsapp" | "manual"
  from_phone?: string | null;
  from_name?: string | null;
  text: string;
  source_url?: string | null;
  media_file?: string | null;
  media_mime?: string | null;
  status: string; // "new" | "parsed" | "approved" | "rejected"
  parsed?: ParsedRecipeDraft | null;
  approved_slug?: string | null;
  rejected_note?: string | null;
  /** source photo captured from the forward (og:image or the forwarded photo);
   *  attached to the recipe on approve, credited to image_credit. */
  image_url?: string | null;
  image_credit?: string | null;
}

function candidatePath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`bad candidate id: ${id}`);
  return path.join(INBOX_DIR, `${id}.yaml`);
}

export async function listRecipeCandidatesAction(): Promise<RecipeCandidate[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(INBOX_DIR)).filter((f) => f.endsWith(".yaml"));
  } catch {
    return []; // inbox dir doesn't exist yet
  }
  const out: RecipeCandidate[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(INBOX_DIR, f), "utf-8");
      const parsed = yaml.load(raw) as RecipeCandidate | null;
      if (parsed && typeof parsed.id === "string") out.push(parsed);
    } catch {
      // skip unreadable candidate — never break the page over one bad file
    }
  }
  out.sort((a, b) => (b.received_at || "").localeCompare(a.received_at || ""));
  return out;
}

const MANUAL_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function createRecipeCandidateAction(input: {
  text?: string;
  sourceUrl?: string;
  fileBase64?: string;
  fileMime?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const text = (input.text ?? "").trim();
  const sourceUrl = (input.sourceUrl ?? "").trim();
  const hasFile = Boolean(input.fileBase64 && input.fileMime);
  if (!text && !sourceUrl && !hasFile) {
    return { ok: false, error: "Paste some text, a link, or attach a photo/PDF first." };
  }
  if (hasFile && !MANUAL_MIME_EXT[input.fileMime!.toLowerCase()]) {
    return { ok: false, error: `Unsupported file type ${input.fileMime} — use a JPG/PNG photo or a PDF.` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const shortId = Math.random().toString(36).slice(2, 12);
  const id = `rc-${today}-${shortId}`;

  try {
    let mediaFile: string | null = null;
    if (hasFile) {
      const ext = MANUAL_MIME_EXT[input.fileMime!.toLowerCase()];
      mediaFile = `media/${id}.${ext}`;
      await fs.mkdir(path.join(INBOX_DIR, "media"), { recursive: true });
      await fs.writeFile(path.join(INBOX_DIR, mediaFile), Buffer.from(input.fileBase64!, "base64"));
    } else {
      await fs.mkdir(INBOX_DIR, { recursive: true });
    }

    const urlInText = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
    const candidate: RecipeCandidate = {
      id,
      received_at: new Date().toISOString(),
      source: "manual",
      from_phone: null,
      from_name: null,
      text,
      source_url: sourceUrl || urlInText,
      media_file: mediaFile,
      media_mime: hasFile ? input.fileMime : null,
      status: "new",
    };
    await fs.writeFile(candidatePath(id), dumpYaml(candidate, { lineWidth: 120 }), "utf-8");
    revalidatePath("/recipes");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function parseRecipeCandidateAction(
  id: string,
): Promise<{ ok: boolean; candidate?: RecipeCandidate; error?: string }> {
  if (!ID_RE.test(id)) return { ok: false, error: "bad candidate id" };
  try {
    const out = (await runShim("parse-recipe-candidate.py", { candidate_id: id }, 180_000)) as {
      ok: boolean;
      candidate?: RecipeCandidate;
      error?: string;
    };
    if (out.ok) revalidatePath("/recipes");
    return out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ApproveRecipeResult {
  ok: boolean;
  slug?: string;
  needs_confirm?: boolean;
  warnings?: string[];
  nutrients?: Record<string, number> | null;
  rich_in?: string[];
  coverage_pct?: number;
  error?: string;
}

export async function approveRecipeCandidateAction(
  id: string,
  recipe: ParsedRecipeDraft,
  force = false,
): Promise<ApproveRecipeResult> {
  if (!ID_RE.test(id)) return { ok: false, error: "bad candidate id" };
  try {
    const out = (await runShim(
      "approve-recipe-candidate.py",
      { candidate_id: id, recipe, force },
      60_000,
    )) as ApproveRecipeResult;
    if (out.ok) revalidatePath("/recipes");
    return out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rejectRecipeCandidateAction(
  id: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = candidatePath(id);
    const raw = await fs.readFile(p, "utf-8");
    const candidate = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    candidate.status = "rejected";
    if (note?.trim()) candidate.rejected_note = note.trim();
    candidate.rejected_at = new Date().toISOString();
    await fs.writeFile(p, dumpYaml(candidate, { lineWidth: 120 }), "utf-8");
    revalidatePath("/recipes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

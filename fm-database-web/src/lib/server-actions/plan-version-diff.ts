"use server";

import { execFile } from "child_process";
import path from "path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  computePlanVersionDiff,
  type PlanLike,
  type PlanVersionDiffSummary,
} from "@/lib/fmdb/plan-version-diff";

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

const SEMANTIC_CACHE_FILE = "_plan_diff_cache.yaml";

// ── Deterministic diff (cheap, always-on) ──────────────────────────────────

export interface PlanVersionDiffResult {
  ok: boolean;
  diff?: PlanVersionDiffSummary;
  error?: string;
}

/**
 * Compute the deterministic structural diff between the active and draft
 * plan. Server component callable. No AI cost.
 */
export async function computePlanVersionDiffAction(
  activeSlug: string,
  draftSlug: string,
): Promise<PlanVersionDiffResult> {
  try {
    const active = await loadPlanBySlug(activeSlug);
    const draft = await loadPlanBySlug(draftSlug);
    if (!active) return { ok: false, error: `active plan not found: ${activeSlug}` };
    if (!draft) return { ok: false, error: `draft plan not found: ${draftSlug}` };

    const diff = computePlanVersionDiff(
      active as unknown as PlanLike,
      draft as unknown as PlanLike,
    );
    return { ok: true, diff };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Semantic diff (Haiku, on demand, cached) ────────────────────────────────

export type SemanticChangeType =
  | "none"
  | "consolidation"
  | "escalation"
  | "pivot"
  | "cleanup"
  | "unclear";

export type SemanticPublishRecommendation =
  | "publish_now"
  | "review_with_client"
  | "discuss_first"
  | "discard_draft";

export interface SemanticDiffResult {
  ok: boolean;
  change_type?: SemanticChangeType;
  change_summary?: string;
  specific_changes?: string[];
  publish_recommendation?: SemanticPublishRecommendation;
  severity_hint?: "low" | "medium" | "high";
  cached?: boolean;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number; model: string };
}

interface CacheEntry {
  active_slug: string;
  draft_slug: string;
  active_hash: string;
  draft_hash: string;
  computed_at: string;
  result: SemanticDiffResult;
}

type Cache = Record<string, CacheEntry>;

function cachePath(): string {
  return path.join(getPlansRoot(), SEMANTIC_CACHE_FILE);
}

async function loadCache(): Promise<Cache> {
  try {
    const raw = await fs.readFile(cachePath(), "utf-8");
    return (yaml.load(raw) as Cache) ?? {};
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await fs.writeFile(
    cachePath(),
    yaml.dump(cache, { sortKeys: false, lineWidth: 120 }),
    "utf-8",
  );
}

function hashNotes(notes: string): string {
  return crypto.createHash("sha1").update(notes).digest("hex").slice(0, 12);
}

function cacheKey(
  activeSlug: string,
  draftSlug: string,
  activeHash: string,
  draftHash: string,
): string {
  return `${activeSlug}::${draftSlug}::${activeHash}::${draftHash}`;
}

/**
 * Run the Haiku semantic comparison of notes_for_coach. Cached on disk
 * keyed on the actual content hash so re-clicks within a session don't
 * re-spend. Force-refresh via `force=true`.
 *
 * Returns immediately with `cached: true` when a fresh result is available
 * for the same content. API monthly-cap errors are surfaced as `ok: false`
 * with the message intact.
 */
export async function computeSemanticPlanDiffAction(
  activeSlug: string,
  draftSlug: string,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<SemanticDiffResult> {
  try {
    const active = await loadPlanBySlug(activeSlug);
    const draft = await loadPlanBySlug(draftSlug);
    if (!active) return { ok: false, error: `active plan not found: ${activeSlug}` };
    if (!draft) return { ok: false, error: `draft plan not found: ${draftSlug}` };

    const activeNotes =
      (active as unknown as { notes_for_coach?: string }).notes_for_coach ?? "";
    const draftNotes =
      (draft as unknown as { notes_for_coach?: string }).notes_for_coach ?? "";

    if (activeNotes.trim() === draftNotes.trim()) {
      // Cheap path — never spend on identical notes
      return {
        ok: true,
        change_type: "none",
        change_summary: "Coach notes are identical between versions.",
        specific_changes: [],
        publish_recommendation: "discard_draft",
        severity_hint: "low",
        cached: false,
      };
    }

    const activeHash = hashNotes(activeNotes);
    const draftHash = hashNotes(draftNotes);
    const key = cacheKey(activeSlug, draftSlug, activeHash, draftHash);

    const cache = await loadCache();
    if (!options.force && cache[key]) {
      return { ...cache[key].result, cached: true };
    }

    // Shell out to Python shim
    const payload = {
      active_slug: activeSlug,
      draft_slug: draftSlug,
      active_notes: activeNotes,
      draft_notes: draftNotes,
      dry_run: !!options.dryRun,
    };

    const scriptPath = path.join(SCRIPTS_DIR, "plan-notes-semantic-diff.py");
    const child = execFile(PYTHON, [scriptPath], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      cwd: FMDB_REPO,
    });
    child.stdin?.end(JSON.stringify(payload));

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer | string) => (stdout += c));
    child.stderr?.on("data", (c: Buffer | string) => (stderr += c));

    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", () => resolve());
    });

    if (!stdout.trim()) {
      return {
        ok: false,
        error: `Semantic shim produced no output. stderr: ${stderr.slice(0, 400)}`,
      };
    }

    const result = JSON.parse(stdout) as SemanticDiffResult;

    // Cache successful results only (don't cache API-cap errors)
    if (result.ok && !options.dryRun) {
      cache[key] = {
        active_slug: activeSlug,
        draft_slug: draftSlug,
        active_hash: activeHash,
        draft_hash: draftHash,
        computed_at: new Date().toISOString(),
        result,
      };
      await saveCache(cache);
    }

    return { ...result, cached: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

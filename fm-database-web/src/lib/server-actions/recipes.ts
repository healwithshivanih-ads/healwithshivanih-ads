"use server";

/**
 * Recipe-pack generation for the client app — weekly cadence (coach decision
 * 2026-06-13: menus are weekly now, recipes auto-generate on each menu
 * approval, not fortnightly).
 *
 * Built the SAME way as grocery: pull the EXACT dishes the app shows via the
 * app's own loader (app_menu = source of truth), then hand them to
 * scripts/generate-week-recipes.py (one Haiku call). The shim writes
 * meal-plans/<planSlug>-recipes.md — the sidecar the app's recipePack reads
 * (letter-parsed recipes take precedence over the structured library). The
 * per-minute staging refresh mirrors it to Fly.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { loadClientAppData } from "@/lib/fmdb/client-app";

export interface RecipeGenResult {
  ok: boolean;
  error?: string;
  count?: number;
  generatedAt?: string;
}

async function readPlanField(planSlug: string, field: string): Promise<string | null> {
  try {
    const dir = path.join(getPlansRoot(), "published");
    const names = await fs.readdir(dir);
    const file = names.filter((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml")).sort().reverse()[0];
    if (!file) return null;
    const doc = yaml.load(await fs.readFile(path.join(dir, file), "utf-8")) as Record<string, unknown>;
    const v = doc?.[field];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function generateWeekRecipesAction(
  clientId: string,
  planSlug: string,
): Promise<RecipeGenResult> {
  const token = await readPlanField(planSlug, "letter_token");
  if (!token) return { ok: false, error: "Plan has no letter token yet — share the letter/app first." };

  const data = await loadClientAppData(token);
  if (!data) return { ok: false, error: "Could not load the client app data for this plan." };
  if (!data.weekMenus.length)
    return { ok: false, error: "No weekly menu — principle-based plans don't need a recipe pack." };

  const client = await (async () => {
    try {
      const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf-8");
      return yaml.load(raw) as { dietary_preference?: string; foods_to_avoid?: string | string[] };
    } catch {
      return {} as { dietary_preference?: string; foods_to_avoid?: string | string[] };
    }
  })();
  const foodsToAvoid = Array.isArray(client.foods_to_avoid)
    ? client.foods_to_avoid.join(", ")
    : client.foods_to_avoid ?? "";

  const out = (await runShim(
    "generate-week-recipes.py",
    {
      client_id: clientId,
      plan_slug: planSlug,
      dietary_preference: client.dietary_preference ?? "",
      foods_to_avoid: foodsToAvoid,
      weeks: data.weekMenus.map((w) => ({
        week: w.week,
        days: w.days.map((d) => ({
          dow: d.dow,
          slots: d.slots.map((s) => ({ slot: s.slot, dish: s.dish })),
        })),
      })),
    },
    180_000,
  )) as { ok: boolean; error?: string; count?: number };

  if (!out?.ok) return { ok: false, error: out?.error ?? "generate-week-recipes.py failed" };

  // The app's recipe pack is send-log gated (only ISSUED letters feed it).
  // Record a `recipes` send entry for THIS published slug so the freshly
  // written <slug>-recipes.md is treated as live. Dedup so re-approval
  // doesn't bloat the log.
  await recordRecipesIssued(clientId, planSlug).catch(() => {});

  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, count: out.count, generatedAt: new Date().toISOString() };
}

/** Append a `{letter_types:[recipes], plan_slug}` entry to the client's
 *  meal-plans/_send_log.yaml so isSentFile() lets the app read the
 *  <slug>-recipes.md sidecar. Idempotent per (plan_slug, recipes). */
async function recordRecipesIssued(clientId: string, planSlug: string): Promise<void> {
  const file = path.join(getPlansRoot(), "clients", clientId, "meal-plans", "_send_log.yaml");
  let log: Array<{ plan_slug?: string; letter_types?: string[] }> = [];
  try {
    log = (yaml.load(await fs.readFile(file, "utf-8")) as typeof log) || [];
  } catch {
    log = [];
  }
  if (log.some((e) => e.plan_slug === planSlug && (e.letter_types || []).includes("recipes"))) return;
  log.push({ plan_slug: planSlug, letter_types: ["recipes"], sent_at: new Date().toISOString() } as never);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, yaml.dump(log, { sortKeys: false, lineWidth: 200 }), "utf-8");
  await fs.rename(tmp, file);
}

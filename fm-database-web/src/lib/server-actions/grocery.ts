"use server";

/**
 * Grocery-list generation for the client app's "This week's menu".
 *
 * Coach-triggered (remind-and-approve culture — nothing auto-sends).
 * Assembles the client's current fortnight menu via the SAME letter-parity
 * loader the app uses (so the list always matches what the client sees),
 * plus the recipe pack's ingredient lists, and hands both to
 * scripts/generate-grocery-list.py (one Haiku call, ~₹2). The shim writes
 * meal-plans/<planSlug>-grocery.yaml atomically; the app reads it on next
 * load and the per-minute staging refresh mirrors it to Fly.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { loadClientAppData } from "@/lib/fmdb/client-app";

export interface GroceryGenResult {
  ok: boolean;
  error?: string;
  weeks?: { week: number; items: number }[];
  generatedAt?: string;
}

async function readPlanField(planSlug: string, field: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    const entries = await fs.readdir(dir);
    const match = entries
      .filter((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"))
      .sort()
      .reverse()[0];
    if (!match) return null;
    const plan = yaml.load(await fs.readFile(path.join(dir, match), "utf-8")) as Record<string, unknown>;
    const v = plan?.[field];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** Current state of the grocery file, for the coach button's sent-state. */
export async function groceryStatusAction(
  clientId: string,
  planSlug: string,
): Promise<{ exists: boolean; generatedAt?: string; weeks?: number }> {
  try {
    const p = path.join(getPlansRoot(), "clients", clientId, "meal-plans", `${planSlug}-grocery.yaml`);
    const doc = yaml.load(await fs.readFile(p, "utf-8")) as {
      generated_at?: string;
      weeks?: unknown[];
    };
    return {
      exists: true,
      generatedAt: doc?.generated_at,
      weeks: Array.isArray(doc?.weeks) ? doc.weeks.length : 0,
    };
  } catch {
    return { exists: false };
  }
}

export async function generateGroceryListAction(
  clientId: string,
  planSlug: string,
): Promise<GroceryGenResult> {
  // Resolve the plan's letter token so we can reuse the app's own loader —
  // guarantees the grocery list is built from EXACTLY the menu the app shows.
  const token = await readPlanField(planSlug, "letter_token");
  if (!token) return { ok: false, error: "Plan has no letter token yet — share the letter/app first." };

  const data = await loadClientAppData(token);
  if (!data) return { ok: false, error: "Could not load the client app data for this plan." };
  if (!data.weekMenus.length)
    return { ok: false, error: "No weekly meal tables found — principle-based plans don't need a grocery list." };

  // Recipe pack text (ingredient lists) — newest -recipes.md sidecar if any.
  let recipesText = "";
  try {
    const dir = path.join(getPlansRoot(), "clients", clientId, "meal-plans");
    const entries = await fs.readdir(dir);
    const recipeFiles = entries.filter((n) => n.endsWith("-recipes.md")).sort().reverse();
    if (recipeFiles[0]) recipesText = await fs.readFile(path.join(dir, recipeFiles[0]), "utf-8");
  } catch {
    /* fine — the menu alone is enough */
  }

  const dietaryPreference = await (async () => {
    try {
      const raw = await fs.readFile(
        path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
        "utf-8",
      );
      const c = yaml.load(raw) as { dietary_preference?: string };
      return c?.dietary_preference ?? "";
    } catch {
      return "";
    }
  })();

  const out = (await runShim(
    "generate-grocery-list.py",
    {
      client_id: clientId,
      plan_slug: planSlug,
      dietary_preference: dietaryPreference,
      weeks: data.weekMenus.map((w) => ({
        week: w.week,
        days: w.days.map((d) => ({
          dow: d.dow,
          slots: d.slots.map((s) => ({ slot: s.slot, dish: s.dish })),
        })),
      })),
      recipes_text: recipesText,
    },
    120_000,
  )) as { ok: boolean; error?: string; weeks?: { week: number; items: number }[] };

  if (!out?.ok) return { ok: false, error: out?.error ?? "generate-grocery-list.py failed" };

  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, weeks: out.weeks, generatedAt: new Date().toISOString() };
}

"use server";

/**
 * Grocery-list generation for the client app's "This week's menu".
 *
 * Assembles the client's live menu via the SAME loader the app uses (so the
 * list always matches what the client sees), plus the recipe pack's
 * ingredient lists, and hands them to scripts/generate-grocery-list.py (one
 * Haiku call PER WEEK, ~₹2 each). The shim writes
 * meal-plans/<planSlug>-grocery.yaml atomically; the app reads it on next
 * load and the per-minute staging refresh mirrors it to Fly.
 *
 * INCREMENTAL since 2026-08-22. Every approved menu week now stays live on the
 * plan (menu-weeks.ts), so "regenerate the whole file from the live menu"
 * would mean a call per week for a 12-week client, every approval, and would
 * discard the lists already on disk. grocery-weeks.ts decides which weeks are
 * actually owed a fresh list — the current week and anything live ahead of
 * it, keyed by a fingerprint of each week's dishes — and everything else on
 * disk is carried forward untouched. A normal approval therefore costs ONE
 * call (the week that just went live). `force` (the coach's own button)
 * rebuilds the wanted weeks regardless of the key.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolveClientAppToken } from "@/lib/fmdb/app-token";
import { revalidateQuietly } from "@/lib/fmdb/revalidate-quietly";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { effectiveMealPlanStart } from "@/lib/fmdb/plan-timing";
import { planWeekFromStart } from "@/lib/fmdb/menu-weeks";
import { planGroceryRefresh, type GroceryWeekEntry, type RawMenuWeek } from "@/lib/fmdb/grocery-weeks";

export interface GroceryGenResult {
  ok: boolean;
  error?: string;
  weeks?: { week: number; items: number }[];
  /** Week numbers a fresh list was actually generated for this run. */
  generated?: number[];
  generatedAt?: string;
}

interface PlanDocLite {
  letter_token?: unknown;
  meal_plan_started_on?: unknown;
  plan_period_start?: unknown;
  app_menu?: { weeks?: RawMenuWeek[] | null } | null;
}

async function readPlanDoc(planSlug: string): Promise<PlanDocLite | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    const entries = await fs.readdir(dir);
    const match = entries
      .filter((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"))
      .sort()
      .reverse()[0];
    if (!match) return null;
    return (yaml.load(await fs.readFile(path.join(dir, match), "utf-8")) as PlanDocLite) ?? null;
  } catch {
    return null;
  }
}

interface GroceryDoc {
  generated_at?: string;
  weeks?: GroceryWeekEntry[];
}

async function readGroceryDoc(clientId: string, planSlug: string): Promise<GroceryDoc | null> {
  try {
    const p = path.join(getPlansRoot(), "clients", clientId, "meal-plans", `${planSlug}-grocery.yaml`);
    return (yaml.load(await fs.readFile(p, "utf-8")) as GroceryDoc) ?? null;
  } catch {
    return null;
  }
}

/** Is the grocery file owed any work for this plan's live menu? Pure planning
 *  over the files on disk — no app load, no token, no API call — so the daily
 *  backfill cron can ask for every client cheaply and only pay for the ones
 *  that need it. */
export async function groceryRefreshNeededAction(
  clientId: string,
  planSlug: string,
): Promise<{ generate: number[]; dropped: number[]; missing: boolean }> {
  const plan = await readPlanDoc(planSlug);
  const raw = plan?.app_menu?.weeks ?? [];
  const existing = await readGroceryDoc(clientId, planSlug);
  const start = effectiveMealPlanStart({
    meal_plan_started_on: plan?.meal_plan_started_on,
    plan_period_start: plan?.plan_period_start,
  } as Parameters<typeof effectiveMealPlanStart>[0]);
  const p = planGroceryRefresh(raw ?? [], existing?.weeks ?? [], planWeekFromStart(start, Date.now()));
  return { generate: p.generate, dropped: p.dropped, missing: !existing };
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
  opts: { force?: boolean } = {},
): Promise<GroceryGenResult> {
  const plan = await readPlanDoc(planSlug);
  // Resolve the plan's letter token so we can reuse the app's own loader —
  // guarantees the grocery list is built from EXACTLY the menu the app shows.
  // Client-level token FIRST — see app-token.ts. Reading only the plan's
  // letter_token stopped Kamla's weekly regeneration for weeks while she was
  // using the app daily.
  const letterToken = typeof plan?.letter_token === "string" && plan.letter_token ? plan.letter_token : null;
  const token = await resolveClientAppToken(clientId, letterToken);
  if (!token)
    return { ok: false, error: "The app hasn't been shared with this client yet." };

  const data = await loadClientAppData(token);
  if (!data) return { ok: false, error: "Could not load the client app data for this plan." };
  if (!data.weekMenus.length)
    return { ok: false, error: "No weekly meal tables found — principle-based plans don't need a grocery list." };

  // Which weeks are owed a fresh list? Keyed off the plan's RAW menu weeks so
  // the backfill cron (which never loads the app) reaches the same answer.
  const existing = await readGroceryDoc(clientId, planSlug);
  const start = effectiveMealPlanStart({
    meal_plan_started_on: plan?.meal_plan_started_on,
    plan_period_start: plan?.plan_period_start,
  } as Parameters<typeof effectiveMealPlanStart>[0]);
  const refresh = planGroceryRefresh(
    plan?.app_menu?.weeks ?? [],
    existing?.weeks ?? [],
    planWeekFromStart(start, Date.now()),
    !!opts.force,
  );
  const summary = (ws: GroceryWeekEntry[]) =>
    ws.map((w) => ({ week: Number(w.week), items: Array.isArray(w.items) ? w.items.length : 0 }));
  if (!refresh.generate.length && !refresh.dropped.length && existing) {
    // Nothing owed: the file already covers the weeks she will shop for, with
    // the dishes they were built from. No API call.
    return { ok: true, weeks: summary(refresh.keep), generated: [], generatedAt: existing.generated_at };
  }
  const weeksToSend = data.weekMenus.filter((w) => refresh.generate.includes(w.week));

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

  // The CATALOGUE side of the pack, which the sidecar never carried.
  //
  // `-recipes.md` holds only the AI-generated recipes, and those are written
  // solely for dishes whose HEADLINE component the catalogue could not answer.
  // So for a lunch of "Jowar bhakri + Moong dal + Turai sabzi + Curd" the model
  // got no ingredient list at all and had to infer both the ingredients and the
  // quantities from the dish name. It still bought the turai — the whole dish
  // string is on the menu it reads — but it sized it by guesswork.
  //
  // `data.recipePack` is already resolved PER COMPONENT by the app loader, so
  // every matched component's real ingredient list is available here for free.
  const packText = data.recipePack
    .filter((r) => r.ingredients?.length)
    .map((r) => {
      const head = r.serves ? `### ${r.title} (serves ${r.serves})` : `### ${r.title}`;
      return [head, ...r.ingredients.map((i) => `- ${i}`)].join("\n");
    })
    .join("\n\n");
  if (packText) {
    recipesText = recipesText
      ? `${recipesText}\n\n## Catalogue recipes on this menu\n\n${packText}`
      : `## Catalogue recipes on this menu\n\n${packText}`;
  }

  const { dietaryPreference, foodsToAvoid, country } = await (async () => {
    try {
      const raw = await fs.readFile(
        path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
        "utf-8",
      );
      const c = yaml.load(raw) as {
        dietary_preference?: string;
        foods_to_avoid?: string | string[];
        country?: string;
      };
      const fta = Array.isArray(c?.foods_to_avoid)
        ? c.foods_to_avoid.join(", ")
        : c?.foods_to_avoid ?? "";
      return { dietaryPreference: c?.dietary_preference ?? "", foodsToAvoid: fta, country: c?.country ?? "" };
    } catch {
      return { dietaryPreference: "", foodsToAvoid: "", country: "" };
    }
  })();

  const out = (await runShim(
    "generate-grocery-list.py",
    {
      client_id: clientId,
      plan_slug: planSlug,
      dietary_preference: dietaryPreference,
      foods_to_avoid: foodsToAvoid,
      country,
      weeks: weeksToSend.map((w) => ({
        week: w.week,
        menu_key: refresh.keys[w.week],
        days: w.days.map((d) => ({
          dow: d.dow,
          slots: d.slots.map((s) => ({ slot: s.slot, dish: s.dish })),
        })),
      })),
      // Lists already on disk that stay exactly as they are — the shim merges
      // them with whatever it generates and writes ONE file.
      keep_weeks: refresh.keep,
      recipes_text: recipesText,
    },
    // One call per week to generate; budget for a full force-rebuild.
    60_000 + 60_000 * Math.max(1, weeksToSend.length),
  )) as { ok: boolean; error?: string; weeks?: { week: number; items: number }[]; generated?: number[] };

  if (!out?.ok) return { ok: false, error: out?.error ?? "generate-grocery-list.py failed" };

  revalidateQuietly(`/clients-v2/${clientId}`);
  return { ok: true, weeks: out.weeks, generated: out.generated ?? refresh.generate, generatedAt: new Date().toISOString() };
}

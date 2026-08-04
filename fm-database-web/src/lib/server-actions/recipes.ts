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
import { resolveClientAppToken } from "@/lib/fmdb/app-token";
import { revalidateQuietly } from "@/lib/fmdb/revalidate-quietly";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import {
  loadClientAppData,
  loadLibraryRecipes,
  loadRemedyFallbackLibrary,
  homeRemedyAsRecipe,
  buildClientRecipeGate,
  buildLibraryRecipeResolver,
  buildHomeRemedyResolver,
  recipeConsistentWithDish,
} from "@/lib/fmdb/client-app";
import { primaryDishPart } from "@/lib/fmdb/dish-components";
import { weeklyGenerationPaused, setWeeklyGenerationPaused } from "@/lib/fmdb/weekly-generation-pause";

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
  force = false,
): Promise<RecipeGenResult> {
  // Coach-set pause — the AUTOMATIC paths only (menu approval, the freshness
  // cron). `force` is the coach pressing generate herself, which always wins:
  // she may be paused-by-default but want one week's pack for a specific
  // reason. Checked FIRST so a paused client costs nothing at all — no token
  // resolve, no app load, no Haiku call.
  if (!force && (await weeklyGenerationPaused(clientId))) {
    return {
      ok: false,
      error:
        "Weekly generation is paused for this client. Turn it back on from " +
        "the dashboard (Weekly menu + recipes) to resume.",
    };
  }
  // Client-level token FIRST — see app-token.ts. Reading only the plan's
  // letter_token stopped Kamla's weekly regeneration for weeks while she was
  // using the app daily.
  const token = await resolveClientAppToken(
    clientId,
    await readPlanField(planSlug, "letter_token"),
  );
  if (!token)
    return { ok: false, error: "The app hasn't been shared with this client yet." };

  const data = await loadClientAppData(token);
  if (!data) return { ok: false, error: "Could not load the client app data for this plan." };
  if (!data.weekMenus.length)
    return { ok: false, error: "No weekly menu — principle-based plans don't need a recipe pack." };

  const client = await (async () => {
    try {
      const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf-8");
      return yaml.load(raw) as { dietary_preference?: string; foods_to_avoid?: string | string[]; country?: string };
    } catch {
      return {} as { dietary_preference?: string; foods_to_avoid?: string | string[]; country?: string };
    }
  })();
  const foodsToAvoid = Array.isArray(client.foods_to_avoid)
    ? client.foods_to_avoid.join(", ")
    : client.foods_to_avoid ?? "";

  // ── The dish names THIS client's catalogue actually answers ────────────────
  // The generator skips writing a recipe for any dish the catalogue already
  // covers — the standing rule is prefer curated content, minimise AI recipes.
  // It used to decide that against the WHOLE library, which is not what the
  // client's app resolves against: her diet, the Jain screen and her avoid list
  // remove recipes first.
  //
  // Reported 2026-07-28 (cl-004, Jain, avoids onion + garlic): the catalogue has
  // "Foxtail millet pulao", so the generator skipped it; the app then dropped
  // that recipe for naming onion, and her lunch reached the phone with no method
  // from either tier. Every restricted client had a guaranteed hole wherever the
  // catalogue's only version of a dish uses something they avoid.
  //
  // Sending the GATED list closes it: a recipe she cannot see is no longer a
  // reason not to write her one. Computed with buildClientRecipeGate — the same
  // gate loadClientAppData applies — so the two answers cannot drift.
  const clientGate = buildClientRecipeGate(client);
  const visibleLibrary = (await loadLibraryRecipes()).filter((l) => clientGate(l.recipe));
  const visibleRemedies = (await loadRemedyFallbackLibrary()).filter((r) =>
    clientGate({ ...homeRemedyAsRecipe(r), ingredients: [...r.prepSteps, r.dose] }),
  );
  const visibleCatalogueTitles = [
    ...visibleLibrary.flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])]),
    ...visibleRemedies.flatMap((r) => [r.name, ...r.aliases]),
  ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  // And the verdict itself, decided HERE rather than by the shim's mirror of the
  // matcher. The shim splits a cell on the literal first component, so a slot
  // written "lime juice (1 tsp) pre-meal shot — then: Turai sabzi (3/4 cup) + …"
  // keyed on the lime shot and paid to rewrite a Turai sabzi the app was already
  // serving from the catalogue. This is the app's own resolver — component
  // splitting, the sequence connective, the consistency gate — so "would the
  // client see a catalogue method for this dish?" is answered once, by the code
  // that actually answers it at render time.
  const libFor = buildLibraryRecipeResolver(visibleLibrary);
  const remFor = buildHomeRemedyResolver(visibleRemedies);
  const coveredDishes = [
    ...new Set(
      data.weekMenus
        .flatMap((w) => w.days.flatMap((d) => d.slots.map((s) => s.dish)))
        .filter((dish): dish is string => typeof dish === "string" && !!dish.trim())
        .filter((dish) => {
          const head = primaryDishPart(dish);
          const L = libFor(dish);
          return Boolean((L && recipeConsistentWithDish(head, L)) || remFor(dish));
        }),
    ),
  ];

  const out = (await runShim(
    "generate-week-recipes.py",
    {
      client_id: clientId,
      plan_slug: planSlug,
      dietary_preference: client.dietary_preference ?? "",
      foods_to_avoid: foodsToAvoid,
      country: client.country ?? "",
      catalogue_titles: visibleCatalogueTitles,
      covered_dishes: coveredDishes,
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

  revalidateQuietly(`/clients-v2/${clientId}`);
  return { ok: true, count: out.count, generatedAt: new Date().toISOString() };
}

/** Append a `{letter_types:[recipes], plan_slug}` entry to the client's
 *  meal-plans/_send_log.yaml so the app treats the
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

/* ── Coach-set weekly-generation pause ───────────────────────────────────
   Roster + toggle behind the dashboard's "Weekly menu + recipes" panel. The
   roster is deliberately the SAME population the weekly-menu cadence covers
   (a real published plan with a weekly menu), because a client with no menu
   has nothing to pause in the first place — listing them would be offering a
   switch that does nothing.

   Lives here rather than in weekly-menu.ts only because the toggle shipped
   with the recipe half first; the flag itself governs both and is read by
   generateWeekMenuAction too.                                              */

export interface WeeklyGenerationPauseRow {
  clientId: string;
  planSlug: string;
  paused: boolean;
}

/** Every weekly-menu client with their current pause state. */
export async function weeklyGenerationPauseRosterAction(): Promise<WeeklyGenerationPauseRow[]> {
  const dir = path.join(getPlansRoot(), "published");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const rows: WeeklyGenerationPauseRow[] = [];
  const seen = new Set<string>();
  for (const n of names.sort().reverse()) {
    if (!n.endsWith(".yaml") && !n.endsWith(".yml")) continue;
    let p: {
      client_id?: string;
      slug?: string;
      no_weekly_menu?: boolean;
      app_menu?: { is_sample?: boolean };
    };
    try {
      p = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as typeof p) ?? {};
    } catch {
      continue;
    }
    const cid = String(p.client_id ?? "");
    // Newest plan per client wins (names sorted descending) — a client with
    // several published plans must not appear twice with conflicting rows.
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    if (p.app_menu?.is_sample) continue; // hybrid/sample — one fixed week, no cadence
    if (p.no_weekly_menu) continue; // principle plan — no menu by design
    rows.push({
      clientId: cid,
      planSlug: String(p.slug ?? ""),
      paused: await weeklyGenerationPaused(cid),
    });
  }
  return rows.sort((a, b) => a.clientId.localeCompare(b.clientId));
}

/** Is weekly generation paused for ONE client? For the client-overview
 *  toggle, which has no reason to read the whole roster. */
export async function isWeeklyGenerationPausedAction(clientId: string): Promise<boolean> {
  return weeklyGenerationPaused(clientId);
}

/** Pause or resume weekly generation for one client. */
export async function setWeeklyGenerationPausedAction(
  clientId: string,
  paused: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const res = await setWeeklyGenerationPaused(clientId, paused);
  if (!res.ok) return res;
  revalidateQuietly(`/clients-v2/${clientId}`);
  revalidateQuietly("/dashboard-v2");
  return { ok: true };
}

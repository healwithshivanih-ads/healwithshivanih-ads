"use server";

/**
 * Weekly menu cadence (coach decision 2026-06-12, replaces fortnightly
 * meal-plan letters): next week's menu is AUTO-DRAFTED (cron or one click)
 * onto plan.app_menu_pending, the coach reviews it in the Plan-tab studio
 * (live phone preview), and Approve merges it into app_menu — the client's
 * app updates instantly with a "Plan updated" note in the client's voice.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { DORMANT_DAYS, daysSinceLastAppOpen } from "@/lib/fmdb/app-engagement";
import { getCataloguePath, getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { effectiveMealPlanStart } from "@/lib/fmdb/plan-timing";
import { menuNutrition, type MenuNutrition } from "@/lib/fmdb/menu-nutrients";
import { screenMenuForClient, type MenuStapleFlag } from "@/lib/fmdb/food-cautions";
import { weeksAfterApproval } from "@/lib/fmdb/menu-weeks";
import { weeklyGenerationPaused } from "@/lib/fmdb/weekly-generation-pause";
import { generateGroceryListAction } from "./grocery";

export interface PendingWeekMenu {
  week: number;
  days: { slots: { slot: string; dish: string }[] }[];
  change_note: string;
  generated_at: string;
  inputs_summary?: string;
}

interface PlanDoc {
  slug?: string;
  client_id?: string;
  app_menu?: { is_sample?: boolean; weeks?: { week?: number; days?: unknown[] }[] } | null;
  app_menu_pending?: PendingWeekMenu | null;
  amendments?: unknown[];
  client_update_note?: string | null;
  app_content_updated_at?: string;
  meal_plan_started_on?: string;
  plan_period_start?: string;
  plan_period_weeks?: number;
  no_weekly_menu?: boolean; // principle plan — never auto-draft a weekly menu
  [k: string]: unknown;
}

async function publishedFileForClient(
  clientId: string,
): Promise<{ file: string; plan: PlanDoc } | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    for (const n of (await fs.readdir(dir)).sort().reverse()) {
      if (!n.endsWith(".yaml")) continue;
      const f = path.join(dir, n);
      const p = (yaml.load(await fs.readFile(f, "utf-8")) as PlanDoc) ?? {};
      if (p.client_id === clientId) return { file: f, plan: p };
    }
  } catch {
    /* none */
  }
  return null;
}

/** client.meal_plan_style — "detailed" | "principles" | "hybrid" (default
 *  "hybrid"). Only "principles" changes weekly-cadence gating here: it means
 *  no fixed weekly menu by design, same intent as the (never-written)
 *  plan.no_weekly_menu flag. "detailed" vs "hybrid" is NOT used to gate the
 *  cron — that's still driven by the plan's actual app_menu.is_sample (week
 *  count), so flipping the picker alone can't silently stop/start cadence
 *  for a client whose menu was already generated under the old default. */
async function mealPlanStyle(clientId: string): Promise<"detailed" | "principles" | "hybrid"> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const doc = (yaml.load(await fs.readFile(f, "utf-8")) as { meal_plan_style?: string }) ?? {};
    // Case/whitespace-tolerant: the UI always writes a lowercase exact value,
    // but a hand-edited client.yaml (or a value carried over from before this
    // toggle existed) shouldn't silently fail to opt a client out of the
    // weekly cadence just because it reads "Principles" or " principles ".
    const v = String(doc.meal_plan_style ?? "").trim().toLowerCase();
    return v === "detailed" || v === "principles" ? (v as "detailed" | "principles") : "hybrid";
  } catch {
    return "hybrid";
  }
}

/* daysSinceLastAppOpen + DORMANT_DAYS moved to lib/fmdb/app-engagement.ts —
   the practice drip needs the same dormancy read, and a second copy of it
   would have drifted. Behaviour here is unchanged; see that module for why
   the client app cannot use this same absent-side reading. */

/** The client's current plan week (1-based), from the same Day-1 anchor the
 *  app uses. Returns 1 when no anchor exists yet. */
function currentPlanWeek(plan: PlanDoc): number {
  const start = effectiveMealPlanStart({
    meal_plan_started_on: plan.meal_plan_started_on,
    plan_period_start: plan.plan_period_start,
  } as Parameters<typeof effectiveMealPlanStart>[0]);
  if (!start) return 1;
  const days = Math.floor((Date.now() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

export interface WeeklyMenuStatus {
  ok: true;
  planSlug: string;
  currentWeek: number;
  totalWeeks: number;
  /** menu already covers next week (approved) */
  nextWeekReady: boolean;
  pending: PendingWeekMenu | null;
  /** structured menu exists at all (weekly cadence only applies then) */
  hasMenu: boolean;
  isSample: boolean;
  /** per-day protein/fibre/kcal for the PENDING menu vs client targets;
   *  null when there's no pending menu to balance. */
  pendingNutrition: MenuNutrition | null;
  /** Slots in the PENDING menu whose headline dish has no matching recipe, so
   *  the client would tap it and get nothing. Surfaced at review time because
   *  that is the last point where fixing it is cheap — once approved it is in
   *  her app. See unresolvedDishesForWeek(). */
  pendingUnresolved: { day: number; slot: string; dish: string; primary: string }[];
  /** Condition ↔ food cautions where a cautioned food has become the week's
   *  DEFAULT rather than an occasional — e.g. ragi in most meals for a
   *  hypothyroid client. Rule 15 tells the drafter to keep these occasional;
   *  this is the check that the draft actually did. Surfaced at review time
   *  because that is the last cheap moment to fix it. Never blocks approval. */
  pendingCautionFlags: MenuStapleFlag[];
}

async function loadClientDoc(clientId: string): Promise<Record<string, unknown> | null> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    return (yaml.load(await fs.readFile(f, "utf-8")) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** Menu slots whose PRIMARY dish component matches no recipe.
 *
 *  WHY THIS EXISTS: a menu dish is free text, and the client app resolves it to
 *  a recipe by name. If the headline component has no recipe, the client taps a
 *  meal and gets nothing — or, before the primary-component fix, got a TRAILING
 *  SIDE's recipe (cl-022's evening snack read "Sabja seeds drink + Masala
 *  Roasted Chana" and opened the chana method). The matcher now refuses to show
 *  a wrong recipe, which converts a silent mis-match into a silent blank.
 *
 *  Neither is acceptable to ship unknowingly, so the check runs at REVIEW time —
 *  the last moment where a fix is one word in the studio rather than a re-publish.
 *  It reports; it never blocks. Some dishes legitimately have no recipe (a piece
 *  of fruit, a cup of coffee), so this is a prompt for the coach's judgement,
 *  not a gate. */
/** Whole-food names from the ingredient table (201 canonical + 585 aliases).
 *
 *  A menu slot reading "Kiwi (1)" or "Brazil nuts (2)" has NO recipe and needs
 *  none — nobody wants a method for a kiwi. Without this the unresolved-dish
 *  report is 371 rows of mostly-fine produce, which the coach would correctly
 *  learn to ignore, and the handful of real problems would drown in it. A guard
 *  nobody reads is worse than no guard. */
let wholeFoodCache: Set<string> | null = null;
async function wholeFoodNames(): Promise<Set<string>> {
  if (wholeFoodCache) return wholeFoodCache;
  const out = new Set<string>();
  try {
    const f = path.join(getCataloguePath(), "_ingredient_nutrients.yaml");
    const doc = (yaml.load(await fs.readFile(f, "utf-8")) as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(doc)) {
      if (!v || typeof v !== "object" || !("per_100g" in (v as object))) continue;
      out.add(k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
      for (const a of ((v as { aliases?: string[] }).aliases ?? [])) {
        out.add(String(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
      }
    }
  } catch {
    /* table unreadable — fall back to reporting everything rather than hiding problems */
  }
  wholeFoodCache = out;
  return out;
}

/** Strip the portion annotation and any count so "Brazil nuts (2)" and "2 Kiwi"
 *  both reduce to bare words for the whole-food lookup. */
function bareFoodWords(s: string): string[] {
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zA-Z ]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Descriptors and units that carry no dish identity — "fresh", "piece", "small".
 *  A primary made only of these plus known foods is produce, not a recipe. */
const FOOD_FILLER = new Set([
  "fresh", "piece", "pieces", "small", "large", "medium", "raw", "plain", "whole",
  "cup", "glass", "bowl", "tbsp", "tsp", "soaked", "ripe", "seasonal", "handful",
  "chopped", "sliced", "a", "of", "and", "or", "with", "long", "black", "warm",
  "cold", "hot", "boiled", "half", "quarter",
]);

/** Foods the ingredient table doesn't carry but which plainly need no method. */
const EXTRA_WHOLE_FOODS = new Set(["coffee", "tea", "water", "kiwi", "milk", "curd"]);

export async function unresolvedDishesForWeek(
  week: { days?: { slots?: { slot?: string; dish?: string }[] }[] } | null | undefined,
): Promise<{ day: number; slot: string; dish: string; primary: string }[]> {
  if (!week?.days?.length) return [];
  const [{ loadLibraryRecipes, buildLibraryRecipeResolver }, { primaryDishPart }] =
    await Promise.all([import("@/lib/fmdb/client-app"), import("@/lib/fmdb/dish-components")]);
  const resolve = buildLibraryRecipeResolver(await loadLibraryRecipes());
  const foods = await wholeFoodNames();
  const out: { day: number; slot: string; dish: string; primary: string }[] = [];
  week.days.forEach((day, i) => {
    for (const sl of day?.slots ?? []) {
      const dish = String(sl?.dish ?? "").trim();
      if (!dish) continue;
      if (resolve(dish)) continue;
      const primary = primaryDishPart(dish);
      // A plain whole food legitimately has no method — don't report it. The
      // test is that EVERY meaningful word is a known food or a bare descriptor,
      // so "fresh coconut piece" is produce but "Butter chicken" is a real gap.
      const words = bareFoodWords(primary);
      const allFood =
        words.length > 0 &&
        words.every(
          (w) =>
            FOOD_FILLER.has(w) ||
            EXTRA_WHOLE_FOODS.has(w) ||
            foods.has(w) ||
            [...foods].some((f) => f === w || f.split(" ").includes(w)),
        );
      if (allFood) continue;
      out.push({ day: i + 1, slot: String(sl?.slot ?? ""), dish, primary });
    }
  });
  return out;
}

export async function weeklyMenuStatusAction(
  clientId: string,
): Promise<WeeklyMenuStatus | { ok: false; error: string }> {
  const hit = await publishedFileForClient(clientId);
  if (!hit) return { ok: false, error: "No published plan." };
  const { plan } = hit;
  const weeks = plan.app_menu?.weeks ?? [];
  const cur = currentPlanWeek(plan);
  const pending = plan.app_menu_pending ?? null;
  let pendingNutrition: MenuNutrition | null = null;
  let pendingCautionFlags: MenuStapleFlag[] = [];
  if (pending?.days?.length) {
    const clientDoc = await loadClientDoc(clientId);
    try {
      pendingNutrition = menuNutrition(pending.days, clientDoc, {
        plan: plan as unknown as Record<string, unknown>,
      });
    } catch {
      pendingNutrition = null; // never block the review over a nutrient calc
    }
    try {
      // Rule 15 asks the drafter to keep a cautioned food occasional; this is
      // the check that it did. Frequency is invisible per-dish — every meal in
      // an all-ragi week looks fine on its own.
      pendingCautionFlags = await screenMenuForClient(
        (clientDoc ?? {}) as Parameters<typeof screenMenuForClient>[0],
        pending.days.flatMap((d) => (d.slots ?? []).map((s) => String(s.dish ?? ""))),
      );
    } catch {
      pendingCautionFlags = []; // advisory only — never block the review
    }
  }
  return {
    ok: true,
    planSlug: String(plan.slug ?? ""),
    currentWeek: cur,
    totalWeeks: Number(plan.plan_period_weeks) || 12,
    nextWeekReady: weeks.some((w) => Number(w.week) === cur + 1),
    pending,
    hasMenu: weeks.length > 0,
    isSample: !!plan.app_menu?.is_sample,
    pendingNutrition,
    pendingUnresolved: pending ? await unresolvedDishesForWeek(pending) : [],
    pendingCautionFlags,
  };
}

/** Draft next week's menu via the Sonnet shim (~30-60s, ~$0.05). */
export async function generateWeekMenuAction(
  clientId: string,
  force = false,
): Promise<{ ok: boolean; error?: string; changeNote?: string; week?: number }> {
  const hit = await publishedFileForClient(clientId);
  if (!hit) return { ok: false, error: "No published plan." };
  if (hit.plan.app_menu?.is_sample) {
    return { ok: false, error: "Hybrid/sample plan — it uses one fixed sample week, not a weekly cadence." };
  }
  if (hit.plan.no_weekly_menu || (await mealPlanStyle(clientId)) === "principles") {
    return { ok: false, error: "Principle plan — it shows the eating framework only (no weekly menu)." };
  }
  // Coach-set pause — checked BEFORE dormancy because it is the stronger
  // statement: dormancy asks "has she disappeared?", this one says "she is
  // here, she just does not need a new menu every week." She stays frozen on
  // her last loaded week (client-app.ts falls back to it), which is the point.
  if (!force && (await weeklyGenerationPaused(clientId))) {
    return {
      ok: false,
      error:
        "Weekly generation is paused for this client — she stays on her " +
        "current menu. Turn it back on from the dashboard (Weekly menu + " +
        "recipes), or use Draft menu to override just this once.",
    };
  }
  // Auto-draft is paused for dormant clients (see DORMANT_DAYS). This is the
  // AUTOMATIC path only — the coach pressing "Draft menu" in the UI passes
  // force and always wins, because she may be prepping for a client she has
  // just re-engaged over WhatsApp.
  if (!force && DORMANT_DAYS > 0) {
    const dormant = await daysSinceLastAppOpen(clientId);
    if (dormant !== null && dormant >= DORMANT_DAYS) {
      return {
        ok: false,
        error:
          `Auto-draft paused — client hasn't opened the app in ${dormant} days ` +
          `(threshold ${DORMANT_DAYS}). It resumes on their next open; use the ` +
          `Draft menu button to override.`,
      };
    }
  }
  // Catch-up aware: if the CURRENT plan week has no menu, draft THAT (never
  // skip it → no more non-contiguous [4,6]); otherwise pre-load next week.
  const cur = currentPlanWeek(hit.plan);
  const loaded = hit.plan.app_menu?.weeks ?? [];
  const currentReady = loaded.some((w) => Number(w.week) === cur);
  const target = currentReady ? cur + 1 : cur;
  const out = (await runShim(
    "generate-week-menu.py",
    { client_id: clientId, plan_slug: hit.plan.slug, target_week: target },
    240_000,
  )) as { ok: boolean; error?: string; change_note?: string; week?: number };
  if (!out?.ok) return { ok: false, error: out?.error ?? "generation failed" };
  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, changeNote: out.change_note, week: out.week };
}

/** Called right after the coach flips client.meal_plan_style → "detailed".
 *  A principles/hybrid client typically has zero (or exactly one, sample)
 *  weeks of structured app_menu — the picker alone doesn't create the daily
 *  grid the client sees. This runs the SAME constraint engine as the initial
 *  detailed build (scripts/generate-app-menu.py — dosha rules, exclusions,
 *  seasonality, calorie/protein targets) for the client's current + next
 *  plan week, and writes it straight onto the published plan (no draft/
 *  approve step — this is an explicit coach action, not the weekly cron).
 *  Once 2+ weeks exist, app_menu.is_sample flips false and the normal
 *  weekly cron (generate-week-menu.py) takes over the recurring cadence.
 *  No-ops (ok:true, alreadyDetailed:true) if the plan already has a real
 *  (non-sample, 2+ week) menu — safe to call unconditionally. ~1-2 min. */
export async function ensureDetailedMenuAction(
  clientId: string,
): Promise<{ ok: boolean; alreadyDetailed?: boolean; weeks?: number; dishes?: number; error?: string }> {
  const hit = await publishedFileForClient(clientId);
  if (!hit) return { ok: false, error: "No published plan." };
  const weeksNow = hit.plan.app_menu?.weeks ?? [];
  if (weeksNow.length >= 2 && !hit.plan.app_menu?.is_sample) {
    return { ok: true, alreadyDetailed: true };
  }
  const cur = currentPlanWeek(hit.plan);
  try {
    const { runShim } = await import("@/lib/fmdb/shim");
    const out = (await runShim(
      "generate-app-menu.py",
      { client_id: clientId, plan_slug: hit.plan.slug, weeks: [cur, cur + 1] },
      360_000,
    )) as { ok: boolean; weeks?: number; dishes?: number; error?: string };
    if (!out?.ok) return { ok: false, error: out?.error ?? "generation failed" };
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true, weeks: out.weeks, dishes: out.dishes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "generation failed" };
  }
}

/** Coach approval: the pending week goes LIVE on the client's app. */
export async function approveWeekMenuAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const hit = await publishedFileForClient(clientId);
    if (!hit) return { ok: false, error: "No published plan." };
    // fresh read at write time
    const doc = (yaml.load(await fs.readFile(hit.file, "utf-8")) as PlanDoc) ?? {};
    const pending = doc.app_menu_pending;
    if (!pending) return { ok: false, error: "Nothing pending to approve." };

    const menu = doc.app_menu ?? { weeks: [] };
    const weeks = (menu.weeks ?? []).filter((w) => Number(w.week) !== pending.week);
    weeks.push({ week: pending.week, day_dates: null, days: pending.days } as never);
    weeks.sort((a, b) => Number(a.week) - Number(b.week));
    // Keep the approved week and the one before it — "current + next" is all
    // the app shows, and it keeps the grocery "next week unlocks early"
    // window working.
    //
    // This was `slice(-2)`, the two numerically HIGHEST weeks, which assumes
    // week numbers only ever climb within one plan. A continuing client breaks
    // that: her phase-3 plan carries the predecessor's weeks 11 and 12 (so the
    // app is never menu-less mid-transition), so approving week 1 of the new
    // phase sorted to [1, 11, 12] and sliced the newly approved week straight
    // back off. The coach approved a menu on 2026-08-02, the amendment logged
    // "approved and live", and the menu was silently discarded.
    //
    // Anchoring on the approved week instead also self-cleans: the moment a new
    // phase's week 1 is approved, the previous phase's carried weeks drop out.
    // Rule lives in menu-weeks.ts so it can be tested without a plan file.
    menu.weeks = weeksAfterApproval(weeks, pending.week);
    menu.is_sample = false;
    doc.app_menu = menu;
    doc.app_menu_pending = null;
    if (pending.change_note) doc.client_update_note = pending.change_note;
    doc.app_content_updated_at = new Date().toISOString();
    const amendments = Array.isArray(doc.amendments) ? doc.amendments : [];
    amendments.push({
      at: new Date().toISOString(),
      by: "Shivani",
      field: "app_menu",
      summary: `Week ${pending.week} menu approved and live${pending.change_note ? ` — "${pending.change_note}"` : ""}.`,
    });
    doc.amendments = amendments;

    const tmp = `${hit.file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
    await fs.rename(tmp, hit.file);
    revalidatePath(`/clients-v2/${clientId}`);

    // The menu is now durably live (written + revalidated above). Push a gentle
    // "new menu" nudge synchronously (quick + best-effort), then refresh the 🛒
    // grocery list and recipe pack in the BACKGROUND. Those are heavy shims
    // (tens of seconds each) and must NEVER block the coach's approval — an
    // inline await here is exactly what hung the UI when the recipe pack
    // truncated. This fire-and-forget is safe ONLY because the coach UI runs as
    // a long-lived PM2 process on the Mac (never serverless, never on Fly), so
    // the detached promise runs to completion. Each shim re-reads the plan by
    // slug, is best-effort, and revalidates /clients-v2/<id> itself, so the
    // panel picks up the fresh grocery + recipes on a later load(). Failures go
    // to the server log, not the UI (the dashboard 🛒 chip still flags a
    // genuinely missing list). If this ever moved to a serverless runtime, use
    // after()/a cron-drain queue instead of a bare detached promise.
    const slug = String(doc.slug ?? hit.plan?.slug ?? "");

    // Push the client a gentle "new menu" nudge (only fires if they've enabled
    // notifications in the app's settings).
    try {
      const { sendPushToClient } = await import("@/lib/fmdb/push-server");
      const tok = (doc as { letter_token?: string }).letter_token ?? "";
      await sendPushToClient(clientId, {
        title: "This week's menu is ready 🌿",
        body:
          (pending.change_note && String(pending.change_note).slice(0, 110)) ||
          "Your new week is live — tap to see what's cooking.",
        url: tok ? `/app/${tok}` : "/",
        tag: "menu-live",
      });
    } catch {
      /* push is optional — never affects approval */
    }

    // Background grocery + recipe refresh — never awaited, never blocks approval.
    void (async () => {
      try {
        const g = await generateGroceryListAction(clientId, slug);
        if (!g.ok) console.error(`[weekly-menu] ${clientId}: grocery refresh failed: ${g.error}`);
      } catch (e) {
        console.error(`[weekly-menu] ${clientId}: grocery refresh threw: ${e instanceof Error ? e.message : "unknown"}`);
      }
      try {
        const { generateWeekRecipesAction } = await import("./recipes");
        const r = await generateWeekRecipesAction(clientId, slug);
        if (!r.ok) console.error(`[weekly-menu] ${clientId}: recipe pack failed: ${r.error}`);
      } catch (e) {
        console.error(`[weekly-menu] ${clientId}: recipe pack threw: ${e instanceof Error ? e.message : "unknown"}`);
      }
    })().catch(() => {});

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "approve failed" };
  }
}

/** Discard a pending draft (coach will regenerate or skip this week). */
export async function dismissPendingMenuAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const hit = await publishedFileForClient(clientId);
    if (!hit) return { ok: false, error: "No published plan." };
    const doc = (yaml.load(await fs.readFile(hit.file, "utf-8")) as PlanDoc) ?? {};
    if (!doc.app_menu_pending) return { ok: true };
    doc.app_menu_pending = null;
    const tmp = `${hit.file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
    await fs.rename(tmp, hit.file);
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "dismiss failed" };
  }
}

/** Queue scan: every published, menu-bearing client who needs a draft —
 *  EITHER their CURRENT plan week has no menu loaded (caught behind → urgent,
 *  draft the current week to catch up), OR the next week starts within
 *  `withinDays` and isn't loaded yet (pre-load). `targetWeek` is the week to
 *  generate: the current week when it's missing (never skip it), else next.
 *  The cron auto-drafts these; the dashboard panel lists them. */
interface WeekOverride {
  date_from?: string;
  date_to?: string;
  mode?: string;
  context?: string;
  reason?: string;
  location?: string;
}

/** Does the client have a travel / maintenance window (weight_loss.week_overrides)
 *  overlapping the given week? If so we DON'T auto-draft a menu for that week —
 *  the coach set the window precisely so the client isn't on the normal plan. */
async function travelOverrideForWeek(
  clientId: string,
  weekStartMs: number,
  weekEndMs: number,
): Promise<string | null> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const doc =
      (yaml.load(await fs.readFile(f, "utf-8")) as {
        weight_loss?: { week_overrides?: WeekOverride[] };
      }) ?? {};
    for (const o of doc.weight_loss?.week_overrides ?? []) {
      if (!o?.date_from || !o?.date_to) continue;
      const from = new Date(`${o.date_from}T00:00:00Z`).getTime();
      const to = new Date(`${o.date_to}T23:59:59Z`).getTime();
      if (from <= weekEndMs && to >= weekStartMs) {
        const label = o.reason || o.context || o.mode || "travel";
        return o.location ? `${label} (${o.location})` : String(label);
      }
    }
  } catch {
    /* no client file / parse error → treat as no override */
  }
  return null;
}

export async function weeklyMenuQueueAction(withinDays = 3): Promise<
  {
    clientId: string;
    planSlug: string;
    currentWeek: number;
    targetWeek: number;
    daysToNextWeek: number;
    behind: boolean; // current week's menu is missing (urgent catch-up)
    pending: boolean;
    onTravel: boolean; // target week overlaps a travel/maintenance override
    travelNote?: string;
    changeNote?: string;
    dormantDays?: number; // set when auto-draft is PAUSED (client not opening the app)
    coachPaused?: boolean; // set when the COACH paused weekly generation for them
  }[]
> {
  const dir = path.join(getPlansRoot(), "published");
  const rows: Awaited<ReturnType<typeof weeklyMenuQueueAction>> = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return rows;
  }
  const seen = new Set<string>();
  for (const n of names.sort().reverse()) {
    if (!n.endsWith(".yaml")) continue;
    try {
      const p = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as PlanDoc) ?? {};
      const cid = String(p.client_id ?? "");
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      if (p.app_menu?.is_sample) continue; // hybrid/sample plan — no weekly cadence
      if (p.no_weekly_menu) continue; // principle plan — no menu by design (opt-out flag)
      if ((await mealPlanStyle(cid)) === "principles") continue; // client.meal_plan_style opt-out
      // Coach-paused → emit and SHORT-CIRCUIT, for exactly the reason spelled
      // out for dormancy below: "who is paused" is a standing fact about the
      // client, not a function of what is due this instant, so it must not be
      // gated on due-ness or it goes invisible on the days nothing is owed.
      // Checked before dormancy so a client who is both reads as coach-paused,
      // which is the decision that actually governs.
      if (await weeklyGenerationPaused(cid)) {
        const curWeek = currentPlanWeek(p);
        rows.push({
          clientId: cid,
          planSlug: String(p.slug ?? ""),
          currentWeek: curWeek,
          targetWeek: curWeek,
          daysToNextWeek: 0,
          behind: false,
          pending: !!p.app_menu_pending,
          onTravel: false,
          coachPaused: true,
        });
        continue;
      }
      // Dormant in the app → auto-drafting is off for them. Emit the row here
      // and SHORT-CIRCUIT, deliberately bypassing the due/pending logic below.
      //
      // The obvious implementation — tag the row and let it fall through, the
      // way `onTravel` does — looks right and is wrong: a client whose current
      // AND next week are already loaded is `!due && !pending`, so the row gets
      // dropped further down and the pause becomes invisible on exactly the
      // days nothing is owed. All three currently-dormant clients were in that
      // state, so the panel rendered empty. "Who is paused" is a standing fact
      // about the client, not a function of what's due this instant, so it must
      // not be gated on due-ness.
      const dormantRaw = DORMANT_DAYS > 0 ? await daysSinceLastAppOpen(cid) : null;
      if (dormantRaw !== null && dormantRaw >= DORMANT_DAYS) {
        const curWeek = currentPlanWeek(p);
        rows.push({
          clientId: cid,
          planSlug: String(p.slug ?? ""),
          currentWeek: curWeek,
          targetWeek: curWeek,
          daysToNextWeek: 0,
          behind: false,
          pending: !!p.app_menu_pending,
          onTravel: false,
          dormantDays: dormantRaw,
        });
        continue;
      }
      const weeks = p.app_menu?.weeks ?? [];
      // weeks may be EMPTY here: a real (non-hybrid, non-principle) plan that's
      // missing its menu entirely → it falls through and gets its FIRST week
      // auto-drafted (currentReady=false → behind → targetWeek=cur). Principle
      // plans are excluded above, so an empty menu now means "real plan needs
      // a menu", not "framework-only by design".
      const cur = currentPlanWeek(p);
      const total = Number(p.plan_period_weeks) || 12;
      if (cur > total) continue; // plan over — recycle, never extend
      const start = effectiveMealPlanStart({
        meal_plan_started_on: p.meal_plan_started_on,
        plan_period_start: p.plan_period_start,
      } as Parameters<typeof effectiveMealPlanStart>[0]);
      if (!start) continue;
      const nextWeekStart = new Date(`${start}T00:00:00Z`).getTime() + cur * 7 * 86_400_000;
      const daysTo = Math.ceil((nextWeekStart - Date.now()) / 86_400_000);
      const has = (w: number) => weeks.some((x) => Number(x.week) === w);
      const currentReady = has(cur);
      const nextReady = has(cur + 1);
      const pending = p.app_menu_pending ?? null;
      // Catch up the CURRENT week first if it's missing (the bug that produced
      // non-contiguous [4,6] menus); otherwise pre-load NEXT week.
      const targetWeek = !currentReady ? cur : cur + 1;
      if (targetWeek > total) continue; // don't draft beyond the plan
      // Due when: current week missing (urgent, any time), OR next week is
      // imminent and not loaded. A pending draft still lists (dashboard), the
      // cron filters it out so we never double-draft.
      const due = !currentReady || (!nextReady && daysTo <= withinDays);
      if (!due && !pending) continue;
      // Skip clients whose target week falls in a travel/maintenance window —
      // the coach set that window on purpose. A row already pending during
      // travel still lists (so the coach can dismiss it) but flagged onTravel.
      const targetStartMs = new Date(`${start}T00:00:00Z`).getTime() + (targetWeek - 1) * 7 * 86_400_000;
      const travelNote = await travelOverrideForWeek(cid, targetStartMs, targetStartMs + 6 * 86_400_000);
      rows.push({
        clientId: cid,
        planSlug: String(p.slug ?? ""),
        currentWeek: cur,
        targetWeek,
        daysToNextWeek: daysTo,
        behind: !currentReady,
        pending: !!pending,
        onTravel: !!travelNote,
        travelNote: travelNote ?? undefined,
        changeNote: pending?.change_note,
      });
    } catch {
      /* skip unparseable */
    }
  }
  // Most-behind first, then soonest next-week.
  rows.sort((a, b) => Number(b.behind) - Number(a.behind) || a.daysToNextWeek - b.daysToNextWeek);
  return rows;
}

/** Approve EVERY pending menu in one go (skips travel-paused clients — those
 *  shouldn't go live during a holiday). Each approval pushes that client, so
 *  this is a deliberate coach action. Runs sequentially; one failure doesn't
 *  stop the rest. */
export async function approveAllPendingMenusAction(): Promise<{
  ok: boolean;
  approved: number;
  failed: { clientId: string; error?: string }[];
}> {
  const targets = (await weeklyMenuQueueAction(7)).filter((r) => r.pending && !r.onTravel);
  let approved = 0;
  const failed: { clientId: string; error?: string }[] = [];
  for (const r of targets) {
    const res = await approveWeekMenuAction(r.clientId);
    if (res.ok) approved += 1;
    else failed.push({ clientId: r.clientId, error: res.error });
  }
  revalidatePath("/dashboard-v2");
  return { ok: true, approved, failed };
}
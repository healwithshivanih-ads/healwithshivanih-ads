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
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { effectiveMealPlanStart } from "@/lib/fmdb/plan-timing";
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
}

export async function weeklyMenuStatusAction(
  clientId: string,
): Promise<WeeklyMenuStatus | { ok: false; error: string }> {
  const hit = await publishedFileForClient(clientId);
  if (!hit) return { ok: false, error: "No published plan." };
  const { plan } = hit;
  const weeks = plan.app_menu?.weeks ?? [];
  const cur = currentPlanWeek(plan);
  return {
    ok: true,
    planSlug: String(plan.slug ?? ""),
    currentWeek: cur,
    totalWeeks: Number(plan.plan_period_weeks) || 12,
    nextWeekReady: weeks.some((w) => Number(w.week) === cur + 1),
    pending: plan.app_menu_pending ?? null,
    hasMenu: weeks.length > 0,
    isSample: !!plan.app_menu?.is_sample,
  };
}

/** Draft next week's menu via the Sonnet shim (~30-60s, ~$0.05). */
export async function generateWeekMenuAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string; changeNote?: string; week?: number }> {
  const hit = await publishedFileForClient(clientId);
  if (!hit) return { ok: false, error: "No published plan." };
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

/** Coach approval: the pending week goes LIVE on the client's app. */
export async function approveWeekMenuAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string; groceryWarning?: string }> {
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
    // keep the trailing TWO weeks — current + next is all the app shows,
    // and it keeps the grocery "next week unlocks early" window working
    menu.weeks = weeks.slice(-2);
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

    // Auto-refresh the 🛒 grocery list from the now-live menu (coach rule
    // 2026-06-13: grocery must track the menu automatically — no manual
    // regenerate step). Best-effort: the menu is already live, so a grocery
    // failure must NOT fail the approval; it's surfaced as a warning + logged
    // (and the dashboard 🛒 chip would still flag a genuinely missing list).
    let groceryWarning: string | undefined;
    try {
      const slug = String(doc.slug ?? hit.plan?.slug ?? "");
      const g = await generateGroceryListAction(clientId, slug);
      if (!g.ok) groceryWarning = `menu live, but grocery refresh failed: ${g.error}`;
    } catch (e) {
      groceryWarning = `menu live, but grocery refresh threw: ${e instanceof Error ? e.message : "unknown"}`;
    }
    if (groceryWarning) console.error(`[weekly-menu] ${clientId}: ${groceryWarning}`);

    // Push the client a gentle "new menu" nudge (best-effort; only fires if
    // they've turned notifications on in the app's settings).
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
    return { ok: true, groceryWarning };
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
export async function weeklyMenuQueueAction(withinDays = 3): Promise<
  {
    clientId: string;
    planSlug: string;
    currentWeek: number;
    targetWeek: number;
    daysToNextWeek: number;
    behind: boolean; // current week's menu is missing (urgent catch-up)
    pending: boolean;
    changeNote?: string;
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
      const weeks = p.app_menu?.weeks ?? [];
      if (!weeks.length) continue; // principle-based — no weekly menus
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
      rows.push({
        clientId: cid,
        planSlug: String(p.slug ?? ""),
        currentWeek: cur,
        targetWeek,
        daysToNextWeek: daysTo,
        behind: !currentReady,
        pending: !!pending,
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
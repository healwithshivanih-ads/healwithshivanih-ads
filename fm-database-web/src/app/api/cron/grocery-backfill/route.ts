/**
 * POST /api/cron/grocery-backfill — menu-artifact freshness guard.
 *
 * The grocery list AND the recipe pack are normally produced as a background
 * job after the coach approves a menu (approveWeekMenuAction). That job is
 * fire-and-forget and best-effort, so an artifact can end up MISSING (migrated
 * menu / API cap / shim crash) or STALE (the menu was edited OUTSIDE the approve
 * flow — e.g. a direct app_menu edit that grew Krittika's menu 1→2 weeks while
 * her grocery stayed at 1 week — so the background refresh never re-ran). Either
 * way the client silently sees a wrong or absent list.
 *
 * This route regenerates any active plan's grocery/recipes when it is:
 *   • grocery: whatever grocery-weeks.ts says is owed — a list missing for
 *     the current week or a live week ahead of it, or one whose dishes have
 *     changed since it was built (the per-week `menu_key`). Lists for earlier
 *     weeks are never rebuilt here: every approved week now stays live on the
 *     plan (menu-weeks.ts), so "grocery weeks ≠ menu weeks" is the normal
 *     state, not a defect.
 *   • recipes: MISSING, or STALE — the pack is older than the menu's last
 *     change (app_menu.synced_at, falling back to plan.updated_at).
 *
 * Idempotent: an artifact that is present, week-matched and newer than the menu
 * is skipped, so this is safe to run daily. A per-run cap guards against a bad
 * deploy triggering a mass regen. Fired daily by scripts/cron-runner.js (07:45
 * IST); also safe to fire on demand.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { generateGroceryListAction, groceryRefreshNeededAction } from "@/lib/server-actions/grocery";
import { generateWeekRecipesAction } from "@/lib/server-actions/recipes";

export const dynamic = "force-dynamic";

// Menu approval writes the menu (stamping synced_at) THEN backgrounds the gen,
// which finishes seconds later — so a healthy artifact is always NEWER than the
// menu. Only regen when it's older by more than this buffer, to absorb clock
// skew and the write/gen ordering race.
const STALE_TOLERANCE_MS = 5 * 60 * 1000;
// Safety valve: never regenerate more than this many artifacts of one kind in a
// single run (a bad generator deploy shouldn't fan out to every client at once).
const MAX_REGEN_PER_KIND = 30;

interface PlanLite {
  slug?: string;
  client_id?: string;
  updated_at?: string;
  app_menu?: { weeks?: { week?: number }[]; is_sample?: boolean; synced_at?: string } | null;
}

function ms(v: unknown): number {
  if (!v) return 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const root = getPlansRoot();
  const dir = path.join(root, "published");
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return NextResponse.json({
      ok: true,
      scanned: 0,
      grocery: { regenerated: 0, failed: [] },
      recipes: { regenerated: 0, failed: [] },
      reason: "no published dir",
    });
  }

  // Newest published plan per client (matches how the app resolves the active plan).
  const seen = new Set<string>();
  const active: { clientId: string; slug: string; menuChangedAt: number }[] = [];
  for (const n of names.sort().reverse()) {
    if (!n.endsWith(".yaml")) continue;
    let p: PlanLite;
    try {
      p = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as PlanLite) ?? {};
    } catch {
      continue; // unparseable — skip
    }
    const cid = String(p.client_id ?? "");
    const slug = String(p.slug ?? "");
    if (!cid || !slug || seen.has(cid)) continue;
    seen.add(cid);
    const weeks = p.app_menu?.weeks ?? [];
    if (!Array.isArray(weeks) || weeks.length === 0) continue; // no live menu → nothing to shop for / cook
    active.push({
      clientId: cid,
      slug,
      menuChangedAt: ms(p.app_menu?.synced_at) || ms(p.updated_at),
    });
  }

  const details: { clientId: string; kind: "grocery" | "recipes"; reason: string; ok: boolean; error?: string }[] = [];
  const grocery = { regenerated: 0, failed: [] as { clientId: string; error?: string }[] };
  const recipes = { regenerated: 0, failed: [] as { clientId: string; error?: string }[] };

  for (const a of active) {
    const mealDir = path.join(root, "clients", a.clientId, "meal-plans");

    // ── grocery ──────────────────────────────────────────────────────────────
    if (grocery.regenerated < MAX_REGEN_PER_KIND) {
      let reason: string | null = null;
      try {
        const need = await groceryRefreshNeededAction(a.clientId, a.slug);
        if (need.missing) reason = "missing";
        else if (need.generate.length) reason = `owed: week ${need.generate.join(", ")}`;
        else if (need.dropped.length) reason = `stale weeks: ${need.dropped.join(", ")}`;
      } catch {
        reason = "missing";
      }
      if (reason) {
        try {
          const r = await generateGroceryListAction(a.clientId, a.slug);
          if (r.ok) grocery.regenerated += 1;
          else grocery.failed.push({ clientId: a.clientId, error: r.error });
          details.push({ clientId: a.clientId, kind: "grocery", reason, ok: r.ok, error: r.error });
        } catch (e) {
          const error = e instanceof Error ? e.message : "threw";
          grocery.failed.push({ clientId: a.clientId, error });
          details.push({ clientId: a.clientId, kind: "grocery", reason, ok: false, error });
        }
      }
    }

    // ── recipes ──────────────────────────────────────────────────────────────
    // The recipe pack (.md) carries no in-file timestamp or week list, so its
    // freshness is judged by file mtime vs the menu-change time.
    if (recipes.regenerated < MAX_REGEN_PER_KIND) {
      const rFile = path.join(mealDir, `${a.slug}-recipes.md`);
      let reason: string | null = null;
      try {
        const st = await fs.stat(rFile);
        if (a.menuChangedAt && st.mtimeMs < a.menuChangedAt - STALE_TOLERANCE_MS) reason = "stale";
      } catch {
        reason = "missing";
      }
      if (reason) {
        try {
          const r = await generateWeekRecipesAction(a.clientId, a.slug);
          if (r.ok) recipes.regenerated += 1;
          else recipes.failed.push({ clientId: a.clientId, error: r.error });
          details.push({ clientId: a.clientId, kind: "recipes", reason, ok: r.ok, error: r.error });
        } catch (e) {
          const error = e instanceof Error ? e.message : "threw";
          recipes.failed.push({ clientId: a.clientId, error });
          details.push({ clientId: a.clientId, kind: "recipes", reason, ok: false, error });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, scanned: active.length, grocery, recipes, details });
}

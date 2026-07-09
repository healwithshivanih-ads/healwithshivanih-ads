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
 *   • MISSING, or
 *   • WEEK-MISMATCHED — the grocery's week set ≠ the menu's week set, or
 *   • STALE — the artifact was generated BEFORE the menu was last changed
 *     (app_menu.synced_at, falling back to plan.updated_at).
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
import { generateGroceryListAction } from "@/lib/server-actions/grocery";
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

/** week-number set as a sorted, comma-joined string for equality compare. */
function weekKey(weeks: { week?: number }[] | undefined): string {
  return (weeks ?? [])
    .map((w) => Number(w?.week))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .join(",");
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
  const active: { clientId: string; slug: string; menuWeekKey: string; menuChangedAt: number }[] = [];
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
      menuWeekKey: weekKey(weeks),
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
      const gFile = path.join(mealDir, `${a.slug}-grocery.yaml`);
      let reason: string | null = null;
      try {
        const raw = await fs.readFile(gFile, "utf-8");
        const doc = (yaml.load(raw) as { weeks?: { week?: number }[]; generated_at?: string }) ?? {};
        if (weekKey(doc.weeks) !== a.menuWeekKey) {
          reason = "week-mismatch";
        } else {
          const gTime = ms(doc.generated_at) || (await fs.stat(gFile)).mtimeMs;
          if (a.menuChangedAt && gTime < a.menuChangedAt - STALE_TOLERANCE_MS) reason = "stale";
        }
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

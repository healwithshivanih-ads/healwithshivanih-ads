/**
 * POST /api/cron/maintenance-menu-seasonal — keep maintenance menus in season.
 *
 * Fired daily by scripts/cron-runner.js. Maintenance plans are exempt from the
 * WEEKLY drafter (weekly-menu.ts); this is their only regeneration path. For
 * every PUBLISHED maintenance plan whose seasonal menu is due — never refreshed,
 * ≥7 weeks old, OR the Indian season has turned (see maintenance-season.ts) —
 * it regenerates a season-aware menu and AUTO-APPLIES it live (coach decision
 * 2026-09-07: no pending/approval step for maintenance). The generator's
 * deterministic hygiene passes still gate a broken menu, so only a clean menu
 * reaches the client.
 *
 * Idempotent within a day: once refreshed, seasonal_refreshed_at is today and
 * the plan drops out of "due". Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { seasonalRefreshDue } from "@/lib/fmdb/maintenance-season";
import { seasonForYmd } from "@/lib/fmdb/season";

export const dynamic = "force-dynamic";

interface PlanDoc {
  slug?: string;
  client_id?: string;
  status?: string;
  is_maintenance?: boolean;
  app_menu?: {
    season?: string | null;
    seasonal_refreshed_at?: string | null;
    weeks?: unknown[];
  } | null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const season = seasonForYmd(todayYmd);
  const dir = path.join(getPlansRoot(), "published");

  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return NextResponse.json({ ok: true, refreshed: 0, scanned: 0, failed: [] });
  }

  const seen = new Set<string>();
  const due: { clientId: string; planSlug: string }[] = [];
  for (const n of names) {
    if (!n.endsWith(".yaml")) continue; // skip .bak-* etc.
    let p: PlanDoc;
    try {
      p = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as PlanDoc) ?? {};
    } catch {
      continue;
    }
    if (!p.is_maintenance) continue;
    const cid = String(p.client_id ?? "");
    const slug = String(p.slug ?? "");
    if (!cid || !slug || seen.has(cid)) continue;
    seen.add(cid);
    // Needs an existing app_menu to refresh (a maintenance plan with no menu is
    // a principles plan by another name — nothing to regenerate).
    if (!p.app_menu?.weeks?.length) continue;
    if (seasonalRefreshDue(p.app_menu, todayYmd).due) due.push({ clientId: cid, planSlug: slug });
  }

  const results: { clientId: string; ok: boolean; error?: string }[] = [];
  for (const row of due) {
    try {
      const out = (await runShim(
        "generate-week-menu.py",
        {
          client_id: row.clientId,
          plan_slug: row.planSlug,
          target_week: 1,
          season: season ?? "",
          apply_live: true,
        },
        240_000,
      )) as { ok: boolean; error?: string };
      results.push({ clientId: row.clientId, ok: !!out?.ok, error: out?.error });
    } catch (e) {
      results.push({
        clientId: row.clientId,
        ok: false,
        error: e instanceof Error ? e.message : "shim failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    season,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    scanned: due.length,
  });
}

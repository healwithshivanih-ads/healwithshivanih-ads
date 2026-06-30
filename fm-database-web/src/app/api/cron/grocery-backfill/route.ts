/**
 * POST /api/cron/grocery-backfill — generate the grocery list for any client
 * who has a LIVE menu but no grocery file.
 *
 * Grocery lists are normally produced as a background job after the coach
 * approves a menu (approveWeekMenuAction). Menus that arrived via the one-time
 * migration / initial publish, or whose background job failed (API cap, shim
 * crash), end up with a live menu and NO grocery list — silently. This route
 * fills those gaps. Idempotent: skips any client who already has a grocery
 * file, so it's safe to run daily.
 *
 * Fired daily by scripts/cron-runner.js. Also safe to fire on demand.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { generateGroceryListAction } from "@/lib/server-actions/grocery";

export const dynamic = "force-dynamic";

interface PlanLite {
  slug?: string;
  client_id?: string;
  app_menu?: { weeks?: unknown[]; is_sample?: boolean } | null;
  no_weekly_menu?: boolean;
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
    return NextResponse.json({ ok: true, filled: 0, failed: [], scanned: 0, reason: "no published dir" });
  }

  const seen = new Set<string>();
  const missing: { clientId: string; planSlug: string }[] = [];
  for (const n of names.sort().reverse()) {
    if (!n.endsWith(".yaml")) continue;
    try {
      const p = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as PlanLite) ?? {};
      const cid = String(p.client_id ?? "");
      const slug = String(p.slug ?? "");
      if (!cid || !slug || seen.has(cid)) continue;
      seen.add(cid);
      const weeks = p.app_menu?.weeks ?? [];
      if (!Array.isArray(weeks) || weeks.length === 0) continue; // no live menu → nothing to shop for
      const groceryFile = path.join(root, "clients", cid, "meal-plans", `${slug}-grocery.yaml`);
      try {
        await fs.access(groceryFile);
        continue; // already has one
      } catch {
        missing.push({ clientId: cid, planSlug: slug });
      }
    } catch {
      /* skip unparseable */
    }
  }

  const failed: { clientId: string; error?: string }[] = [];
  let filled = 0;
  for (const m of missing) {
    try {
      const r = await generateGroceryListAction(m.clientId, m.planSlug);
      if (r.ok) filled += 1;
      else failed.push({ clientId: m.clientId, error: r.error });
    } catch (e) {
      failed.push({ clientId: m.clientId, error: e instanceof Error ? e.message : "threw" });
    }
  }

  return NextResponse.json({ ok: true, scanned: missing.length, filled, failed });
}

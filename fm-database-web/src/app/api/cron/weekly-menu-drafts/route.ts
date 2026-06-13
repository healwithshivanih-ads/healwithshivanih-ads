/**
 * POST /api/cron/weekly-menu-drafts — auto-draft next week's menu for every
 * client who needs one (weekly cadence, coach decision 2026-06-12).
 *
 * Fired daily by scripts/cron-runner.js at 07:00 IST.
 *
 * Rules:
 *   - published plan with a structured app_menu (principle-based plans skip)
 *   - client's NEXT plan week starts within 3 days
 *   - no approved next week, no pending draft already waiting
 *
 * Drafts land on plan.app_menu_pending — NOTHING reaches the client until
 * the coach approves in the Plan-tab studio. Cost ≈ $0.05 (Sonnet) per
 * client per week. Idempotent: a pending draft blocks re-generation.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { runShim } from "@/lib/fmdb/shim";
import { weeklyMenuQueueAction } from "@/lib/server-actions/weekly-menu";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const due = (await weeklyMenuQueueAction(3)).filter((r) => !r.pending);
  const results: { clientId: string; ok: boolean; error?: string }[] = [];
  for (const row of due) {
    try {
      const out = (await runShim(
        "generate-week-menu.py",
        { client_id: row.clientId, plan_slug: row.planSlug, target_week: row.targetWeek },
        240_000,
      )) as { ok: boolean; error?: string };
      results.push({ clientId: row.clientId, ok: !!out?.ok, error: out?.error });
    } catch (e) {
      results.push({ clientId: row.clientId, ok: false, error: e instanceof Error ? e.message : "shim failed" });
    }
  }
  return NextResponse.json({
    ok: true,
    drafted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    scanned: due.length,
  });
}

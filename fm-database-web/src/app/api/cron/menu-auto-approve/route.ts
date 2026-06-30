/**
 * POST /api/cron/menu-auto-approve — safety-net auto-approval (coach decision
 * 2026-06-30: "fixed approval day + auto fallback").
 *
 * The coach approves next week's drafts on her chosen day. This fallback makes
 * sure no client ever FREEZES if she misses it: once a client has actually
 * entered a plan week whose menu is still only a pending draft (queue.behind —
 * current week has no live menu but a draft is waiting), we auto-approve it so
 * the app keeps moving. Pre-loaded NEXT-week drafts are left alone — those are
 * the coach's to review on her day; they only auto-approve once the week
 * arrives and they'd otherwise leave the client stuck.
 *
 * Travel/maintenance weeks are never auto-approved (onTravel excluded).
 * approveWeekMenuAction pushes the client + refreshes grocery/recipes, same as
 * a manual approval.
 *
 * Fired daily by scripts/cron-runner.js. Idempotent: nothing to do once the
 * pending drafts are live.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { weeklyMenuQueueAction, approveWeekMenuAction } from "@/lib/server-actions/weekly-menu";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Only clients who are ALREADY in a week whose menu is still a pending draft
  // (behind) — i.e. they'd be frozen without this. Never travel weeks.
  const due = (await weeklyMenuQueueAction(3)).filter((r) => r.pending && !r.onTravel && r.behind);

  const results: { clientId: string; ok: boolean; error?: string }[] = [];
  for (const r of due) {
    const res = await approveWeekMenuAction(r.clientId);
    results.push({ clientId: r.clientId, ok: res.ok, error: res.error });
  }

  return NextResponse.json({
    ok: true,
    autoApproved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    scanned: due.length,
  });
}

/**
 * POST /api/cron/pending-sends — drain due rows from _pending_sends.yaml.
 *
 * Fired every minute by scripts/cron-runner.js (the fm-coach-cron PM2
 * sidecar). Reads pending rows, fires anything whose send_at is in the
 * past, removes them from disk before sending so a mid-loop crash
 * doesn't cause double-sends. Failed sends land in
 * _pending_sends_failed.yaml for coach to review.
 *
 * Today this drains the +6h supplement-order nudge queued by
 * firePlanPublishFollowups. The queue is generic so other scheduled
 * sends can use the same machinery later.
 *
 * Auth: x-cron-secret header matching CRON_SECRET env.
 */
import { NextRequest, NextResponse } from "next/server";
import { tickPendingSends } from "@/lib/server-actions/plan-publish-followups";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const result = await tickPendingSends();
  return NextResponse.json({ ok: true, ...result });
}

/**
 * POST /api/cron/email-replies — read prospects' email replies from the coach
 * mailbox (read-only), record them in their thread, and act on "no more".
 * See lib/server-actions/email-replies.ts.
 *
 * Fired hourly at :05 by scripts/cron-runner.js. Sends nothing.
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { scanEmailRepliesAction } from "@/lib/server-actions/email-replies";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  try {
    return NextResponse.json(await scanEmailRepliesAction());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

/**
 * POST /api/cron/content-status — ask YouTube which library videos are public
 * (and since when), find new long videos on the channel, and check the guide
 * pages. Writes ~/fm-plans/_content_status.yaml, which is the ONLY thing that
 * lets a video or guide into a follow-up email (content-library-store.ts).
 *
 * Fired daily by scripts/cron-runner.js at 10:30 IST — fifteen minutes before
 * the 10:45 follow-up drafts, so they draft against today's answer.
 *
 * Sends nothing. Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { syncContentStatus } from "@/lib/fmdb/content-library-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncContentStatus());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

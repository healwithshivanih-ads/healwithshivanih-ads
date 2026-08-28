/**
 * POST /api/cron/winback-drip — draft the win-back emails that have come due.
 *
 * Fired daily by scripts/cron-runner.js at 10:30 IST, half an hour after
 * graduation-notice. The order matters: that job sends the "your programme is
 * complete" message, and this one must be able to SEE that send in order to
 * stay quiet around it. Running first would read yesterday's state and could
 * draft a pitch on the morning of the very message that promises not to pitch.
 *
 * THIS ROUTE SENDS NOTHING. It writes drafts to each client's
 * _winback_drip.yaml and stops. Every one of them waits for the coach to
 * approve it in the dashboard panel — that gate is the whole design, because
 * these are emails that ask lapsed clients for money. See
 * .claude/skills/author-renewal §3 for what unreviewed renewal outreach cost
 * once already.
 *
 * Idempotent: a touch is written once and thereafter carries a status, so
 * re-running on the same day changes nothing. Safe to fire repeatedly.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 * Dry-run: this route has none — drafting IS the dry run. Nothing it writes
 * reaches a client without a separate human action.
 */
import { NextRequest, NextResponse } from "next/server";
import { scanWinbackDripAction } from "@/lib/server-actions/winback-drip";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  try {
    const result = await scanWinbackDripAction();
    return NextResponse.json(result);
  } catch (err) {
    // A thrown scan must not look like a quiet day. The cron-runner logs a
    // non-ok body, which is the difference between "nobody was due" and "this
    // has not run for a week".
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

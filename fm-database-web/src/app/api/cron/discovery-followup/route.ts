/**
 * POST /api/cron/discovery-followup — draft the follow-ups that have come due
 * for people who had a call and have not signed up.
 *
 * Fired daily by scripts/cron-runner.js at 10:45 IST.
 *
 * THIS ROUTE SENDS NOTHING. It writes drafts to each person's
 * _discovery_followup.yaml and stops; every one waits for the coach to approve
 * it in the dashboard panel. See lib/fmdb/discovery-followup.ts for the two
 * tracks (free call → Foundation session; Foundation → programme with credit).
 *
 * Then, in the same run, the "thought of you" notes for quiet prospects
 * (lib/fmdb/interest-notes.ts) — AFTER the follow-up scan, so a note never
 * gets drafted on the same morning as a follow-up touch. Also drafts only.
 *
 * Idempotent: a touch is written once and thereafter carries a status.
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { scanDiscoveryFollowupAction } from "@/lib/server-actions/discovery-followup";
import { scanInterestNotesAction } from "@/lib/server-actions/interest-tracking";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  try {
    const followup = await scanDiscoveryFollowupAction();
    // A failed note scan must not hide the follow-up result, or vice versa.
    const notes = await scanInterestNotesAction().catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    return NextResponse.json({ ...followup, interest_notes: notes });
  } catch (err) {
    // A thrown scan must not look like a quiet day in the cron log.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

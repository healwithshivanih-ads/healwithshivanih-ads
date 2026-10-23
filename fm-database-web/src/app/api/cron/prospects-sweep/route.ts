/**
 * POST /api/cron/prospects-sweep — park never-signed-up people who have gone
 * quiet for 15+ days from clients/ into prospects/.
 *
 * Fired daily by scripts/cron-runner.js at 06:35 IST, right after the renewal
 * sweep (06:30) and before client-yaml-integrity (06:45). Until 2026-10-23 this
 * step existed only as a hand-run CLI (`fmdb prospects-sweep --apply`) and
 * nothing scheduled it, so cold leads sat in clients/ indefinitely and every
 * roster count, scan and follow-up list kept them (5 people parked in six
 * months). Idempotent; a person who signs up is restored on the next pass.
 *
 * The rule lives in Python (fm-database/fmdb/plan/prospects.py). Lapsed
 * clients are never parked — they stay in clients/ per renewals.py.
 *
 * Auth: x-cron-secret must match CRON_SECRET. Dry-run: ?dry=1.
 */
import { NextRequest, NextResponse } from "next/server";
import { runShim } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

interface SweepReport {
  ok: boolean;
  error?: string;
  applied?: boolean;
  quiet_after_days?: number;
  moved?: Array<{ client_id: string; display_name: string; quiet_days: number }>;
  would_move?: Array<{ client_id: string; display_name: string; quiet_days: number }>;
  restored?: Array<{ client_id: string; display_name: string }>;
  would_restore?: Array<{ client_id: string; display_name: string }>;
  errors?: Array<{ client_id: string; error: string }>;
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const apply = req.nextUrl.searchParams.get("dry") !== "1";

  let report: SweepReport;
  try {
    report = (await runShim("prospects-sweep.py", { apply }, 60_000)) as SweepReport;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron prospects-sweep] shim failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
  if (!report?.ok) {
    console.error("[cron prospects-sweep] sweep reported failure:", report?.error);
    return NextResponse.json({ ok: false, error: report?.error ?? "sweep failed" }, { status: 200 });
  }
  const moved = apply ? report.moved ?? [] : report.would_move ?? [];
  const restored = apply ? report.restored ?? [] : report.would_restore ?? [];
  for (const r of moved) {
    console.log(`[cron prospects-sweep] ${apply ? "PARKED" : "would park"} ${r.client_id} (${r.display_name}) quiet ${r.quiet_days}d`);
  }
  for (const r of restored) {
    console.log(`[cron prospects-sweep] ${apply ? "RESTORED" : "would restore"} ${r.client_id} (${r.display_name})`);
  }
  for (const e of report.errors ?? []) {
    console.error(`[cron prospects-sweep] ${e.client_id}: ${e.error}`);
  }
  return NextResponse.json({
    ok: true,
    applied: apply,
    quiet_after_days: report.quiet_after_days,
    moved: moved.length,
    restored: restored.length,
    errors: (report.errors ?? []).length,
  });
}

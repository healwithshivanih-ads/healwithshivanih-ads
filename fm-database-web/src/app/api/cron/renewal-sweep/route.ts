/**
 * POST /api/cron/renewal-sweep — lapse clients whose plan ended, unrenewed.
 *
 * Fired daily by scripts/cron-runner.js at 07:45 IST, ahead of the 08:30
 * intake nudges, so the roster the later jobs read is already correct.
 *
 * The rule lives in Python (fm-database/fmdb/plan/renewals.py) and is NOT
 * duplicated here — this route only schedules it and reports what it did. The
 * predicate that matters is "has a successor?", never "is a plan running
 * today?": a client between phases has no active plan and has not lapsed. See
 * that module's docstring for the case that forced the distinction.
 *
 * Idempotent: a client already lapsed is skipped, and a lapsed client who has
 * a plan again is restored to signed_up in the same pass.
 *
 * Never touches app_token. A lapsed client keeps their app and their Lab
 * Vault — see docs/CLIENT_VS_PROSPECT_SPEC.md section 6.
 *
 * Auth: requires x-cron-secret matching CRON_SECRET, else 401.
 *
 * Dry-run override: POST {"apply": false} to preview without writing. The
 * shim also defaults to apply=false, so a malformed body cannot cause a write.
 */
import { NextRequest, NextResponse } from "next/server";
import { runShim } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

type SweepRow = {
  client_id: string;
  display_name: string;
  latest_end?: string | null;
  days_since_end?: number | null;
  next_slug?: string;
};

type SweepReport = {
  ok: boolean;
  error?: string;
  applied?: boolean;
  grace_days?: number;
  lapsed?: SweepRow[];
  restored?: SweepRow[];
  renewal_due?: SweepRow[];
  errors?: Array<{ client_id: string; error: string }>;
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let apply = true;
  try {
    const body = (await req.json()) as { apply?: boolean } | null;
    if (body && typeof body.apply === "boolean") apply = body.apply;
  } catch {
    // cron-runner posts a plain {source, ts} body; anything unparseable just
    // leaves the scheduled default in place.
  }

  let report: SweepReport;
  try {
    report = (await runShim("renewal-sweep.py", { apply }, 60_000)) as SweepReport;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron renewal-sweep] shim failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (!report?.ok) {
    console.error("[cron renewal-sweep] sweep reported failure:", report?.error);
    return NextResponse.json(
      { ok: false, error: report?.error || "sweep failed" },
      { status: 500 },
    );
  }

  const lapsed = report.lapsed ?? [];
  const restored = report.restored ?? [];
  const due = report.renewal_due ?? [];

  // Worth a log line even on a quiet day: silence here is indistinguishable
  // from the cron not running at all.
  console.log(
    `[cron renewal-sweep] applied=${report.applied} grace=${report.grace_days}d ` +
      `lapsed=${lapsed.length} restored=${restored.length} due=${due.length}`,
  );
  for (const r of lapsed) {
    console.log(
      `[cron renewal-sweep] LAPSED ${r.client_id} (${r.display_name}) ` +
        `ended ${r.latest_end}, ${r.days_since_end}d ago`,
    );
  }
  for (const r of restored) {
    console.log(`[cron renewal-sweep] RESTORED ${r.client_id} (${r.display_name})`);
  }
  for (const e of report.errors ?? []) {
    console.error(`[cron renewal-sweep] ${e.client_id}: ${e.error}`);
  }

  return NextResponse.json({
    ok: true,
    applied: report.applied,
    grace_days: report.grace_days,
    lapsed: lapsed.map((r) => r.client_id),
    restored: restored.map((r) => r.client_id),
    renewal_due: due.map((r) => r.client_id),
    errors: report.errors ?? [],
  });
}

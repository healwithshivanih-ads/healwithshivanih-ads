/**
 * POST /api/cron/revenue-export — the daily Loop-1 tick (21:00 IST via
 * scripts/cron-runner.js).
 *
 * Three idempotent steps (contract: docs/REVENUE_EXPORT_CONTRACT.md):
 *   1. Graduation sweep — any graduated plan without a programme_completed
 *      event in the outbox gets one (catch-up for the graduatePlan action).
 *   2. active_client_count snapshot — the capacity interlock's daily
 *      dead-man's signal to ochre-funnel.
 *   3. Outbox drain — retry every pending row (payment events whose inline
 *      flush failed, etc.).
 *
 * Auth: x-cron-secret header matching CRON_SECRET env.
 */
import { NextRequest, NextResponse } from "next/server";
import { emitActiveClientCount, flushRevenueOutbox, reconcileClientSync, sweepGraduatedPlans } from "@/lib/fmdb/revenue-export";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const sweep = await sweepGraduatedPlans();
  const count = await emitActiveClientCount();
  const sync = await reconcileClientSync();
  const drain = await flushRevenueOutbox();
  return NextResponse.json({ ok: true, sweep, count, sync, drain });
}

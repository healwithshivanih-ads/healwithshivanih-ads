/**
 * POST /api/cron/intake-reconcile — drain the intake staging layer.
 *
 * Fired every minute by scripts/cron-runner.js.
 *
 * When FMDB_STAGING_DIR is set, the public intake form on Fly holds ONLY
 * clients with an open form (a small staging tree Mutagen mirrors), not the
 * full authoritative ~/fm-plans store. This job:
 *   - mirrors each staging client's draft + submission back into the
 *     authoritative store (so the coach keeps watching fields populate, ~1 min
 *     lag), and
 *   - purges any client whose form is finalised / revoked / expired, so its
 *     data stops sitting on Fly.
 *
 * No-op when FMDB_STAGING_DIR is unset (legacy full-replica mode) — the shim
 * returns { staging_disabled: true } and nothing happens.
 *
 * Auth: x-cron-secret header must match CRON_SECRET env — same pattern as all
 * other /api/cron/* routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { reconcileIntakeStaging } from "@/lib/server-actions/intake";
import { runShim } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

/**
 * Single-flight guard.
 *
 * This job is fired every 60 seconds and its work is not bounded by that
 * interval: it re-stages every app client, so it grows with the roster. When a
 * run outlives its tick the next one starts on top of it, the two contend for
 * the same staging tree, each makes the other slower, and the pile-up ends with
 * a shim killed at its timeout — which is precisely what filled the fm-coach
 * log on 2026-08-21 (a refresh had reached ~60s against a 60s tick).
 *
 * Skipping is the correct response, not queueing: every action here is a
 * mirror-to-latest, so a skipped tick loses nothing — the next run copies the
 * same current state. Queueing would just defer the same collision.
 *
 * Module scope is per server process, which is the right granularity: the
 * thing being protected is this machine's staging tree, and only this process
 * serves its cron.
 */
let inFlight = false;
let inFlightSince = 0;

/** Ceiling for each staging refresh — see the call sites below. */
const STAGING_TIMEOUT_MS = 5 * 60_000;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (inFlight) {
    // 200, not an error: an overlapping tick is normal operation, and a 500
    // here would turn healthy back-pressure into log noise of its own.
    return NextResponse.json({
      ok: true,
      skipped: "already running",
      running_for_ms: Date.now() - inFlightSince,
    });
  }
  inFlight = true;
  inFlightSince = Date.now();
  try {
    return await reconcile();
  } finally {
    inFlight = false;
  }
}

async function reconcile() {
  const res = await reconcileIntakeStaging();
  if (!res.ok) {
    return NextResponse.json(res, { status: 500 });
  }

  // Client-app staging refresh (see app-staging-action.py): re-mirrors each
  // app-staged client's plan/letters so coach edits propagate to Fly, copies
  // app check-ins written on Fly back into the authoritative store, and
  // purges artifacts whose plan is no longer published. No-op when
  // FMDB_STAGING_DIR is unset. Best-effort — intake reconcile result wins.
  let appStaging: unknown = { skipped: true };
  if (process.env.FMDB_STAGING_DIR) {
    try {
      // Explicit, generous timeout. Both staging refreshes scale with the
      // roster, and the single-flight guard above means a slow run now costs a
      // skipped tick rather than a collision — so the timeout should only fire
      // for a genuinely stuck process, not for an ordinary slow one. The
      // default 90s was below the observed runtime and turned "slow" into
      // "killed".
      appStaging = await runShim("app-staging-action.py", { action: "refresh" }, STAGING_TIMEOUT_MS);
    } catch (err) {
      console.error("[intake-reconcile] app-staging refresh failed:", err);
      appStaging = { ok: false };
    }
  }
  // Coach mobile projection (see coach-staging-action.py): rebuilds the read
  // model /m serves, so the coach app keeps working while the Mac is asleep.
  // Separate script and separate output tree from app-staging above — that one
  // strips coach-private material, this one is made of it. No-op when
  // FMDB_COACH_DIR is unset. Best-effort, same as app-staging.
  let coachStaging: unknown = { skipped: true };
  if (process.env.FMDB_COACH_DIR) {
    try {
      coachStaging = await runShim("coach-staging-action.py", { action: "refresh" }, STAGING_TIMEOUT_MS);
    } catch (err) {
      console.error("[intake-reconcile] coach-staging refresh failed:", err);
      coachStaging = { ok: false };
    }
  }

  return NextResponse.json({
    ...res,
    app_staging: appStaging,
    coach_staging: coachStaging,
  });
}

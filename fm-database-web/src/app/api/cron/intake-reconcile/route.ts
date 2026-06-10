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

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

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
      appStaging = await runShim("app-staging-action.py", { action: "refresh" });
    } catch (err) {
      console.error("[intake-reconcile] app-staging refresh failed:", err);
      appStaging = { ok: false };
    }
  }
  return NextResponse.json({ ...res, app_staging: appStaging });
}

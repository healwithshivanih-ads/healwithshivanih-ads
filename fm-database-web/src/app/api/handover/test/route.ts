/**
 * POST /api/handover/test
 *
 * Coach-side smoke test for the handover flow. Fires both stages back to
 * back against a synthetic test client so we can verify:
 *   1. client.yaml is created in prospect state on discovery-complete
 *   2. lifecycle_state flips to programme_active on programme-signup
 *   3. onboarding kit fires (intake token, WhatsApp send attempt, audit
 *      session) — failures of any single step are logged but don't break
 *      the handover itself
 *
 * Skips the HMAC verification of the real endpoints — this route ONLY
 * works when CRON_SECRET matches in the x-cron-secret header. The body
 * supplies the test client identity so you don't have to hardcode.
 *
 *   curl -X POST $APP_URL/api/handover/test \
 *     -H "Content-Type: application/json" \
 *     -H "x-cron-secret: $CRON_SECRET" \
 *     -d '{
 *       "display_name": "Test Handover",
 *       "email": "test-handover@example.com",
 *       "phone_e164": "919999999999",
 *       "skip_programme_signup": false
 *     }'
 *
 * Pass skip_programme_signup=true to only run stage 1.
 */
import { NextResponse } from "next/server";
import {
  processDiscoveryComplete,
  processProgrammeSignup,
} from "@/lib/server-actions/handover";

export const dynamic = "force-dynamic";

interface TestBody {
  display_name?: string;
  email?: string;
  phone_e164?: string;
  skip_programme_signup?: boolean;
  discovery_call_notes?: string;
}

export async function POST(req: Request) {
  // Reuse the cron secret for this admin-only test route — no separate
  // env var needed. In production, this surface still needs to be
  // accessible only from the coach machine.
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    body = {};
  }

  const identity = {
    display_name: body.display_name ?? "Test Handover",
    email: body.email ?? "test-handover@example.com",
    phone_e164: body.phone_e164 ?? "919999999999",
  };

  const traces: Record<string, unknown> = {};

  // Stage 1 — discovery-complete
  const stage1 = await processDiscoveryComplete({
    source: "fm-coach-manual",
    client: identity,
    discovery_completed_at: new Date().toISOString(),
    discovery_call_notes: body.discovery_call_notes ?? "Smoke test from /api/handover/test. No real call took place.",
  });
  traces.stage1_discovery_complete = stage1;
  if (!stage1.ok) {
    return NextResponse.json({ ok: false, traces, error: "stage1 failed" }, { status: 500 });
  }

  if (body.skip_programme_signup) {
    return NextResponse.json({ ok: true, traces, mode: "stage1_only" });
  }

  // Stage 2 — programme-signup (uses a fake payment_id with timestamp so
  // each test run is non-idempotent)
  const stage2 = await processProgrammeSignup({
    source: "fm-coach-manual",
    client: identity,
    razorpay_payment_id: `pay_smoketest_${Date.now()}`,
    paid_at: new Date().toISOString(),
    programme_slug: "fm-12wk-smoketest",
  });
  traces.stage2_programme_signup = stage2;
  if (!stage2.ok) {
    return NextResponse.json({ ok: false, traces, error: "stage2 failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, traces, mode: "full_flow" });
}

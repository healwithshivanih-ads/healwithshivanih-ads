/**
 * POST /api/maintenance/[clientId]/subscribe
 *
 * Client taps "Quarterly (auto-renew)" at graduation / renewal. Creates a Razorpay
 * Subscription against the pre-created quarterly Plan (RAZORPAY_QUARTERLY_PLAN_ID),
 * persists a `created` subscription record, and returns the subscription_id for the
 * in-app Razorpay Checkout (which collects the one-time mandate). The secret never
 * leaves the server. Coverage is set ONLY by the verified `subscription.charged`
 * webhook — never here. Amount is governed entirely by the Razorpay plan.
 *
 * RBI: ₹6,000/quarter < ₹15,000 → no per-charge AFA after the one-time mandate.
 * Razorpay sends the 24h pre-debit notices.
 */
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import {
  createMaintenanceSubscription,
  type MaintenanceSubscription,
} from "@/lib/fmdb/maintenance-subscription";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
// A finite horizon is required (total_count OR expire_by). 20 quarters = 5 years;
// re-subscribe before it completes. Override via env if the coach wants a different
// horizon without a code change.
const TOTAL_QUARTERS = Number(process.env.RAZORPAY_QUARTERLY_TOTAL_COUNT || 20);
// Display amount only (the real charge is the Razorpay plan). Keep in sync with it.
const QUARTERLY_DISPLAY_INR = Number(process.env.RAZORPAY_QUARTERLY_PLAN_AMOUNT_INR || 6000);

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const planId = process.env.RAZORPAY_QUARTERLY_PLAN_ID;
  if (!keyId || !keySecret) {
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }
  if (!planId) {
    return NextResponse.json({ ok: false, error: "subscription plan not configured" }, { status: 503 });
  }

  let subId: string;
  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const sub = await rzp.subscriptions.create({
      plan_id: planId,
      total_count: TOTAL_QUARTERS,
      customer_notify: 1, // Razorpay handles mandate + 24h pre-debit comms
      notes: { client_id: clientId, kind: "maintenance_subscription" },
    });
    subId = String(sub.id);
  } catch (e) {
    const rzp = e as { statusCode?: number; error?: { code?: string; description?: string } };
    const detail = rzp?.error?.description ?? (e instanceof Error ? e.message : String(e));
    console.error(
      `[maint-subscribe] razorpay subscription create failed (status ${rzp?.statusCode ?? "?"}, code ${rzp?.error?.code ?? "?"}): ${detail}`,
    );
    return NextResponse.json({ ok: false, error: "could not start subscription" }, { status: 502 });
  }

  const now = new Date().toISOString();
  const record: MaintenanceSubscription = {
    subscription_id: subId,
    client_id: clientId,
    kind: "subscription",
    plan_id: planId,
    status: "created",
    paid_through: null, // set by the subscription.charged webhook
    amount_inr: QUARTERLY_DISPLAY_INR,
    created_at: now,
    updated_at: now,
  };
  await createMaintenanceSubscription(record);

  return NextResponse.json({
    ok: true,
    subscription_id: subId,
    amount_inr: QUARTERLY_DISPLAY_INR,
    currency: "INR",
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? keyId, // public key only
  });
}

/**
 * POST /api/maintenance/[clientId]/pay
 *
 * Client taps "Maintain" at graduation (or "Renew" at the 6-month gate). The
 * amount is a SERVER CONSTANT for the term (MAINTENANCE_PRICING) — never trusted
 * from the client — so there is no amount to bound-check beyond "is this term
 * offered". Creates a Razorpay Order, stamps razorpay_order_id, returns the public
 * key for in-app Checkout. The secret never leaves the server. "Paid" is set ONLY
 * by the verified webhook. One-time payment — no auto-debit (spec).
 */
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import {
  maintenancePrice,
  buildMaintenanceOrder,
  createMaintenanceOrder,
  patchMaintenanceOrder,
  nextMaintenanceOrderId,
  effectiveExistingThrough,
  extendPaidThrough,
  DEFAULT_MAINTENANCE_TERM_MONTHS,
} from "@/lib/fmdb/maintenance-orders";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Today (Asia/Kolkata) as YYYY-MM-DD — clients are in India. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { termMonths?: number } | null;
  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  const termMonths = Number(body?.termMonths ?? DEFAULT_MAINTENANCE_TERM_MONTHS);
  if (maintenancePrice(termMonths) == null) {
    return NextResponse.json({ ok: false, error: "term not offered" }, { status: 400 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }

  const today = istToday();
  const existing = await effectiveExistingThrough(clientId);
  const built = buildMaintenanceOrder(
    await nextMaintenanceOrderId(clientId, today),
    clientId,
    termMonths,
    new Date().toISOString(),
  );
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: 400 });
  await createMaintenanceOrder(built.order);
  // Preview only (the webhook recomputes the authoritative paid-through at capture).
  const previewThrough = extendPaidThrough(existing, today, termMonths);

  let rzpOrderId: string;
  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rzpOrder = await rzp.orders.create({
      amount: Math.round(built.order.amount_inr * 100), // paise
      currency: "INR",
      receipt: built.order.order_id,
      notes: { client_id: clientId, order_id: built.order.order_id, kind: "maintenance" },
    });
    rzpOrderId = String(rzpOrder.id);
  } catch (e) {
    const rzp = e as { statusCode?: number; error?: { code?: string; description?: string } };
    const detail = rzp?.error?.description ?? (e instanceof Error ? e.message : String(e));
    console.error(
      `[maint-pay] razorpay order create failed (status ${rzp?.statusCode ?? "?"}, code ${rzp?.error?.code ?? "?"}): ${detail}`,
    );
    return NextResponse.json({ ok: false, error: "could not start payment" }, { status: 502 });
  }

  await patchMaintenanceOrder(clientId, built.order.order_id, { razorpay_order_id: rzpOrderId });

  return NextResponse.json({
    ok: true,
    razorpay_order_id: rzpOrderId,
    amount_inr: built.order.amount_inr,
    term_months: termMonths,
    paid_through: previewThrough,
    currency: "INR",
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? keyId, // public key only
    order_id: built.order.order_id,
  });
}

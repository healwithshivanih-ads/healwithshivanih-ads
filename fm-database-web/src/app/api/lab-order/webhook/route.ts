/**
 * POST /api/lab-order/webhook
 *
 * Razorpay payment webhook — the ONLY source of truth for marking a lab order
 * `paid`. HMAC-verifies the signature against the raw body with
 * RAZORPAY_WEBHOOK_SECRET (timing-safe); on a verified `order.paid` /
 * `payment.captured`, flips the matching order `recommended → paid`. Idempotent on
 * razorpay_payment_id. Never trusts a client-side success callback.
 *
 * Returns 200 for unresolvable-but-valid events so Razorpay doesn't retry forever;
 * 400 only for a bad/absent signature.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { findOrderByRazorpayOrderId, loadOrder, transitionOrder } from "@/lib/fmdb/lab-orders";

export const dynamic = "force-dynamic";

interface RzpEntity {
  id?: string;
  order_id?: string;
  notes?: { client_id?: string; order_id?: string };
}
interface RzpEvent {
  event?: string;
  payload?: { order?: { entity?: RzpEntity }; payment?: { entity?: RzpEntity } };
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }

  let event: RzpEvent;
  try {
    event = JSON.parse(raw) as RzpEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  if (event.event !== "order.paid" && event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: event.event ?? null });
  }

  const orderEntity = event.payload?.order?.entity;
  const paymentEntity = event.payload?.payment?.entity;
  const rzpOrderId = orderEntity?.id ?? paymentEntity?.order_id ?? "";
  const rzpPaymentId = paymentEntity?.id ?? "";
  if (!rzpOrderId || !rzpPaymentId) return NextResponse.json({ ok: true, skipped: "missing ids" });

  // Resolve our order: prefer the notes we set at pay-time, else scan by rzp id.
  let clientId = orderEntity?.notes?.client_id ?? "";
  let orderId = orderEntity?.notes?.order_id ?? "";
  if (!clientId || !orderId) {
    const found = await findOrderByRazorpayOrderId(rzpOrderId);
    if (!found) return NextResponse.json({ ok: true, skipped: "order not found" });
    clientId = found.clientId;
    orderId = found.order.order_id;
  }

  const order = await loadOrder(clientId, orderId);
  if (!order) return NextResponse.json({ ok: true, skipped: "order gone" });
  // Defence: the order's razorpay_order_id must match the event's.
  if (order.razorpay_order_id && order.razorpay_order_id !== rzpOrderId) {
    return NextResponse.json({ ok: true, skipped: "rzp order mismatch" });
  }
  // Idempotent: a re-delivered webhook for an already-paid order is a no-op.
  if (order.status === "paid" && order.razorpay_payment_id === rzpPaymentId) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (order.status !== "recommended") {
    return NextResponse.json({ ok: true, skipped: `status ${order.status}` });
  }

  const res = await transitionOrder(clientId, orderId, "paid", {
    razorpay_payment_id: rzpPaymentId,
    paid_at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: res.ok });
}

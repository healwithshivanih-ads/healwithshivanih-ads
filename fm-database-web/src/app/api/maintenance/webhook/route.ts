/**
 * POST /api/maintenance/webhook
 *
 * Razorpay payment webhook — the ONLY source of truth for marking a maintenance
 * order `paid`. HMAC-verifies the raw body against RAZORPAY_WEBHOOK_SECRET
 * (timing-safe); on a verified order.paid / payment.captured, flips the matching
 * maintenance order pending → paid and stamps the authoritative paid_through
 * (recomputed at capture from the client's live effective window, so stacked
 * renewals are exact). Idempotent on razorpay_payment_id. Never trusts a
 * client-side success callback. Reuses RAZORPAY_WEBHOOK_SECRET (shared with the
 * lab webhook) — events are routed by Razorpay's per-webhook URL config.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  loadMaintenanceOrder,
  patchMaintenanceOrder,
  findMaintenanceOrderByRazorpayOrderId,
  effectiveExistingThrough,
  extendPaidThrough,
} from "@/lib/fmdb/maintenance-orders";

export const dynamic = "force-dynamic";

interface RzpEntity {
  id?: string;
  order_id?: string;
  notes?: { client_id?: string; order_id?: string; kind?: string };
}
interface RzpEvent {
  event?: string;
  payload?: { order?: { entity?: RzpEntity }; payment?: { entity?: RzpEntity } };
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
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
  // Notes carry kind=maintenance so a lab event reaching this URL is ignored.
  let clientId = orderEntity?.notes?.client_id ?? "";
  let orderId = orderEntity?.notes?.order_id ?? "";
  if (orderEntity?.notes?.kind && orderEntity.notes.kind !== "maintenance") {
    return NextResponse.json({ ok: true, skipped: "not maintenance" });
  }
  if (!clientId || !orderId) {
    const found = await findMaintenanceOrderByRazorpayOrderId(rzpOrderId);
    if (!found) return NextResponse.json({ ok: true, skipped: "order not found" });
    clientId = found.clientId;
    orderId = found.order.order_id;
  }

  const order = await loadMaintenanceOrder(clientId, orderId);
  if (!order) return NextResponse.json({ ok: true, skipped: "order gone" });
  if (order.razorpay_order_id && order.razorpay_order_id !== rzpOrderId) {
    return NextResponse.json({ ok: true, skipped: "rzp order mismatch" });
  }
  // Idempotent: a re-delivered webhook for an already-paid order is a no-op.
  if (order.status === "paid" && order.razorpay_payment_id === rzpPaymentId) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ ok: true, skipped: `status ${order.status}` });
  }

  // Authoritative paid_through at capture: stack on the live effective window.
  const existing = await effectiveExistingThrough(clientId);
  const paidThrough = extendPaidThrough(existing, istToday(), order.term_months);

  const next = await patchMaintenanceOrder(clientId, orderId, {
    status: "paid",
    razorpay_payment_id: rzpPaymentId,
    paid_at: new Date().toISOString(),
    paid_through: paidThrough,
  });
  return NextResponse.json({ ok: !!next });
}

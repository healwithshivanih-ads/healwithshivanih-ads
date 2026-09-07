/**
 * POST /api/foundation/webhook
 *
 * Razorpay payment webhook — the ONLY source of truth for marking a foundation
 * order `paid`. HMAC-verifies the raw body against the Ochre Life account's
 * webhook secret (OCHRE_LIFE_RAZORPAY_WEBHOOK_SECRET; test-only fallback to
 * RAZORPAY_WEBHOOK_SECRET). On a verified order.paid / payment.captured for an
 * order whose notes.kind === "foundation_session", flips pending → paid and
 * emits a revenue event. Idempotent on razorpay_payment_id. Never trusts a
 * client-side success callback.
 *
 * Point the Ochre Life account's webhook at THIS URL (a foundation event never
 * reaches the labs/maintenance webhook because notes.kind gates it, and vice
 * versa).
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  loadFoundationOrder,
  patchFoundationOrder,
  findFoundationOrderByRazorpayOrderId,
  foundationWebhookSecret,
} from "@/lib/fmdb/foundation-orders";
import { buildPaymentEvent, clientJoinKeyFor, emitRevenueEvent } from "@/lib/fmdb/revenue-export";

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

export async function POST(req: Request) {
  const secret = foundationWebhookSecret();
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
  // Notes carry kind=foundation_session so a lab/maintenance event reaching this
  // URL is ignored (and vice versa).
  let clientId = orderEntity?.notes?.client_id ?? paymentEntity?.notes?.client_id ?? "";
  let orderId = orderEntity?.notes?.order_id ?? paymentEntity?.notes?.order_id ?? "";
  const notedKind = orderEntity?.notes?.kind ?? paymentEntity?.notes?.kind;
  if (notedKind && notedKind !== "foundation_session") {
    return NextResponse.json({ ok: true, skipped: "not foundation" });
  }
  if (!clientId || !orderId) {
    const found = await findFoundationOrderByRazorpayOrderId(rzpOrderId);
    if (!found) return NextResponse.json({ ok: true, skipped: "order not found" });
    clientId = found.clientId;
    orderId = found.order.order_id;
  }

  const order = await loadFoundationOrder(clientId, orderId);
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

  const next = await patchFoundationOrder(clientId, orderId, {
    status: "paid",
    razorpay_payment_id: rzpPaymentId,
    paid_at: new Date().toISOString(),
  });
  // Revenue export (Loop 1) — best-effort; emitRevenueEvent never throws.
  if (next) {
    await emitRevenueEvent(
      buildPaymentEvent({
        product: "consultation",
        amountPaisa: (order.amount_inr ?? 0) * 100,
        razorpayPaymentId: rzpPaymentId,
        paidAt: new Date().toISOString(),
        client: await clientJoinKeyFor(clientId),
      }),
    );
  }
  return NextResponse.json({ ok: !!next });
}

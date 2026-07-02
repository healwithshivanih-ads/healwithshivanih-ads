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
import {
  subscriptionEventOutcome,
  dropBackwardPaidThrough,
  loadMaintenanceSubscription,
  patchMaintenanceSubscription,
  findMaintenanceSubscriptionById,
  type RzpSubscriptionEvent,
} from "@/lib/fmdb/maintenance-subscription";
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

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Quarterly auto-debit subscription events. `subscription.charged` (first charge
 * AND every renewal) extends coverage to Razorpay's reported current_end;
 * lifecycle events (activated/pending/halted/cancelled/completed) only move status
 * — coverage lapses naturally at the last charged current_end. Idempotent on the
 * per-cycle payment id. Returns a JSON response object for the route to send.
 */
async function handleSubscriptionEvent(event: RzpSubscriptionEvent) {
  const outcome = subscriptionEventOutcome(event, new Date().toISOString());
  if (!outcome) return { ok: true, skipped: "untracked subscription event" };

  // Resolve our record: prefer notes.client_id, else scan by subscription id.
  let clientId = outcome.clientIdFromNotes ?? "";
  if (!clientId || !(await loadMaintenanceSubscription(clientId, outcome.subscriptionId))) {
    const found = await findMaintenanceSubscriptionById(outcome.subscriptionId);
    if (!found) return { ok: true, skipped: "subscription not found" };
    clientId = found.clientId;
  }

  const cur = await loadMaintenanceSubscription(clientId, outcome.subscriptionId);
  if (!cur) return { ok: true, skipped: "subscription gone" };
  // Idempotent: a re-delivered charge for the same payment id is a no-op.
  if (outcome.paymentId && cur.last_payment_id === outcome.paymentId) {
    return { ok: true, already: true };
  }
  // Forward-only coverage: an out-of-order / re-delivered OLDER cycle must never
  // regress paid_through (mirrors the one-time order's stack-forward discipline).
  dropBackwardPaidThrough(outcome.patch, cur.paid_through);

  const next = await patchMaintenanceSubscription(clientId, outcome.subscriptionId, outcome.patch);
  // Revenue export (Loop 1) — only actual charges, not lifecycle-only events.
  // The webhook payload carries no amount for subscription charges, so use the
  // record's display amount (the per-cycle price). Best-effort, never throws.
  if (next && outcome.paymentId) {
    await emitRevenueEvent(
      buildPaymentEvent({
        product: "maintenance",
        amountPaisa: (cur.amount_inr ?? 0) * 100,
        razorpayPaymentId: outcome.paymentId,
        paidAt: new Date().toISOString(),
        client: await clientJoinKeyFor(clientId),
      }),
    );
  }
  return { ok: !!next };
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

  // Quarterly auto-debit subscription events → dedicated handler.
  if (typeof event.event === "string" && event.event.startsWith("subscription.")) {
    return NextResponse.json(await handleSubscriptionEvent(event as RzpSubscriptionEvent));
  }

  // One-time maintenance block (the ₹10,000 6-month order) below.
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
  // Notes live on the ORDER entity; a `payment.captured`-only payload has no order
  // entity, so fall back to the payment entity's notes (when present) before the
  // scan — belt-and-braces; the cross-id scan already resolves either way.
  let clientId = orderEntity?.notes?.client_id ?? paymentEntity?.notes?.client_id ?? "";
  let orderId = orderEntity?.notes?.order_id ?? paymentEntity?.notes?.order_id ?? "";
  const notedKind = orderEntity?.notes?.kind ?? paymentEntity?.notes?.kind;
  if (notedKind && notedKind !== "maintenance") {
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
  // Revenue export (Loop 1) — best-effort; emitRevenueEvent never throws.
  if (next) {
    await emitRevenueEvent(
      buildPaymentEvent({
        product: "maintenance",
        amountPaisa: (order.amount_inr ?? 0) * 100,
        razorpayPaymentId: rzpPaymentId,
        paidAt: new Date().toISOString(),
        client: await clientJoinKeyFor(clientId),
      }),
    );
  }
  return NextResponse.json({ ok: !!next });
}

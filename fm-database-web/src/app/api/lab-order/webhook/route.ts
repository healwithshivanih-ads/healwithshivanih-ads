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
import { findOrderByRazorpayOrderId, loadOrder, transitionOrder, type LabOrder } from "@/lib/fmdb/lab-orders";

export const dynamic = "force-dynamic";

/**
 * Best-effort: ping the lab partner (Abhinav) + the coach's own + admin numbers
 * on WhatsApp the moment a booking is paid, so they can arrange the home
 * collection. Self-contained (no "use server" import) so it runs from this route;
 * sends the Meta-approved template `fm_lab_booking_v1` via the self-hosted
 * WhatsApp server. Stays INERT until these env vars are set on Fly:
 * WHATSAPP_SERVER_URL, WHATSAPP_SERVER_API_KEY, and LAB_PARTNER_WHATSAPP (a
 * comma-separated list of recipients). Never throws into the webhook — the
 * payment is already recorded; a notify failure is logged, not surfaced.
 *
 * Meta rejects template params containing newlines / tabs / 4+ spaces, so every
 * param is flattened to single-spaced text.
 */
async function notifyLabPartner(order: LabOrder): Promise<void> {
  const url = (process.env.WHATSAPP_SERVER_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.WHATSAPP_SERVER_API_KEY ?? "";
  // Comma-separated list → clean each to "+digits", drop junk, de-dup. The alert
  // fans out to every number (lab partner + the coach's own + admin).
  const recipients = [
    ...new Set(
      (process.env.LAB_PARTNER_WHATSAPP ?? "")
        .split(",")
        .map((s) => s.replace(/[^\d+]/g, ""))
        .filter((s) => s.replace(/\D/g, "").length >= 8),
    ),
  ];
  if (!url || !apiKey || recipients.length === 0) return; // not configured → no-op

  const l = order.logistics;
  if (!l) return; // no collection details → nothing actionable to send
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const panel = order.lines[0]?.label ?? "Lab panel";
  const fasting = order.fasting_required ? " · fasting sample" : "";
  const slot = l.preferred_slot.replace(/_/g, " ");
  const params = [
    flat(l.full_name),
    flat(l.phone),
    flat(`${l.address}, ${l.pincode}`),
    flat(`${panel}${fasting}`),
    flat(`${l.preferred_date}, ${slot}`),
  ];

  const sendTo = async (to: string): Promise<void> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${url}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          phone: to,
          type: "template",
          templateName: "fm_lab_booking_v1",
          templateLanguage: "en",
          templateParams: params,
          origin: "api",
          originRef: "lab-booking",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[lab-notify] WA send to ${to} failed HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[lab-notify] WA send to ${to} threw:`, (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  };

  // Independent sends — one bad number never blocks the others (or the webhook).
  await Promise.all(recipients.map(sendTo));
}

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
  // Booking is paid — ping the lab partner so they can arrange collection.
  // Best-effort + awaited (so failures log); never blocks the 200 to Razorpay.
  if (res.ok) await notifyLabPartner(order);
  return NextResponse.json({ ok: res.ok });
}

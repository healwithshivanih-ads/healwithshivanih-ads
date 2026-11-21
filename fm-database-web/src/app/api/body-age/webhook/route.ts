/**
 * POST /api/body-age/webhook — the payment company's webhook for body age report orders.
 *
 * HMAC-verified against the account's webhook secret (RAZORPAY_WEBHOOK_SECRET; a test-mode account's own secret
 * in RAZORPAY_TEST_WEBHOOK_SECRET is accepted too). Acts only on events whose notes say kind = body_age_report,
 * so a lab, Foundation or maintenance payment reaching this URL is ignored, as this kind is ignored at theirs.
 * Add this URL to the Razorpay account's webhooks on launch day (events: order.paid, payment.captured).
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { BODY_AGE_ORDER_KIND } from "@/lib/fmdb/body-age-orders";
import { settleBodyAgePayment } from "@/lib/fmdb/body-age-payment";

export const dynamic = "force-dynamic";

interface Entity {
  id?: string;
  order_id?: string;
  notes?: { order_id?: string; kind?: string };
}

function signed(raw: string, sig: string, secret: string): boolean {
  if (!secret) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secrets = [process.env.RAZORPAY_WEBHOOK_SECRET || "", process.env.RAZORPAY_TEST_WEBHOOK_SECRET || ""].filter(Boolean);
  if (!secrets.length) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!secrets.some((s) => signed(raw, sig, s))) return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });

  let event: { event?: string; payload?: { order?: { entity?: Entity }; payment?: { entity?: Entity } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (event.event !== "order.paid" && event.event !== "payment.captured") return NextResponse.json({ ok: true, ignored: event.event ?? null });
  const o = event.payload?.order?.entity;
  const p = event.payload?.payment?.entity;
  const notes = o?.notes ?? p?.notes;
  if (notes?.kind !== BODY_AGE_ORDER_KIND || !notes.order_id) return NextResponse.json({ ok: true, skipped: "not a body age order" });
  const rzpOrderId = o?.id ?? p?.order_id ?? "";
  const rzpPaymentId = p?.id ?? "";
  if (!rzpOrderId || !rzpPaymentId) return NextResponse.json({ ok: true, skipped: "missing ids" });
  const res = await settleBodyAgePayment({ orderId: notes.order_id, rzpOrderId, rzpPaymentId });
  return NextResponse.json(res.ok ? { ok: true, already: res.already } : { ok: true, skipped: res.skipped });
}

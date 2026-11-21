/**
 * POST /api/body-age/order — the public order page's "Pay" step.
 *
 * Validates the form, works out the price on the SERVER (never from the body), saves a `pending` order and opens a
 * Razorpay order for it. Answers 404 while the page is off (see body-age-orders.ts::orderPageMode); in test mode
 * only a Razorpay TEST key is ever used. "Paid" is set later, by the signed receipt or the webhook.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import {
  BODY_AGE_ORDER_KIND,
  buildBodyAgeOrder,
  orderPageMode,
  orderRazorpayKeys,
  patchBodyAgeOrder,
  sanitizeOrderInput,
  saveBodyAgeOrder,
} from "@/lib/fmdb/body-age-orders";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

/** The India calendar date `h` hours from now. */
function istYmdPlusHours(h: number): string {
  return new Date(Date.now() + (5.5 + h) * 3600 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const mode = orderPageMode(process.env.BODY_AGE_ORDER_PAGE, Date.now());
  if (mode === "off") return new NextResponse("Not found", { status: 404 });
  const ip = req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await allowDaily("body-age-order", ip, 10)).ok) {
    return NextResponse.json({ ok: false, error: "Too many attempts today. Please try again tomorrow." }, { status: 429 });
  }
  const keys = orderRazorpayKeys(mode, process.env);
  if (!keys.ok) return NextResponse.json({ ok: false, error: "Payment is not available right now." }, { status: 503 });

  const body = await req.json().catch(() => null);
  // The laboratory needs about 36 hours to arrange a home visit.
  const checked = sanitizeOrderInput(body, { todayYmd: istYmdPlusHours(0), minDateYmd: istYmdPlusHours(36) });
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });

  const orderId = `ba-${istYmdPlusHours(0).replace(/-/g, "")}-${crypto.randomBytes(5).toString("hex").slice(0, 8)}`;
  const order = buildBodyAgeOrder(
    orderId,
    crypto.randomBytes(18).toString("base64url"),
    checked.input,
    checked.amountInr,
    new Date().toISOString(),
    mode === "test",
  );
  await saveBodyAgeOrder(order);

  let rzpOrderId: string;
  try {
    const rzp = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret });
    const made = await rzp.orders.create({
      amount: order.amount_inr * 100, // paise
      currency: "INR",
      receipt: order.order_id,
      notes: { order_id: order.order_id, kind: BODY_AGE_ORDER_KIND },
    });
    rzpOrderId = String(made.id);
  } catch (e) {
    const r = e as { statusCode?: number; error?: { code?: string; description?: string } };
    console.error(`[body-age-order] razorpay order create failed (status ${r?.statusCode ?? "?"}): ${r?.error?.description ?? String(e)}`);
    await patchBodyAgeOrder(order.order_id, { status: "cancelled" });
    return NextResponse.json({ ok: false, error: "Payment could not be started. Please try again." }, { status: 502 });
  }
  await patchBodyAgeOrder(order.order_id, { razorpay_order_id: rzpOrderId });

  return NextResponse.json({
    ok: true,
    order_id: order.order_id,
    access_key: order.access_key,
    razorpay_order_id: rzpOrderId,
    amount_inr: order.amount_inr,
    keyId: keys.keyId, // public key only
    test: order.test,
  });
}

/**
 * POST /api/body-age/order/<id>/confirm — the buyer's browser hands back Razorpay's signed Checkout receipt.
 * The signature is checked with the key secret on the server, so this cannot be forged from the browser. The
 * webhook does the same job when the browser never gets this far (closed tab); both are safe to arrive twice.
 */
import { NextResponse } from "next/server";
import { loadBodyAgeOrder, orderPageMode, orderRazorpayKeys } from "@/lib/fmdb/body-age-orders";
import { receiptIsGenuine, settleBodyAgePayment } from "@/lib/fmdb/body-age-payment";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mode = orderPageMode(process.env.BODY_AGE_ORDER_PAGE, Date.now());
  if (mode === "off") return new NextResponse("Not found", { status: 404 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { razorpay_payment_id?: string; razorpay_signature?: string } | null;
  const order = await loadBodyAgeOrder(id);
  // An order is settled with the keys of the mode it was placed in.
  const keys = orderRazorpayKeys(order?.test ? "test" : mode, process.env);
  if (!order || !order.razorpay_order_id || !keys.ok || order.test !== (mode === "test")) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const paymentId = typeof b?.razorpay_payment_id === "string" ? b.razorpay_payment_id : "";
  const signature = typeof b?.razorpay_signature === "string" ? b.razorpay_signature : "";
  if (!receiptIsGenuine(order.razorpay_order_id, paymentId, signature, keys.keySecret)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const res = await settleBodyAgePayment({ orderId: id, rzpOrderId: order.razorpay_order_id, rzpPaymentId: paymentId });
  return NextResponse.json({ ok: res.ok, paid: res.ok });
}

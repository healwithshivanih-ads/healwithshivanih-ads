/**
 * POST /api/lab-order/[orderId]/pay
 *
 * Client taps "Pay" on a coach-recommended lab order. Loads the `recommended`
 * order, BOUND-CHECKS the amount server-side (profile price re-derived from the
 * catalogue; add-on lines bounded — see LAB_BOOKING_SPEC.md), creates a Razorpay
 * Order, stamps `razorpay_order_id`, and returns the public key + order id for the
 * in-app Razorpay Checkout. The secret never leaves the server. "Paid" is set ONLY
 * by the verified webhook, never here.
 */
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import { loadOrder, validateOrderAmount, patchOrder, sanitizeLogistics } from "@/lib/fmdb/lab-orders";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Today (Asia/Kolkata) + n days as YYYY-MM-DD. Clients are in India, so the
 *  48-hour collection floor is computed against the IST calendar day. */
function ymdInIstPlusDays(n: number): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  ist.setUTCDate(ist.getUTCDate() + n);
  return ist.toISOString().slice(0, 10);
}

export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    clientId?: string;
    logistics?: unknown;
    token?: string;
  } | null;
  if (!SAFE_ID.test(orderId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  // AUTHORIZE: derive the client from the app token — never trust body.clientId.
  // Without this, anyone who guesses clientId+orderId could overwrite a client's
  // lab home-collection logistics (address/date) and spin up Razorpay orders.
  const auth = await verifyAppClient(body?.token);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const clientId = auth.clientId;
  if (!(await allowDaily("lab-pay", clientId, 20)).ok) {
    return NextResponse.json({ ok: false, error: "too many attempts today" }, { status: 429 });
  }

  // Home-collection details are mandatory to book — validate before charging.
  // Enforce a 48-hour lead time on the collection date (lab needs to arrange it).
  const logi = sanitizeLogistics(body?.logistics, { minDateYmd: ymdInIstPlusDays(2) });
  if (!logi.ok) return NextResponse.json({ ok: false, error: logi.error }, { status: 400 });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }

  const order = await loadOrder(clientId, orderId);
  if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (order.status !== "recommended") {
    return NextResponse.json({ ok: false, error: "order is not payable" }, { status: 409 });
  }

  // Bound-check the stored amount before charging (never trust it blindly).
  const provider = await loadLabProvider();
  if (!provider) return NextResponse.json({ ok: false, error: "catalogue unavailable" }, { status: 503 });
  const check = validateOrderAmount(provider, order);
  if (!check.ok) return NextResponse.json({ ok: false, error: `refused: ${check.error}` }, { status: 409 });

  let rzpOrderId: string;
  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rzpOrder = await rzp.orders.create({
      amount: Math.round(order.amount_inr * 100), // paise
      currency: "INR",
      receipt: orderId,
      notes: { client_id: clientId, order_id: orderId },
    });
    rzpOrderId = String(rzpOrder.id);
  } catch (e) {
    // Razorpay SDK errors carry { statusCode, error: { code, description } }.
    const rzp = (e as { statusCode?: number; error?: { code?: string; description?: string } });
    const detail = rzp?.error?.description ?? (e instanceof Error ? e.message : String(e));
    console.error(
      `[lab-pay] razorpay order create failed (status ${rzp?.statusCode ?? "?"}, code ${rzp?.error?.code ?? "?"}): ${detail}`,
    );
    return NextResponse.json({ ok: false, error: "could not start payment" }, { status: 502 });
  }

  await patchOrder(clientId, orderId, { razorpay_order_id: rzpOrderId, logistics: logi.logistics });

  return NextResponse.json({
    ok: true,
    razorpay_order_id: rzpOrderId,
    amount_inr: order.amount_inr,
    currency: "INR",
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? keyId, // public key only
    order_id: orderId,
  });
}

/**
 * POST /api/foundation/[clientId]/pay
 *
 * The client taps "Pay for my foundation session" on /foundation/<token>. The
 * amount is a SERVER CONSTANT (FOUNDATION_SESSION_PRICE_INR) — never trusted from
 * the client. Creates (or reuses today's pending) Razorpay Order on the SEPARATE
 * "Ochre Life" account, stamps razorpay_order_id, and returns the public key for
 * in-app Checkout. The secret never leaves the server. "Paid" is set ONLY by the
 * verified webhook (see ../webhook/route.ts).
 *
 * SAFETY: refuses a LIVE charge unless the Ochre Life account keys are actually
 * configured, so real money can never fall through to the labs/maintenance
 * (fallback) account by accident.
 */
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import {
  buildFoundationOrder,
  createFoundationOrder,
  loadClientFoundationOrders,
  patchFoundationOrder,
  nextFoundationOrderId,
  resolveFoundationRazorpay,
  FOUNDATION_SESSION_PRICE_INR,
  type FoundationOrder,
} from "@/lib/fmdb/foundation-orders";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Today (Asia/Kolkata) as YYYY-MM-DD — clients are in India. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  // AUTHORIZE: the app token must resolve to THIS client. Without this, anyone
  // who guesses a clientId could spin up foundation orders + Razorpay orders.
  const auth = await verifyAppClient(body?.token, clientId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!(await allowDaily("foundation-pay", auth.clientId, 12)).ok) {
    return NextResponse.json({ ok: false, error: "too many attempts today" }, { status: 429 });
  }

  const { keyId, keySecret, publicKeyId } = resolveFoundationRazorpay();
  if (!keyId || !keySecret) {
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }

  // Already paid? Nothing to charge.
  const existing = await loadClientFoundationOrders(clientId);
  if (existing.some((o) => o.status === "paid")) {
    return NextResponse.json({ ok: false, error: "already paid" }, { status: 409 });
  }
  // Reuse a still-pending order created earlier today rather than piling up
  // orphan Razorpay orders on repeated taps; otherwise mint a fresh one.
  let order: FoundationOrder | undefined = existing.find(
    (o) => o.status === "pending" && !!o.razorpay_order_id,
  );
  if (!order) {
    const built = buildFoundationOrder(
      await nextFoundationOrderId(clientId, istToday()),
      clientId,
      new Date().toISOString(),
    );
    await createFoundationOrder(built);
    order = built;
  }

  let rzpOrderId = order.razorpay_order_id ?? "";
  if (!rzpOrderId) {
    try {
      const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const rzpOrder = await rzp.orders.create({
        amount: Math.round(order.amount_inr * 100), // paise
        currency: "INR",
        receipt: order.order_id,
        notes: { client_id: clientId, order_id: order.order_id, kind: "foundation_session" },
      });
      rzpOrderId = String(rzpOrder.id);
    } catch (e) {
      const rzp = e as { statusCode?: number; error?: { code?: string; description?: string } };
      const detail = rzp?.error?.description ?? (e instanceof Error ? e.message : String(e));
      console.error(
        `[foundation-pay] razorpay order create failed (status ${rzp?.statusCode ?? "?"}, code ${rzp?.error?.code ?? "?"}): ${detail}`,
      );
      return NextResponse.json({ ok: false, error: "could not start payment" }, { status: 502 });
    }
    await patchFoundationOrder(clientId, order.order_id, { razorpay_order_id: rzpOrderId });
  }

  return NextResponse.json({
    ok: true,
    razorpay_order_id: rzpOrderId,
    amount_inr: order.amount_inr ?? FOUNDATION_SESSION_PRICE_INR,
    currency: "INR",
    keyId: publicKeyId, // public key only — the secret never leaves the server
    order_id: order.order_id,
  });
}

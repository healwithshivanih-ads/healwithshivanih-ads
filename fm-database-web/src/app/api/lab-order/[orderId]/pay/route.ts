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
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import Razorpay from "razorpay";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import { loadOrder, validateOrderAmount, patchOrder, sanitizeLogistics, type LabOrderLogistics } from "@/lib/fmdb/lab-orders";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Persist the client's home-collection address to their own record (client.yaml)
 * so the NEXT lab order pre-fills it — no re-typing. This is the client's OWN
 * data (they just entered it), written under their token-authorised id. Best-effort:
 * a failure here must never block a payment that's about to succeed. Only the
 * address/pincode (+ phone if the record has none) are touched; nothing else.
 */
async function saveClientCollectionAddress(clientId: string, l: LabOrderLogistics): Promise<void> {
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  const c = ((yaml.load(await fs.readFile(file, "utf8")) as Record<string, unknown>) ?? {});
  c.collection_address = l.address;
  c.collection_pincode = l.pincode;
  if (!c.mobile_number && l.phone) c.mobile_number = l.phone;
  await fs.writeFile(file, dumpYaml(c, { sortKeys: false }), "utf8");
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The IST calendar date n hours from now, as YYYY-MM-DD. Clients are in India,
 *  so the collection lead-time floor is computed against the IST wall clock. A
 *  36-hour floor lands on tomorrow for a morning booking, the day after for an
 *  evening one — day-granular, so this is the earliest date the picker offers. */
function ymdInIstPlusHours(h: number): string {
  const ist = new Date(Date.now() + (5.5 + h) * 3600 * 1000);
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
  // Enforce a 36-hour lead time on the collection date (lab needs to arrange it).
  const logi = sanitizeLogistics(body?.logistics, { minDateYmd: ymdInIstPlusHours(36) });
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
  // Remember the collection address on the client's record for next time (best-effort).
  await saveClientCollectionAddress(clientId, logi.logistics).catch((e) =>
    console.error(`[lab-pay] could not save collection address for ${clientId}:`, (e as Error).message),
  );

  return NextResponse.json({
    ok: true,
    razorpay_order_id: rzpOrderId,
    amount_inr: order.amount_inr,
    currency: "INR",
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? keyId, // public key only
    order_id: orderId,
  });
}

/**
 * GET /api/invoice/maintenance-charge/[paymentId]?token=...&clientId=...&subscriptionId=...
 *
 * Client-app fetch for a single quarterly-subscription charge's receipt. A
 * subscription record is mutated in place each cycle, so the payment id (not
 * the subscription id) identifies ONE billable event — see
 * MaintenanceSubscription.charge_history. Same auth contract as the sibling
 * invoice routes.
 */
import { NextResponse } from "next/server";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { getOrCreateMaintenanceChargeInvoice } from "@/lib/fmdb/invoices";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function GET(req: Request, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const clientId = url.searchParams.get("clientId") ?? "";
  const subscriptionId = url.searchParams.get("subscriptionId") ?? "";
  if (!SAFE_ID.test(paymentId) || !SAFE_ID.test(subscriptionId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  const auth = await verifyAppClient(token, clientId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const invoice = await getOrCreateMaintenanceChargeInvoice(auth.clientId, subscriptionId, paymentId);
  if (!invoice) return NextResponse.json({ ok: false, error: "no receipt available for this payment" }, { status: 404 });
  return NextResponse.json({ ok: true, invoice });
}

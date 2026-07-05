/**
 * GET /api/invoice/maintenance-order/[orderId]?token=...&clientId=...
 *
 * Client-app fetch for a one-time maintenance-block receipt. Same auth +
 * idempotency contract as /api/invoice/lab-order/[orderId] — see that route's
 * doc comment.
 */
import { NextResponse } from "next/server";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { getOrCreateMaintenanceOrderInvoice } from "@/lib/fmdb/invoices";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!SAFE_ID.test(orderId)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });

  const auth = await verifyAppClient(token, clientId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const invoice = await getOrCreateMaintenanceOrderInvoice(auth.clientId, orderId);
  if (!invoice) return NextResponse.json({ ok: false, error: "no receipt available for this order" }, { status: 404 });
  return NextResponse.json({ ok: true, invoice });
}

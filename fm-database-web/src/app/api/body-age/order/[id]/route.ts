/**
 * GET /api/body-age/order/<id>?key=<access key> — "has my payment landed?" for the buyer's own browser.
 * Answers with the status and nothing else; a wrong or missing key reads the same as no such order.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { loadBodyAgeOrder, orderPageMode } from "@/lib/fmdb/body-age-orders";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (orderPageMode(process.env.BODY_AGE_ORDER_PAGE, Date.now()) === "off") return new NextResponse("Not found", { status: 404 });
  const { id } = await ctx.params;
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const order = await loadBodyAgeOrder(id);
  const a = Buffer.from(key);
  const b = Buffer.from(order?.access_key ?? "");
  if (!order || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return NextResponse.json({ ok: true, paid: order.status !== "pending" && order.status !== "cancelled" });
}

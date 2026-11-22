/**
 * POST /api/body-age/pincode — "does the laboratory come to this PIN code?", asked by the order form as soon
 * as six digits are typed, so a buyer outside the laboratory's area finds out before filling in the rest and
 * long before paying. Answers yes / no / unknown (see body-age-pincode.ts). 404 while the order page is off.
 * The order route asks the same question again on the server; this one is only for the form.
 */
import { NextResponse } from "next/server";
import { orderPageMode } from "@/lib/fmdb/body-age-orders";
import { loadPincodeList, pincodeAnswer, tidyPincode } from "@/lib/fmdb/body-age-pincode";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (orderPageMode(process.env.BODY_AGE_ORDER_PAGE, Date.now()) === "off") return new NextResponse("Not found", { status: 404 });
  const ip = req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await allowDaily("body-age-pincode", ip, 60)).ok) return NextResponse.json({ ok: true, covered: "unknown" });
  const body = (await req.json().catch(() => null)) as { pincode?: unknown } | null;
  const pin = tidyPincode(body?.pincode);
  if (pin.length !== 6) return NextResponse.json({ ok: false, covered: "unknown" }, { status: 400 });
  return NextResponse.json({ ok: true, covered: pincodeAnswer(pin, await loadPincodeList()) });
}

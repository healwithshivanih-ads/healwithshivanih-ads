import { NextRequest, NextResponse } from "next/server";
import { lookupLetterShortCode } from "@/lib/server-actions/letter-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const res = await lookupLetterShortCode(code);
  if (!res.ok) {
    return new NextResponse("Not found", { status: 404 });
  }
  // Build origin from x-forwarded-* headers (set by Fly's proxy). req.url and
  // req.nextUrl.origin both resolve to the internal localhost:3002 address on Fly.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const base = host ? `${proto}://${host}` : req.nextUrl.origin;
  const dest = new URL(`/letter/${res.letter_token}`, base);
  return NextResponse.redirect(dest, 302);
}

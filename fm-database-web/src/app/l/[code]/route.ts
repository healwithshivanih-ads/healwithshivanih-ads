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
  // Use nextUrl.origin so Fly's x-forwarded-host is respected (req.url is the
  // internal localhost:3002 URL on the Fly machine, not the public hostname).
  const dest = new URL(`/letter/${res.letter_token}`, req.nextUrl.origin);
  return NextResponse.redirect(dest, 302);
}

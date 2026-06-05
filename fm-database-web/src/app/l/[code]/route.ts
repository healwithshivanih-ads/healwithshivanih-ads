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
  const dest = new URL(`/letter/${res.letter_token}`, req.url);
  return NextResponse.redirect(dest, 302);
}

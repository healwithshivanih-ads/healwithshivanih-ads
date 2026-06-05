import { NextRequest, NextResponse } from "next/server";
import { lookupIntakeShortCode } from "@/lib/server-actions/letter-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const res = await lookupIntakeShortCode(code);
  if (!res.ok) {
    return new NextResponse("Not found", { status: 404 });
  }
  const dest = new URL(`/intake/${res.intake_token}`, req.url);
  return NextResponse.redirect(dest, 302);
}

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
  // NEXT_PUBLIC_APP_URL is the canonical public origin (set in fly.toml).
  // req.url / req.nextUrl.origin resolve to the internal localhost:3002 address
  // on the Fly machine, so we can't use them for the redirect destination.
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
  const dest = new URL(`/intake/${res.intake_token}`, base);
  return NextResponse.redirect(dest, 302);
}

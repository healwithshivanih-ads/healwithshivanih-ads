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
  // APP_ORIGIN is the canonical public origin (set in fly.toml [env]).
  // req.url / req.nextUrl.origin resolve to the internal localhost:3002 address
  // on Fly. NEXT_PUBLIC_APP_URL gets statically replaced at build time (empty
  // on the remote builder), so we use the server-only APP_ORIGIN instead.
  const base =
    process.env.APP_ORIGIN?.replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    req.nextUrl.origin;
  const dest = new URL(`/intake/${res.intake_token}`, base);
  return NextResponse.redirect(dest, 302);
}

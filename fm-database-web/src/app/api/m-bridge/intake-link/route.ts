/**
 * POST /api/m-bridge/intake-link — issue a client's intake link on behalf of Fly.
 *
 * Runs on the MAC. Issuing a token WRITES the authoritative `client.yaml`, which
 * only the Mac holds — Fly has a read-only projection — so the coach app on Fly
 * cannot do this itself and asks here instead. Same posture as m-bridge/ask.
 *
 * WHY THIS EXISTS. On 2026-08-15 a client's intake link had died, the coach was
 * away from her Mac, and there was no remote path to re-issue one: `/m` can
 * read a client but not write one, and `fmcoach.shivanihari.com` — the tunnel
 * that serves the full desktop UI — had been down for weeks. It took someone
 * physically at the machine. This is the missing write.
 *
 * AUTH: shared secret in `x-coach-bridge`, compared in constant time; and
 * INERT BY DEFAULT — with COACH_BRIDGE_SECRET unset it 404s as if it did not
 * exist. Turning the bridge on is an explicit act on both hosts.
 *
 * It takes a client id and nothing else. It cannot be told which fields to
 * write, and it never returns the client record — only the resulting link.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function secretOk(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // keep the mismatch path from being obviously faster
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.COACH_BRIDGE_SECRET ?? "";
  if (!expected) return new NextResponse("Not Found", { status: 404 });

  const supplied = req.headers.get("x-coach-bridge") ?? "";
  if (!supplied || !secretOk(supplied, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { client_id?: string; send?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const clientId = String(body.client_id ?? "");
  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "client_id required" }, { status: 400 });
  }

  const { generateIntakeToken, sendIntakeInviteViaApi } = await import(
    "@/lib/server-actions/intake"
  );

  // Issue first. This is the part that only the Mac can do, and it is the part
  // that matters — a link that exists can always be sent by hand afterwards.
  const gen = await generateIntakeToken(clientId);
  if (!gen.ok) {
    return NextResponse.json({ ok: false, error: gen.error }, { status: 500 });
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  const url = gen.short_code
    ? `${origin}/s/${gen.short_code}`
    : `${origin}${gen.url_path}`;

  // Then try to deliver it. A failed send is NOT a failed request: the link is
  // already live, so we hand it back for the coach to paste rather than
  // reporting failure and tempting her to issue a second one.
  let sent = false;
  let sendError: string | null = null;
  if (body.send !== false) {
    try {
      const res = await sendIntakeInviteViaApi(clientId);
      sent = res.ok;
      if (!res.ok) sendError = res.error;
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    ok: true,
    url,
    short_code: gen.short_code ?? null,
    expires_at: gen.expires_at,
    sent,
    send_error: sendError,
  });
}
